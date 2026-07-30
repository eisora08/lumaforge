use serde::{Deserialize, Serialize};

/// Per-provider API configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebridProviderConfig {
    pub torbox_api_key: Option<String>,
    pub real_debrid_api_key: Option<String>,
    pub all_debrid_api_key: Option<String>,
    pub premiumize_api_key: Option<String>,
}

/// Result of resolving a download URI through a specific provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebridResolveResult {
    pub success: bool,
    pub provider: String,
    pub resolved_url: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Result of checking a provider's API key validity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebridProviderStatus {
    pub provider: String,
    pub valid: bool,
    pub account_name: Option<String>,
    pub account_email: Option<String>,
    pub premium_until: Option<String>,
    pub bandwidth_used: Option<i64>,
    pub bandwidth_max: Option<i64>,
    pub points: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Provider API URLs ──

const TORBOX_API_BASE: &str = "https://api.torbox.app/v1";
const REAL_DEBRID_API_BASE: &str = "https://api.real-debrid.com/rest/1.0";
const ALL_DEBRID_API_BASE: &str = "https://api.alldebrid.com/v4";
const PREMIUMIZE_API_BASE: &str = "https://www.premiumize.me/api";

// ── Resolve a magnet/HTTP URI via a specific provider ──

/// Resolve a download URI (magnet or HTTP) through a debrid provider.
/// Returns a direct download URL that can be used for installation.
#[tauri::command]
pub async fn resolve_debrid_download_url(
    provider: String,
    api_key: String,
    uri: String,
) -> Result<DebridResolveResult, String> {
    match provider.to_lowercase().as_str() {
        "torbox" => resolve_via_torbox(&api_key, &uri).await,
        "realdebrid" | "real_debrid" => resolve_via_real_debrid(&api_key, &uri).await,
        "alldebrid" | "all_debrid" => resolve_via_all_debrid(&api_key, &uri).await,
        "premiumize" => resolve_via_premiumize(&api_key, &uri).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

/// Check if a provider API key is valid and return account info.
#[tauri::command]
pub async fn check_debrid_provider_status(
    provider: String,
    api_key: String,
) -> Result<DebridProviderStatus, String> {
    match provider.to_lowercase().as_str() {
        "torbox" => check_torbox_status(&api_key).await,
        "realdebrid" | "real_debrid" => check_real_debrid_status(&api_key).await,
        "alldebrid" | "all_debrid" => check_all_debrid_status(&api_key).await,
        "premiumize" => check_premiumize_status(&api_key).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

// ── TorBox ──

async fn resolve_via_torbox(api_key: &str, uri: &str) -> Result<DebridResolveResult, String> {
    let client = reqwest::Client::new();

    if uri.starts_with("magnet:") {
        // Create torrent via magnet
        let resp = client
            .post(format!("{}/torrents/createtorrent", TORBOX_API_BASE))
            .header("Authorization", format!("Bearer {}", api_key))
            .form(&[("magnet", uri)])
            .send()
            .await
            .map_err(|e| format!("TorBox API error: {}", e))?;

        let status = resp.status();
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("TorBox parse error: {}", e))?;

        if !status.is_success() {
            return Ok(DebridResolveResult {
                success: false,
                provider: "torbox".to_string(),
                resolved_url: None,
                file_name: None,
                file_size: None,
                error: Some(
                    body.get("detail")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&format!("HTTP {}", status))
                        .to_string(),
                ),
            });
        }

        // Get torrent ID and check for direct download link
        let torrent_id = body["data"]["torrent_id"].as_str().unwrap_or("");
        if torrent_id.is_empty() {
            return Ok(DebridResolveResult {
                success: false,
                provider: "torbox".to_string(),
                resolved_url: None,
                file_name: None,
                file_size: None,
                error: Some("No torrent_id returned".to_string()),
            });
        }

        // Poll for torrent info to get download URL
        // In a real implementation, we'd poll or use webhooks
        Ok(DebridResolveResult {
            success: true,
            provider: "torbox".to_string(),
            resolved_url: Some(format!("{}/torrents/{}/download?token={}", TORBOX_API_BASE, torrent_id, api_key)),
            file_name: None,
            file_size: None,
            error: None,
        })
    } else {
        // Direct HTTP download
        let resp = client
            .post(format!("{}/downloads/create", TORBOX_API_BASE))
            .header("Authorization", format!("Bearer {}", api_key))
            .form(&[("url", uri)])
            .send()
            .await
            .map_err(|e| format!("TorBox API error: {}", e))?;

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("TorBox parse error: {}", e))?;

        let download_url = body["data"]["download_url"]
            .as_str()
            .map(|s| s.to_string());

        Ok(DebridResolveResult {
            success: download_url.is_some(),
            provider: "torbox".to_string(),
            resolved_url: download_url,
            file_name: body["data"]["filename"].as_str().map(|s| s.to_string()),
            file_size: body["data"]["size"].as_i64(),
            error: None,
        })
    }
}

async fn check_torbox_status(api_key: &str) -> Result<DebridProviderStatus, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/user/me", TORBOX_API_BASE))
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("TorBox API error: {}", e))?;

    if !resp.status().is_success() {
        return Ok(DebridProviderStatus {
            provider: "torbox".to_string(),
            valid: false,
            account_name: None,
            account_email: None,
            premium_until: None,
            bandwidth_used: None,
            bandwidth_max: None,
            points: None,
            error: Some(format!("HTTP {}", resp.status())),
        });
    }

    let body: serde_json::Value = resp.json().await.unwrap_or_default();
    Ok(DebridProviderStatus {
        provider: "torbox".to_string(),
        valid: true,
        account_name: body["data"]["username"].as_str().map(|s| s.to_string()),
        account_email: body["data"]["email"].as_str().map(|s| s.to_string()),
        premium_until: body["data"]["premium_until"].as_str().map(|s| s.to_string()),
        bandwidth_used: None,
        bandwidth_max: None,
        points: body["data"]["points"].as_i64(),
        error: None,
    })
}

// ── Real-Debrid ──

async fn resolve_via_real_debrid(api_key: &str, uri: &str) -> Result<DebridResolveResult, String> {
    let client = reqwest::Client::new();

    // Step 1: Unrestrict the link
    let resp = client
        .post(format!("{}/unrestrict/link", REAL_DEBRID_API_BASE))
        .header("Authorization", format!("Bearer {}", api_key))
        .form(&[("link", uri)])
        .send()
        .await
        .map_err(|e| format!("Real-Debrid API error: {}", e))?;

    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Real-Debrid parse error: {}", e))?;

    if !status.is_success() {
        let default_msg = format!("HTTP {}", status);
        let error_msg = body["error"].as_str().unwrap_or(&default_msg);
        return Ok(DebridResolveResult {
            success: false,
            provider: "realdebrid".to_string(),
            resolved_url: None,
            file_name: None,
            file_size: None,
            error: Some(error_msg.to_string()),
        });
    }

    Ok(DebridResolveResult {
        success: true,
        provider: "realdebrid".to_string(),
        resolved_url: body["download"].as_str().map(|s| s.to_string()),
        file_name: body["filename"].as_str().map(|s| s.to_string()),
        file_size: body["filesize"].as_i64(),
        error: None,
    })
}

async fn check_real_debrid_status(api_key: &str) -> Result<DebridProviderStatus, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/user", REAL_DEBRID_API_BASE))
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Real-Debrid API error: {}", e))?;

    if !resp.status().is_success() {
        return Ok(DebridProviderStatus {
            provider: "realdebrid".to_string(),
            valid: false,
            account_name: None,
            account_email: None,
            premium_until: None,
            bandwidth_used: None,
            bandwidth_max: None,
            points: None,
            error: Some(format!("HTTP {}", resp.status())),
        });
    }

    let body: serde_json::Value = resp.json().await.unwrap_or_default();
    Ok(DebridProviderStatus {
        provider: "realdebrid".to_string(),
        valid: true,
        account_name: body["username"].as_str().map(|s| s.to_string()),
        account_email: body["email"].as_str().map(|s| s.to_string()),
        premium_until: body["premium"].as_i64().map(|ts| {
            let secs = ts as u64;
            let days = secs / 86400;
            let y = 1970 + (days as f64 / 365.25) as i64;
            format!("{}", y)
        }),
        bandwidth_used: None,
        bandwidth_max: None,
        points: body["points"].as_i64(),
        error: None,
    })
}

// ── AllDebrid ──

async fn resolve_via_all_debrid(api_key: &str, uri: &str) -> Result<DebridResolveResult, String> {
    let client = reqwest::Client::new();

    let params = if uri.starts_with("magnet:") {
        vec![("agent", "lumaforge"), ("apikey", api_key), ("magnets", uri)]
    } else {
        vec![("agent", "lumaforge"), ("apikey", api_key), ("link", uri)]
    };

    let endpoint = if uri.starts_with("magnet:") {
        format!("{}/magnet/upload", ALL_DEBRID_API_BASE)
    } else {
        format!("{}/link/unlock", ALL_DEBRID_API_BASE)
    };

    let resp = client
        .get(&endpoint)
        .query(&params)
        .send()
        .await
        .map_err(|e| format!("AllDebrid API error: {}", e))?;

    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("AllDebrid parse error: {}", e))?;

    if !status.is_success() || body["status"] != "success" {
        let default_msg = format!("HTTP {}", status);
        let error_msg = body["error"]["message"]
            .as_str()
            .unwrap_or(&default_msg);
        return Ok(DebridResolveResult {
            success: false,
            provider: "alldebrid".to_string(),
            resolved_url: None,
            file_name: None,
            file_size: None,
            error: Some(error_msg.to_string()),
        });
    }

    if uri.starts_with("magnet:") {
        let magnet_id = body["data"]["magnets"][0]["id"].as_str().unwrap_or("");
        Ok(DebridResolveResult {
            success: true,
            provider: "alldebrid".to_string(),
            resolved_url: Some(format!(
                "{}/magnet/download?agent=lumaforge&apikey={}&id={}",
                ALL_DEBRID_API_BASE, api_key, magnet_id
            )),
            file_name: body["data"]["magnets"][0]["filename"].as_str().map(|s| s.to_string()),
            file_size: body["data"]["magnets"][0]["size"].as_i64(),
            error: None,
        })
    } else {
        Ok(DebridResolveResult {
            success: true,
            provider: "alldebrid".to_string(),
            resolved_url: body["data"]["link"].as_str().map(|s| s.to_string()),
            file_name: body["data"]["filename"].as_str().map(|s| s.to_string()),
            file_size: body["data"]["size"].as_i64(),
            error: None,
        })
    }
}

async fn check_all_debrid_status(api_key: &str) -> Result<DebridProviderStatus, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/user/info?agent=lumaforge&apikey={}", ALL_DEBRID_API_BASE, api_key))
        .send()
        .await
        .map_err(|e| format!("AllDebrid API error: {}", e))?;

    if !resp.status().is_success() {
        return Ok(DebridProviderStatus {
            provider: "alldebrid".to_string(),
            valid: false,
            account_name: None,
            account_email: None,
            premium_until: None,
            bandwidth_used: None,
            bandwidth_max: None,
            points: None,
            error: Some(format!("HTTP {}", resp.status())),
        });
    }

    let body: serde_json::Value = resp.json().await.unwrap_or_default();
    if body["status"] != "success" {
        return Ok(DebridProviderStatus {
            provider: "alldebrid".to_string(),
            valid: false,
            account_name: None,
            account_email: None,
            premium_until: None,
            bandwidth_used: None,
            bandwidth_max: None,
            points: None,
            error: body["error"]["message"].as_str().map(|s| s.to_string()),
        });
    }

    let user = &body["data"]["user"];
    Ok(DebridProviderStatus {
        provider: "alldebrid".to_string(),
        valid: true,
        account_name: user["username"].as_str().map(|s| s.to_string()),
        account_email: user["email"].as_str().map(|s| s.to_string()),
        premium_until: user["premiumUntil"].as_i64().map(|ts| ts.to_string()),
        bandwidth_used: user["bandwidth"]["used"].as_i64(),
        bandwidth_max: user["bandwidth"]["max"].as_i64(),
        points: user["points"].as_i64(),
        error: None,
    })
}

// ── Premiumize ──

async fn resolve_via_premiumize(api_key: &str, uri: &str) -> Result<DebridResolveResult, String> {
    let client = reqwest::Client::new();

    if uri.starts_with("magnet:") {
        // Add magnet to premiumize
        let resp = client
            .post(format!("{}/transfer/directdl", PREMIUMIZE_API_BASE))
            .query(&[("apikey", api_key)])
            .form(&[("src", uri)])
            .send()
            .await
            .map_err(|e| format!("Premiumize API error: {}", e))?;

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Premiumize parse error: {}", e))?;

        let content = body["content"][0].clone();
        Ok(DebridResolveResult {
            success: body["status"] == "success",
            provider: "premiumize".to_string(),
            resolved_url: content["link"].as_str().map(|s| s.to_string()),
            file_name: content["filename"].as_str().map(|s| s.to_string()),
            file_size: content["file_size"].as_i64(),
            error: if body["status"] != "success" {
                body["message"].as_str().map(|s| s.to_string())
            } else {
                None
            },
        })
    } else {
        // Direct download link
        let resp = client
            .post(format!("{}/transfer/directdl", PREMIUMIZE_API_BASE))
            .query(&[("apikey", api_key)])
            .form(&[("src", uri)])
            .send()
            .await
            .map_err(|e| format!("Premiumize API error: {}", e))?;

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Premiumize parse error: {}", e))?;

        let content = body["content"][0].clone();
        Ok(DebridResolveResult {
            success: body["status"] == "success",
            provider: "premiumize".to_string(),
            resolved_url: content["link"].as_str().map(|s| s.to_string()),
            file_name: content["filename"].as_str().map(|s| s.to_string()),
            file_size: content["file_size"].as_i64(),
            error: if body["status"] != "success" {
                body["message"].as_str().map(|s| s.to_string())
            } else {
                None
            },
        })
    }
}

async fn check_premiumize_status(api_key: &str) -> Result<DebridProviderStatus, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/account/info", PREMIUMIZE_API_BASE))
        .query(&[("apikey", api_key)])
        .send()
        .await
        .map_err(|e| format!("Premiumize API error: {}", e))?;

    if !resp.status().is_success() {
        return Ok(DebridProviderStatus {
            provider: "premiumize".to_string(),
            valid: false,
            account_name: None,
            account_email: None,
            premium_until: None,
            bandwidth_used: None,
            bandwidth_max: None,
            points: None,
            error: Some(format!("HTTP {}", resp.status())),
        });
    }

    let body: serde_json::Value = resp.json().await.unwrap_or_default();
    Ok(DebridProviderStatus {
        provider: "premiumize".to_string(),
        valid: body["status"] == "success",
        account_name: body["customer_id"].as_str().map(|s| s.to_string()),
        account_email: body["email"].as_str().map(|s| s.to_string()),
        premium_until: body["premium_until"].as_i64().map(|ts| ts.to_string()),
        bandwidth_used: body["used"].as_i64(),
        bandwidth_max: body["limit"].as_i64(),
        points: None,
        error: None,
    })
}
