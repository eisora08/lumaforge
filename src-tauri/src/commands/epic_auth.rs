//! Epic Games Store — OAuth authentication and token management.
//!
//! Implements the Authorization Code flow using the Epic Games Launcher's
//! client credentials. Tokens are stored in an AES-256-GCM encrypted file.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

// ─── Constants ─────────────────────────────────────────────────────────────

/// Epic Games Launcher client ID (public, not a secret).
const EPIC_CLIENT_ID: &str = "34a02cf8f4414e29b15921876da36f9a";

/// Base64-encoded "clientId:clientSecret" for the Epic Launcher.
const EPIC_AUTH_ENCODED: &str =
    "MzRhMDJjZjhmNDQxNGUyOWIxNTkyMTg3NmRhMzZmOWE6ZGFhZmJjY2M3Mzc3NDUwMzlkZmZlNTNkOTRmYzc2Y2Y=";

/// OAuth token endpoint.
const EPIC_OAUTH_URL: &str =
    "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token";

/// Library items endpoint.
const EPIC_LIBRARY_URL: &str =
    "https://library-service.live.use1a.on.epicgames.com/library/api/public/items";

/// Catalog endpoint (base URL).
const EPIC_CATALOG_URL: &str =
    "https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace/";

/// Playtime endpoint (base URL, `{account_id}` will be substituted).
const EPIC_PLAYTIME_URL: &str =
    "https://library-service.live.use1a.on.epicgames.com/library/api/public/playtime/account/{account_id}/all";

/// User-Agent matching the Epic Games Launcher.
const EPIC_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) EpicGamesLauncher";

// ─── Models ────────────────────────────────────────────────────────────────

/// OAuth token response from Epic.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct EpicTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub account_id: String,
    pub token_type: String,
    pub expires_in: i64,
    pub expires_at: Option<String>,
    pub client_id: Option<String>,
    /// Display name from the token response.
    #[serde(default, alias = "displayName")]
    pub display_name: Option<String>,
    /// Computed at save time: epoch millis when the token expires.
    #[serde(default)]
    pub expires_at_millis: Option<i64>,
}

/// Account info from Epic.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicAccountInfo {
    pub id: String,
    pub display_name: Option<String>,
    pub preferred_language: Option<String>,
    pub country: Option<String>,
}

/// An owned game asset from the library API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicOwnedGame {
    pub app_name: String,
    pub label_name: Option<String>,
    pub build_version: Option<String>,
    pub catalog_item_id: Option<String>,
    pub namespace: Option<String>,
    pub asset_id: Option<String>,
    pub sandbox_type: Option<String>,
}

/// Library items response with pagination.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItemsResponse {
    pub records: Vec<EpicOwnedGame>,
    pub response_metadata: Option<LibraryMetadata>,
}

/// Pagination metadata.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMetadata {
    pub next_cursor: Option<String>,
    pub state_token: Option<String>,
}

/// Catalog item from the bulk items endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicCatalogItem {
    pub id: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub key_images: Option<Vec<EpicImage>>,
    pub categories: Option<Vec<EpicCategory>>,
    pub custom_attributes: Option<std::collections::HashMap<String, EpicCustomAttribute>>,
    pub release_info: Option<Vec<EpicReleaseInfo>>,
    pub developer: Option<String>,
    pub developer_id: Option<String>,
    pub entitlement_name: Option<String>,
    pub entitlement_type: Option<String>,
    pub item_type: Option<String>,
    pub main_game_item: Option<EpicMainGameItem>,
}

/// Image in a catalog item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicImage {
    pub url: Option<String>,
    pub r#type: Option<String>,
}

/// Category in a catalog item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpicCategory {
    pub path: Option<String>,
}

/// Custom attribute in a catalog item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpicCustomAttribute {
    pub r#type: Option<String>,
    pub value: Option<String>,
}

/// Release info in a catalog item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicReleaseInfo {
    pub app_id: Option<String>,
    pub platform: Option<Vec<String>>,
}

/// Main game reference for DLC detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicMainGameItem {
    pub id: Option<String>,
}

/// Playtime item from the playtime API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicPlaytimeItem {
    pub account_id: Option<String>,
    pub artifact_id: Option<String>,
    pub total_time: Option<u64>,
}

/// Error response from Epic API.
#[derive(Debug, Clone, Deserialize)]
pub struct EpicErrorResponse {
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

/// Full catalog fetch result (raw JSON + parsed).
pub struct CatalogFetchResult {
    pub raw_json: String,
    pub items: std::collections::HashMap<String, EpicCatalogItem>,
}

// ─── Token storage (AES-256-GCM encrypted file) ───────────────────────────
//
// Matches the Achievements reference approach: tokens are stored in an
// encrypted file at {data_local_dir}/lumaforge/epic_tokens.enc.
// Encryption uses AES-256-GCM with a scrypt-derived key.

use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::Aead,
};
use rand::RngCore;
use sha2::Sha256;

const EPIC_TOKEN_SECRET: &str = "epic_default_passphrase";
const TOKEN_FILE_NAME: &str = "epic_tokens.enc";

/// Derive a 256-bit key from a passphrase and salt using scrypt.
fn derive_key(passphrase: &[u8], salt: &[u8]) -> [u8; 32] {
    use sha2::Digest;
    // Simple scrypt-like KDF using SHA-256 + iterations (matching Achievements reference)
    let mut key = [0u8; 32];
    let mut derived = Sha256::new();
    derived.update(passphrase);
    derived.update(salt);
    let hash = derived.finalize();
    key.copy_from_slice(&hash);
    // Multiple rounds for key stretching
    let mut prev = key;
    for _ in 0..10_000 {
        let mut h = Sha256::new();
        h.update(&prev);
        h.update(salt);
        prev.copy_from_slice(&h.finalize());
    }
    key.copy_from_slice(&prev);
    key
}

/// Resolve the path to the encrypted token file.
fn resolve_token_file() -> std::path::PathBuf {
    let base = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    base.join("lumaforge").join(TOKEN_FILE_NAME)
}

/// Encrypt a JSON string using AES-256-GCM.
fn encrypt_payload(plaintext: &str) -> Result<String, String> {
    let mut rng = rand::thread_rng();

    // Random salt (16 bytes) and nonce (12 bytes)
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    rng.fill_bytes(&mut salt);
    rng.fill_bytes(&mut nonce_bytes);

    // Derive key from passphrase + salt
    let key = derive_key(EPIC_TOKEN_SECRET.as_bytes(), &salt);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("Failed to create cipher: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {e}"))?;

    // Split ciphertext and auth tag (last 16 bytes)
    let tag_len = 16;
    if ciphertext.len() < tag_len {
        return Err("Ciphertext too short".to_string());
    }
    let (encrypted, tag) = ciphertext.split_at(ciphertext.len() - tag_len);

    // Build envelope JSON (same format as Achievements reference)
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let envelope = serde_json::json!({
        "v": 1,
        "s": b64.encode(salt),
        "i": b64.encode(nonce_bytes),
        "t": b64.encode(tag),
        "c": b64.encode(encrypted),
    });

    serde_json::to_string(&envelope).map_err(|e| format!("Failed to serialize envelope: {e}"))
}

/// Decrypt an AES-256-GCM encrypted JSON envelope.
fn decrypt_payload(envelope_json: &str) -> Result<String, String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;

    let envelope: serde_json::Value = serde_json::from_str(envelope_json)
        .map_err(|e| format!("Invalid envelope JSON: {e}"))?;

    let salt = b64
        .decode(envelope["s"].as_str().unwrap_or(""))
        .map_err(|e| format!("Invalid salt: {e}"))?;
    let iv = b64
        .decode(envelope["i"].as_str().unwrap_or(""))
        .map_err(|e| format!("Invalid IV: {e}"))?;
    let tag = b64
        .decode(envelope["t"].as_str().unwrap_or(""))
        .map_err(|e| format!("Invalid tag: {e}"))?;
    let ciphertext = b64
        .decode(envelope["c"].as_str().unwrap_or(""))
        .map_err(|e| format!("Invalid ciphertext: {e}"))?;

    // Reconstruct the key
    let key = derive_key(EPIC_TOKEN_SECRET.as_bytes(), &salt);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("Failed to create cipher: {e}"))?;
    let nonce = Nonce::from_slice(&iv);

    // Reconstruct: ciphertext + tag
    let mut full = ciphertext;
    full.extend_from_slice(&tag);

    let plaintext = cipher
        .decrypt(nonce, full.as_ref())
        .map_err(|e| format!("Decryption failed: {e}"))?;

    String::from_utf8(plaintext).map_err(|e| format!("Invalid UTF-8: {e}"))
}

fn save_tokens(tokens: &mut EpicTokens) -> Result<(), String> {
    // Compute expiry in epoch millis (like Achievements: expires_in - 60s buffer)
    let now_millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let buffer_ms = 60_000; // 60 seconds buffer
    tokens.expires_at_millis = Some(now_millis + (tokens.expires_in * 1000) - buffer_ms);

    let json = serde_json::to_string(&tokens).map_err(|e| e.to_string())?;
    let encrypted = encrypt_payload(&json)?;

    // Ensure parent directory exists
    let path = resolve_token_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create token dir: {e}"))?;
    }

    std::fs::write(&path, encrypted).map_err(|e| format!("Failed to write token file: {e}"))?;
    Ok(())
}

fn load_tokens() -> Result<EpicTokens, String> {
    let path = resolve_token_file();
    let encrypted = std::fs::read_to_string(&path)
        .map_err(|_| "No saved Epic tokens".to_string())?;
    let json = decrypt_payload(&encrypted)?;
    serde_json::from_str(&json).map_err(|e| format!("Failed to parse saved tokens: {e}"))
}

fn delete_tokens() -> Result<(), String> {
    let path = resolve_token_file();
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete token file: {e}"))?;
    }
    Ok(())
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(EPIC_USER_AGENT)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("Failed to build HTTP client")
}

/// Check if the access token is still valid (with buffer).
fn is_token_valid(tokens: &EpicTokens) -> bool {
    if tokens.access_token.is_empty() {
        return false;
    }

    // Fast local check using computed expiry millis
    if let Some(expires_at_millis) = tokens.expires_at_millis {
        let now_millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        return now_millis < expires_at_millis;
    }

    // Fallback: if no computed expiry, trust the token
    // (validate_and_refresh will catch a truly expired one)
    true
}

/// Exchange an authorization code for tokens.
async fn exchange_code(code: &str) -> Result<EpicTokens, String> {
    let client = client();
    let resp = client
        .post(EPIC_OAUTH_URL)
        .header("Authorization", format!("basic {EPIC_AUTH_ENCODED}"))
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("token_type", "eg1"),
        ])
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    if !status.is_success() {
        return Err(format!("Epic OAuth error ({status}): {body}"));
    }

    let tokens: EpicTokens =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse token response: {e}"))?;

    if tokens.access_token.is_empty() {
        return Err("No access token in response".to_string());
    }

    Ok(tokens)
}

/// Refresh an existing refresh token.
async fn refresh_tokens(refresh_token: &str) -> Result<EpicTokens, String> {
    let client = client();
    let resp = client
        .post(EPIC_OAUTH_URL)
        .header("Authorization", format!("basic {EPIC_AUTH_ENCODED}"))
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("token_type", "eg1"),
        ])
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    if !status.is_success() {
        return Err(format!("Epic token refresh error ({status}): {body}"));
    }

    let tokens: EpicTokens =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse token response: {e}"))?;

    if tokens.access_token.is_empty() {
        return Err("No access token in refresh response".to_string());
    }

    Ok(tokens)
}

/// Ensure tokens are valid. Returns current or refreshed tokens.
///
/// Strategy (matching Achievements reference):
/// 1. If token is locally valid (not expired) → return as-is, no HTTP call
/// 2. If expired → refresh via OAuth endpoint (uses `basic` auth, not `eg1`)
/// 3. If refresh fails → delete stale tokens
async fn validate_and_refresh(old_tokens: &EpicTokens) -> Result<EpicTokens, String> {
    // Fast local check: if token is still valid, return as-is
    if is_token_valid(old_tokens) {
        return Ok(old_tokens.clone());
    }

    // Token expired — refresh using the OAuth endpoint (basic auth, not eg1)
    match refresh_tokens(&old_tokens.refresh_token).await {
        Ok(mut refreshed) => {
            // Preserve display_name from old tokens (refresh response doesn't include it)
            if refreshed.display_name.is_none() {
                refreshed.display_name = old_tokens.display_name.clone();
            }
            save_tokens(&mut refreshed)?;
            Ok(refreshed)
        }
        Err(refresh_err) => {
            eprintln!("[EPIC_AUTH] validate_and_refresh: refresh failed ({refresh_err}), deleting stale tokens");
            let _ = delete_tokens();
            Err(format!("Token refresh failed: {refresh_err}"))
        }
    }
}

// ─── Public commands ───────────────────────────────────────────────────────

/// Get the URL the user should open in their browser to log in.
///
/// The user will be redirected to a page showing an authorization code.
/// That code should be passed to `epic_exchange_code`.
#[tauri::command]
pub async fn epic_get_auth_url() -> Result<String, String> {
    let redirect = format!(
        "https://www.epicgames.com/id/api/redirect?clientId={EPIC_CLIENT_ID}&responseType=code"
    );
    let encoded_redirect = urlencoding::encode(&redirect);
    Ok(format!(
        "https://www.epicgames.com/id/login?redirectUrl={encoded_redirect}"
    ))
}

/// Exchange an authorization code for access + refresh tokens.
///
/// Tokens are stored in the OS keychain.
#[tauri::command]
pub async fn epic_exchange_code(code: String) -> Result<EpicTokens, String> {
    let code = code.trim().trim_matches('"').to_string();
    if code.is_empty() {
        return Err("Authorization code is empty".to_string());
    }

    let mut tokens = exchange_code(&code).await?;
    save_tokens(&mut tokens)?;
    Ok(tokens)
}

/// Refresh the stored tokens (called when access token expires).
#[tauri::command]
pub async fn epic_refresh_stored_tokens() -> Result<EpicTokens, String> {
    let old_tokens = load_tokens()?;
    let mut refreshed = refresh_tokens(&old_tokens.refresh_token).await?;
    // Preserve display_name from old tokens
    if refreshed.display_name.is_none() {
        refreshed.display_name = old_tokens.display_name;
    }
    save_tokens(&mut refreshed)?;
    Ok(refreshed)
}

/// Check if the user is logged in (tokens exist).
///
/// Purely local check — no HTTP call. Matches Achievements reference:
/// `connected: !!token?.access_token && !!accountId`.
/// Token refresh happens lazily when an API call is actually made.
#[tauri::command]
pub async fn epic_is_logged_in() -> Result<bool, String> {
    match load_tokens() {
        Ok(tokens) => Ok(!tokens.access_token.is_empty() && !tokens.account_id.is_empty()),
        Err(_) => Ok(false),
    }
}

/// Get the current account info (display name, etc.).
///
/// Returns info from stored tokens — no HTTP call. The display_name comes
/// from the original token exchange response.
#[tauri::command]
pub async fn epic_get_account_info() -> Result<EpicAccountInfo, String> {
    let tokens = load_tokens()?;
    Ok(EpicAccountInfo {
        id: tokens.account_id,
        display_name: tokens.display_name,
        preferred_language: None,
        country: None,
    })
}

/// Log out — delete stored tokens.
#[tauri::command]
pub async fn epic_logout() -> Result<(), String> {
    delete_tokens()
}

/// Start the OAuth flow in a WebView window.
///
/// Strategy:
/// 1. Start a tiny local HTTP server on a random port
/// 2. Open a WebView to Epic's login page
/// 3. When `on_navigation` detects `/id/api/redirect`, let the page load
/// 4. After a brief delay, inject JS that reads the JSON body and navigates
///    to `http://localhost:{port}/code?code=...` via `window.location`
/// 5. The local server captures the code, we exchange it for tokens
#[tauri::command]
pub async fn epic_start_auth_flow(app: tauri::AppHandle) -> Result<String, String> {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

    let (code_tx, code_rx) = std::sync::mpsc::channel::<String>();

    // ── Local HTTP server to capture the auth code ──
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Failed to start local server: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get server port: {e}"))?
        .port();
    eprintln!("[EPIC_AUTH] local server listening on port {port}");

    let code_tx_server = code_tx.clone();
    std::thread::spawn(move || {
        listener.set_nonblocking(true).ok();
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(300);

        loop {
            if start.elapsed() > timeout {
                eprintln!("[EPIC_AUTH] local server timed out");
                break;
            }

            match listener.accept() {
                Ok((mut stream, _)) => {
                    let mut reader = BufReader::new(&stream);
                    let mut request_line = String::new();
                    if reader.read_line(&mut request_line).is_ok() {
                        // Parse: GET /code?code=xxx HTTP/1.1
                        if let Some(path_part) = request_line.split_whitespace().nth(1) {
                            if let Some(query) = path_part.split('?').nth(1) {
                                let query_clean =
                                    query.split_whitespace().next().unwrap_or("");
                                for param in query_clean.split('&') {
                                    if let Some((key, value)) = param.split_once('=') {
                                        if key == "code" {
                                            let code = urlencoding::decode(value)
                                                .unwrap_or_default()
                                                .to_string();
                                            eprintln!(
                                                "[EPIC_AUTH] captured auth code from local server"
                                            );
                                            let _ = code_tx_server.send(code);

                                            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n\
                                                <html><body style=\"font-family:sans-serif;text-align:center;padding:50px;background:#0f1525;color:#fff\">\
                                                <h2 style=\"color:#00b7ff\">¡Conectado!</h2>\
                                                <p>Puedes cerrar esta ventana.</p>\
                                                <script>setTimeout(function(){window.close()},2000);</script>\
                                                </body></html>";
                                            let _ =
                                                stream.write_all(response.as_bytes());
                                            return;
                                        }
                                    }
                                }
                            }
                        }

                        // No matching endpoint — return 404
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\n\r\n");
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    continue;
                }
                Err(_) => break,
            }
        }
    });

    // ── Build the Epic login URL ──
    let auth_url = epic_get_auth_url().await?;

    let app_for_nav = app.clone();

    // ── Open WebView with on_navigation interceptor ──
    let _auth_window = WebviewWindowBuilder::new(
        &app,
        "epic-auth",
        WebviewUrl::External(
            auth_url
                .parse()
                .map_err(|e| format!("Invalid auth URL: {e}"))?,
        ),
    )
    .title("Epic Games — Iniciar sesión")
    .inner_size(620.0, 720.0)
    .resizable(true)
    .center()
    .on_navigation(move |url| {
        let url_str = url.to_string();

        if url_str.contains("/id/api/redirect") {
            eprintln!("[EPIC_AUTH] detected redirect page: {url_str}");
            // Let the page load (return true), then inject JS after a delay
            let app = app_for_nav.clone();
            std::thread::spawn(move || {
                // Wait for JSON page to fully render
                std::thread::sleep(std::time::Duration::from_secs(2));

                if let Some(window) = app.get_webview_window("epic-auth") {
                    // JS: parse JSON body → extract authorizationCode → navigate to local server
                    let js = format!(
                        r#"try{{var t=document.body.innerText;var d=JSON.parse(t);if(d&&d.authorizationCode){{window.location="http://localhost:{port}/code?code="+encodeURIComponent(d.authorizationCode);}}}}catch(e){{console.log("[EPIC_AUTH] eval error:",e);}}"#,
                    );
                    if let Err(e) = window.eval(&js) {
                        eprintln!("[EPIC_AUTH] eval_script failed: {e}");
                    } else {
                        eprintln!("[EPIC_AUTH] injected JS to extract auth code");
                    }
                }
            });
        }

        true // Always allow navigation
    })
    .build()
    .map_err(|e| format!("Failed to create auth window: {e}"))?;

    // ── Wait for the code and exchange it ──
    let app_final = app.clone();
    std::thread::spawn(move || {
        let code = match code_rx.recv_timeout(std::time::Duration::from_secs(300)) {
            Ok(code) => code,
            Err(_) => {
                eprintln!("[EPIC_AUTH] auth code wait timed out");
                let _ = app_final.emit(
                    "epic-auth-complete",
                    serde_json::json!({
                        "success": false,
                        "error": "Timeout waiting for authorization"
                    }),
                );
                return;
            }
        };

        let rt =
            tokio::runtime::Runtime::new().expect("Failed to create tokio runtime for auth exchange");
        let result = rt.block_on(async {
            let mut tokens = exchange_code(&code).await?;
            save_tokens(&mut tokens)?;
            Ok::<EpicTokens, String>(tokens)
        });

        match result {
            Ok(tokens) => {
                eprintln!(
                    "[EPIC_AUTH] auth successful, account_id={}",
                    tokens.account_id
                );
                let _ = app_final.emit(
                    "epic-auth-complete",
                    serde_json::json!({
                        "success": true,
                        "tokens": tokens
                    }),
                );
            }
            Err(e) => {
                eprintln!("[EPIC_AUTH] auth failed: {e}");
                let _ = app_final.emit(
                    "epic-auth-complete",
                    serde_json::json!({
                        "success": false,
                        "error": e
                    }),
                );
            }
        }

        // Close the auth window
        if let Some(window) = app_final.get_webview_window("epic-auth") {
            let _ = window.close();
        }
    });

    Ok("Auth window opened".to_string())
}

// ─── Library API functions (called from epic_catalog.rs) ───────────────────

/// Get the stored access token, refreshing if necessary.
pub async fn get_valid_token() -> Result<(String, String), String> {
    let tokens = load_tokens()?;
    let tokens = validate_and_refresh(&tokens).await?;
    Ok((tokens.token_type, tokens.access_token))
}

/// Get the library items URL.
pub fn library_url() -> &'static str {
    EPIC_LIBRARY_URL
}

/// Get the catalog URL.
pub fn catalog_url() -> &'static str {
    EPIC_CATALOG_URL
}

/// Get the playtime URL template.
pub fn playtime_url() -> &'static str {
    EPIC_PLAYTIME_URL
}

/// Get the account ID from stored tokens.
pub fn get_stored_account_id() -> Result<String, String> {
    let tokens = load_tokens()?;
    Ok(tokens.account_id)
}
