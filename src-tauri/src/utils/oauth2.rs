use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;

use crate::utils::cloud_config::{self, CloudProvider, OAuthTokens};

// ---------------------------------------------------------------------------
// OAuth2 client credentials
// ---------------------------------------------------------------------------

/// Google Drive OAuth2 credentials.
const GDRIVE_CLIENT_ID: &str = "1072944905499-vm2v2i5dvn0a0d2o4ca36i1vge8cvbn0.apps.googleusercontent.com";
const GDRIVE_CLIENT_SECRET: &str = "v6V3fKV_zWU7iw1DrpO1rknX";
const GDRIVE_REDIRECT_URI: &str = "http://localhost:{port}/callback";
const GDRIVE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GDRIVE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GDRIVE_SCOPES: &str = "https://www.googleapis.com/auth/drive.file";

/// OneDrive OAuth2 credentials.
const ONEDRIVE_CLIENT_ID: &str = "b15665d9-eda6-4092-8539-0eec376afd59";
const ONEDRIVE_CLIENT_SECRET: &str = "qtyfaBBYA403=unZUP40~_#";
const ONEDRIVE_REDIRECT_URI: &str = "http://localhost:{port}/callback";
const ONEDRIVE_AUTH_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const ONEDRIVE_TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const ONEDRIVE_SCOPES: &str = "files.readwrite offline_access";

// ---------------------------------------------------------------------------
// OAuth2 flow result
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
pub struct OAuthResult {
    pub success: bool,
    pub provider: String,
    pub message: String,
}

// ---------------------------------------------------------------------------
// Local redirect server (background thread + tokio channel)
// ---------------------------------------------------------------------------

/// Bind a TCP listener to an available port and spawn a background thread
/// that waits for the OAuth2 callback. Returns (port, tokio receiver).
///
/// Uses port 0 so the OS picks an available port — no TOCTOU race.
fn spawn_redirect_server() -> Result<(u16, tokio::sync::mpsc::Receiver<String>), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to start local server: {e}"))?;

    let port = listener.local_addr()
        .map_err(|e| format!("Failed to get server port: {e}"))?
        .port();
    eprintln!("[OAUTH] local server listening on port {port}");

    listener.set_nonblocking(true)
        .map_err(|e| format!("Failed to set nonblocking: {e}"))?;

    let (tx, rx) = tokio::sync::mpsc::channel::<String>(1);

    std::thread::spawn(move || {
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(300);

        loop {
            if start.elapsed() > timeout {
                eprintln!("[OAUTH] local server timed out");
                break;
            }

            match listener.accept() {
                Ok((mut stream, _)) => {
                    stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).ok();

                    let mut reader = BufReader::new(&stream);
                    let mut request_line = String::new();
                    if reader.read_line(&mut request_line).is_ok() {
                        if let Some(path_part) = request_line.split_whitespace().nth(1) {
                            if let Some(query) = path_part.split('?').nth(1) {
                                let query_clean = query.split_whitespace().next().unwrap_or("");
                                for param in query_clean.split('&') {
                                    if let Some((key, value)) = param.split_once('=') {
                                        if key == "code" {
                                            let code = url_decode(value);
                                            eprintln!("[OAUTH] captured auth code from local server (len={})", code.len());
                                            let _ = tx.blocking_send(code);

                                            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n\
                                                <html><body style=\"font-family:sans-serif;text-align:center;padding:50px;background:#0f1525;color:#fff\">\
                                                <h2 style=\"color:#00b7ff\">Conectado!</h2>\
                                                <p>Puedes cerrar esta ventana.</p>\
                                                <script>setTimeout(function(){window.close()},2000);</script>\
                                                </body></html>";
                                            let _ = stream.write_all(response.as_bytes());
                                            return;
                                        }
                                    }
                                }
                            }
                        }

                        // Check for error responses from the provider
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\n\r\n");
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    continue;
                }
                Err(e) => {
                    eprintln!("[OAUTH] local server accept error: {e}");
                    break;
                }
            }
        }
    });

    Ok((port, rx))
}

/// Simple URL decoding.
fn url_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.bytes();
    while let Some(b) = chars.next() {
        match b {
            b'%' => {
                let hex: String = chars.by_ref().take(2).map(|c| c as char).collect();
                if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                    result.push(byte as char);
                }
            }
            b'+' => result.push(' '),
            b => result.push(b as char),
        }
    }
    result
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

/// Exchange an authorization code for tokens (Google Drive).
fn exchange_gdrive_code(code: &str, port: u16) -> Result<OAuthTokens, String> {
    let redirect_uri = GDRIVE_REDIRECT_URI.replace("{port}", &port.to_string());
    eprintln!("[OAUTH] exchanging Google Drive code (redirect_uri={redirect_uri})");

    let response = ureq::post(GDRIVE_TOKEN_URL)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_form(&[
            ("code", code),
            ("client_id", GDRIVE_CLIENT_ID),
            ("client_secret", GDRIVE_CLIENT_SECRET),
            ("redirect_uri", &redirect_uri),
            ("grant_type", "authorization_code"),
        ])
        .map_err(|e| {
            eprintln!("[OAUTH] Google Drive token exchange HTTP error: {e}");
            format!("Token exchange failed: {e}")
        })?;

    let body: serde_json::Value = response.into_json()
        .map_err(|e| {
            eprintln!("[OAUTH] Google Drive token response parse error: {e}");
            format!("Failed to parse token response: {e}")
        })?;

    eprintln!("[OAUTH] Google Drive token response: {}", serde_json::to_string_pretty(&body).unwrap_or_default());

    if let Some(err) = body.get("error") {
        let desc = body.get("error_description").and_then(|d| d.as_str()).unwrap_or("");
        let msg = format!("Google Drive OAuth error: {} — {}", err.as_str().unwrap_or("?"), desc);
        eprintln!("[OAUTH] {msg}");
        return Err(msg);
    }

    let access_token = body["access_token"]
        .as_str()
        .ok_or("Missing access_token in Google Drive response")?
        .to_string();
    let refresh_token = body["refresh_token"]
        .as_str()
        .ok_or("Missing refresh_token in Google Drive response")?
        .to_string();
    let expires_in = body["expires_in"]
        .as_u64()
        .unwrap_or(3600);

    eprintln!("[OAUTH] Google Drive token exchange OK (expires_in={expires_in})");

    Ok(OAuthTokens {
        access_token,
        refresh_token,
        expires_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() + expires_in,
    })
}

/// Exchange an authorization code for tokens (OneDrive).
fn exchange_onedrive_code(code: &str, port: u16) -> Result<OAuthTokens, String> {
    let redirect_uri = ONEDRIVE_REDIRECT_URI.replace("{port}", &port.to_string());
    eprintln!("[OAUTH] exchanging OneDrive code (redirect_uri={redirect_uri})");

    let response = ureq::post(ONEDRIVE_TOKEN_URL)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_form(&[
            ("code", code),
            ("client_id", ONEDRIVE_CLIENT_ID),
            ("client_secret", ONEDRIVE_CLIENT_SECRET),
            ("redirect_uri", &redirect_uri),
            ("grant_type", "authorization_code"),
        ])
        .map_err(|e| {
            eprintln!("[OAUTH] OneDrive token exchange HTTP error: {e}");
            format!("Token exchange failed: {e}")
        })?;

    let body: serde_json::Value = response.into_json()
        .map_err(|e| {
            eprintln!("[OAUTH] OneDrive token response parse error: {e}");
            format!("Failed to parse token response: {e}")
        })?;

    eprintln!("[OAUTH] OneDrive token response: {}", serde_json::to_string_pretty(&body).unwrap_or_default());

    if let Some(err) = body.get("error") {
        let desc = body.get("error_description").and_then(|d| d.as_str()).unwrap_or("");
        let msg = format!("OneDrive OAuth error: {} — {}", err.as_str().unwrap_or("?"), desc);
        eprintln!("[OAUTH] {msg}");
        return Err(msg);
    }

    let access_token = body["access_token"]
        .as_str()
        .ok_or("Missing access_token in OneDrive response")?
        .to_string();
    let refresh_token = body["refresh_token"]
        .as_str()
        .ok_or("Missing refresh_token in OneDrive response")?
        .to_string();
    let expires_in = body["expires_in"]
        .as_u64()
        .unwrap_or(3600);

    eprintln!("[OAUTH] OneDrive token exchange OK (expires_in={expires_in})");

    Ok(OAuthTokens {
        access_token,
        refresh_token,
        expires_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() + expires_in,
    })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Start the OAuth2 flow for a given provider using a WebView window.
/// Opens a Tauri WebView to the provider's auth page, captures the callback,
/// exchanges the code for tokens, and closes the window.
pub async fn start_oauth_flow(app: tauri::AppHandle, provider: CloudProvider) -> Result<OAuthResult, String> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    let provider_name = provider.as_str().to_string();
    eprintln!("[OAUTH] starting OAuth flow for {provider_name}");

    // Start background server — binds to port 0, OS picks available port
    let (port, mut code_rx) = spawn_redirect_server()?;
    eprintln!("[OAUTH] local server on port {port}");

    // Build the auth URL
    let (auth_url, window_title) = match provider {
        CloudProvider::GoogleDrive => {
            let redirect_uri = GDRIVE_REDIRECT_URI.replace("{port}", &port.to_string());
            let url = format!(
                "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent",
                GDRIVE_AUTH_URL,
                GDRIVE_CLIENT_ID,
                url_encode(&redirect_uri),
                url_encode(GDRIVE_SCOPES),
            );
            eprintln!("[OAUTH] Google Drive auth URL built");
            (url, "Google Drive — Sign in".to_string())
        }
        CloudProvider::OneDrive => {
            let redirect_uri = ONEDRIVE_REDIRECT_URI.replace("{port}", &port.to_string());
            let url = format!(
                "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&response_mode=query",
                ONEDRIVE_AUTH_URL,
                ONEDRIVE_CLIENT_ID,
                url_encode(&redirect_uri),
                url_encode(ONEDRIVE_SCOPES),
            );
            eprintln!("[OAUTH] OneDrive auth URL built");
            (url, "OneDrive — Sign in".to_string())
        }
        _ => return Err(format!(
            "OAuth2 flow not supported for provider: {}. Use S3/R2 credentials or local folder instead.",
            provider.display_name()
        )),
    };

    // Open WebView to the auth URL
    let window_label = format!("cloud-auth-{}", provider.as_str());
    let _auth_window = WebviewWindowBuilder::new(
        &app,
        &window_label,
        WebviewUrl::External(
            auth_url.parse().map_err(|e| format!("Invalid auth URL: {e}"))?,
        ),
    )
    .title(&window_title)
    .inner_size(620.0, 720.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|e| {
        eprintln!("[OAUTH] failed to create auth window: {e}");
        format!("Failed to create auth window: {e}")
    })?;

    eprintln!("[OAUTH] auth window opened, waiting for callback...");

    // Wait for the auth code (tokio async — does NOT block the thread)
    let code = tokio::time::timeout(
        std::time::Duration::from_secs(300),
        code_rx.recv(),
    )
    .await
    .map_err(|_| {
        eprintln!("[OAUTH] callback timed out (5 minutes)");
        "OAuth2 callback timed out (5 minutes)".to_string()
    })?
    .ok_or_else(|| {
        eprintln!("[OAUTH] channel closed without code");
        "OAuth2 channel closed without receiving code".to_string()
    })?;

    eprintln!("[OAUTH] received auth code (len={}), closing window", code.len());

    // Close the auth window
    if let Some(window) = app.get_webview_window(&window_label) {
        let _ = window.close();
    }

    // Exchange code for tokens, save, and update config
    eprintln!("[OAUTH] exchanging code for tokens...");
    let result = match provider {
        CloudProvider::GoogleDrive => {
            let tokens = exchange_gdrive_code(&code, port)?;
            eprintln!("[OAUTH] saving Google Drive tokens...");
            cloud_config::write_oauth_tokens(CloudProvider::GoogleDrive, &tokens)?;
            let token_path = cloud_config::get_token_path(CloudProvider::GoogleDrive)?;
            cloud_config::write_provider_config(CloudProvider::GoogleDrive, token_path.to_str().unwrap_or(""))?;
            eprintln!("[OAUTH] config.json updated for gdrive");
            OAuthResult {
                success: true,
                provider: provider_name,
                message: "Google Drive connected successfully. Restart Steam for Cloud Redirect to sync.".to_string(),
            }
        }
        CloudProvider::OneDrive => {
            let tokens = exchange_onedrive_code(&code, port)?;
            eprintln!("[OAUTH] saving OneDrive tokens...");
            cloud_config::write_oauth_tokens(CloudProvider::OneDrive, &tokens)?;
            let token_path = cloud_config::get_token_path(CloudProvider::OneDrive)?;
            cloud_config::write_provider_config(CloudProvider::OneDrive, token_path.to_str().unwrap_or(""))?;
            eprintln!("[OAUTH] config.json updated for onedrive");
            OAuthResult {
                success: true,
                provider: provider_name,
                message: "OneDrive connected successfully. Restart Steam for Cloud Redirect to sync.".to_string(),
            }
        }
        _ => unreachable!(),
    };

    eprintln!("[OAUTH] flow complete: {}", result.message);
    Ok(result)
}

/// Simple URL encoding.
fn url_encode(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 3);
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            }
            _ => {
                result.push('%');
                result.push_str(&format!("{:02X}", byte));
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_decode() {
        assert_eq!(url_decode("hello%20world"), "hello world");
        assert_eq!(url_decode("hello+world"), "hello world");
        assert_eq!(url_decode("abc%2Fdef"), "abc/def");
    }

    #[test]
    fn test_url_encode() {
        assert_eq!(url_encode("hello world"), "hello%20world");
        assert_eq!(url_encode("abc/def"), "abc%2Fdef");
        assert_eq!(url_encode("safe-value"), "safe-value");
    }
}
