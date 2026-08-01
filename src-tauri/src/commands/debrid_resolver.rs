use serde::{Deserialize, Serialize};
use std::time::Duration;

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

const TORBOX_API_BASE: &str = "https://api.torbox.app/v1/api";
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

/// Extract the BitTorrent infohash (40-char hex) from a magnet URI.
/// Returns None when the URI is not a magnet or uses an unsupported xt scheme.
fn magnet_infohash(uri: &str) -> Option<String> {
    let params = uri.split('?').nth(1)?;
    for param in params.split('&') {
        let value = param.strip_prefix("xt=")?;
        let value = value.strip_prefix("urn:btih:")?;
        let value = value.split(':').next().unwrap_or(value);
        // Dash-separated 40-hex hashes (some magnet links) normalize by stripping dashes.
        let normalized = value.replace('-', "");
        if normalized.len() == 40 && normalized.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(normalized.to_lowercase());
        }
    }
    None
}

/// Read a numeric field that may arrive as number or string.
fn json_u64(v: &serde_json::Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
}

/// Pick the most useful file from a TorBox `files` array: largest non-sample
/// archive/file (excludes .txt/.nfo/.diz metadata). Returns (id, name, size).
fn torbox_largest_file(files: &[serde_json::Value]) -> Option<(u64, String, i64)> {
    files
        .iter()
        .filter(|f| {
            let name = f["name"].as_str().unwrap_or("").to_lowercase();
            !name.contains("sample")
                && !name.ends_with(".txt")
                && !name.ends_with(".nfo")
                && !name.ends_with(".diz")
                && !name.is_empty()
        })
        .max_by_key(|f| f["size"].as_i64().unwrap_or(0))
        .and_then(|f| {
            let id = json_u64(&f["id"])?;
            let name = f["name"].as_str().map(|s| s.to_string())?;
            Some((id, name, f["size"].as_i64().unwrap_or(0)))
        })
}

/// TorBox error message extraction (detail, message, or fallback).
fn torbox_error_message(body: &serde_json::Value, status: &reqwest::StatusCode) -> String {
    body["detail"]
        .as_str()
        .or_else(|| body["message"].as_str())
        .unwrap_or(&format!("{}", status))
        .to_string()
}

/// Extract the torrent list from a `mylist` response body. The documented
/// shape is `{ data: [ ... ] }` (flat array); passing `id=<torrent_id>` makes
/// the API return a single object (`{ data: { ... } }`) instead, and some
/// responses nest under `data.torrents`. All three shapes are handled.
fn torbox_extract_torrents(body: &serde_json::Value) -> Vec<serde_json::Value> {
    let data = &body["data"];
    if let Some(arr) = data.as_array() {
        arr.clone()
    } else if let Some(arr) = data["torrents"].as_array() {
        arr.clone()
    } else if data.is_object() {
        vec![data.clone()]
    } else {
        Vec::new()
    }
}

/// Read the download state of a `mylist` torrent item. TorBox reports state in
/// the `download_state` field (`"cached"`, `"completed"`, `"uploading"`, ...);
/// `status` is tolerated as a fallback for older responses.
fn torbox_torrent_state(t: &serde_json::Value) -> String {
    t["download_state"]
        .as_str()
        .or_else(|| t["status"].as_str())
        .unwrap_or("")
        .to_string()
}

/// Whether a `mylist` torrent item is ready to be downloaded: the download
/// state is `cached`/`completed`/`uploading`, or the item explicitly reports
/// `download_finished`/`download_present`.
fn torbox_torrent_is_ready(t: &serde_json::Value) -> bool {
    is_torbox_ready_status(&torbox_torrent_state(t))
        || t["download_finished"].as_bool() == Some(true)
        || t["download_present"].as_bool() == Some(true)
}

/// Build the `mylist` URL used to observe a single freshly-created torrent.
/// `bypass_cache` defeats the server-side 600s list cache; `id` narrows the
/// response to a single object.
fn torbox_mylist_url(torrent_id: u64) -> String {
    format!(
        "{}/torrents/mylist?id={}&bypass_cache=true",
        TORBOX_API_BASE, torrent_id
    )
}

/// Poll TorBox `mylist` until the torrent reaches a ready state, returning the
/// largest file. Times out after `TORBOX_POLL_MAX_ATTEMPTS` polls.
const TORBOX_POLL_MAX_ATTEMPTS: u64 = 100;
const TORBOX_POLL_INTERVAL_SECS: u64 = 3;

/// Gated diagnostic for the TorBox mylist poll loop (default off).
const DEBUG_TORBOX_POLL: bool = false;

/// TorBox `DownloadStatus` string values (from the TorBox SDK) that mean the
/// torrent is ready to be downloaded: the data is cached (or finished
/// uploading) so `requestdl` can serve a direct link immediately.
fn is_torbox_ready_status(status: &str) -> bool {
    matches!(status, "cached" | "completed" | "uploading")
}

/// TorBox `DownloadStatus` string values that mean the torrent failed and will
/// never become ready.
fn is_torbox_error_status(status: &str) -> bool {
    matches!(status, "error" | "metaDL_error")
}

async fn resolve_via_torbox(api_key: &str, uri: &str) -> Result<DebridResolveResult, String> {
    let client = reqwest::Client::new();

    if uri.starts_with("magnet:") {
        resolve_via_torbox_magnet(&client, api_key, uri).await
    } else {
        resolve_via_torbox_webdl(&client, api_key, uri).await
    }
}

/// TorBox magnet flow: createtorrent (multipart) → poll mylist → requestdl.
/// When the infohash is already cached by TorBox, `createtorrent` returns
/// immediately and the first poll resolves right away.
async fn resolve_via_torbox_magnet(
    client: &reqwest::Client,
    api_key: &str,
    uri: &str,
) -> Result<DebridResolveResult, String> {
    let form = reqwest::multipart::Form::new().text("magnet", uri.to_string());
    let resp = client
        .post(format!("{}/torrents/createtorrent", TORBOX_API_BASE))
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
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
            error: Some(torbox_error_message(&body, &status)),
        });
    }

    let torrent_id = json_u64(&body["data"]["torrent_id"])
        .or_else(|| body["data"]["torrent_id"].as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0);
    if torrent_id == 0 {
        return Ok(DebridResolveResult {
            success: false,
            provider: "torbox".to_string(),
            resolved_url: None,
            file_name: None,
            file_size: None,
            error: Some("No torrent_id returned".to_string()),
        });
    }

    // Poll for a ready state. The list is cached server-side for 600s, so a
    // targeted `id` + `bypass_cache` request observes the torrent we just
    // created immediately. TorBox reports state in `download_state`
    // (ready = cached / completed / uploading).
    let mut picked: Option<(u64, String, i64)> = None;
    let mut last_state = String::new();
    for _ in 0..TORBOX_POLL_MAX_ATTEMPTS {
        tokio::time::sleep(Duration::from_secs(TORBOX_POLL_INTERVAL_SECS)).await;

        let resp = client
            .get(torbox_mylist_url(torrent_id))
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
            .map_err(|e| format!("TorBox API error: {}", e))?;

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("TorBox parse error: {}", e))?;

        let torrents = torbox_extract_torrents(&body);
        let Some(t) = torrents.iter().find(|t| json_u64(&t["id"]) == Some(torrent_id)) else {
            continue;
        };

        last_state = torbox_torrent_state(t);
        if DEBUG_TORBOX_POLL {
            println!(
                "[DEBRID][TORBOX_POLL] torrent_id={} status={} ready={}",
                torrent_id,
                last_state,
                torbox_torrent_is_ready(t)
            );
        }
        if is_torbox_error_status(&last_state) {
            return Ok(DebridResolveResult {
                success: false,
                provider: "torbox".to_string(),
                resolved_url: None,
                file_name: None,
                file_size: None,
                error: Some(format!("TorBox torrent error: {}", last_state)),
            });
        }

        let ready = torbox_torrent_is_ready(t);
        if ready {
            if let Some(files) = t["files"].as_array() {
                if let Some((file_id, name, size)) = torbox_largest_file(files) {
                    picked = Some((file_id, name, size));
                    break;
                }
            }
            // Ready but no usable file entry → fall back to whole-torrent download.
            picked = Some((0, t["name"].as_str().unwrap_or("").to_string(), t["size"].as_i64().unwrap_or(0)));
            break;
        }
    }

    let Some((file_id, file_name, file_size)) = picked else {
        return Ok(DebridResolveResult {
            success: false,
            provider: "torbox".to_string(),
            resolved_url: None,
            file_name: None,
            file_size: None,
            error: Some(format!(
                "TorBox torrent not ready after {}s (last status: {}). The torrent may still be downloading to the TorBox cache.",
                TORBOX_POLL_MAX_ATTEMPTS * TORBOX_POLL_INTERVAL_SECS,
                last_state
            )),
        });
    };

    // Request a direct (permalink) download link for the picked file.
    let req_url = if file_id == 0 {
        format!("{}/torrents/requestdl?token={}&torrent_id={}", TORBOX_API_BASE, api_key, torrent_id)
    } else {
        format!(
            "{}/torrents/requestdl?token={}&torrent_id={}&file_id={}",
            TORBOX_API_BASE, api_key, torrent_id, file_id
        )
    };

    let resp = client
        .get(&req_url)
        .send()
        .await
        .map_err(|e| format!("TorBox API error: {}", e))?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("TorBox parse error: {}", e))?;

    let resolved_url = body["data"]["url"]
        .as_str()
        .or_else(|| body["data"].as_str())
        .or_else(|| body["data"]["permalink"].as_str())
        .map(|s| s.to_string());

    let error = if resolved_url.is_none() {
        Some("TorBox requestdl returned no download URL".to_string())
    } else {
        None
    };

    Ok(DebridResolveResult {
        success: resolved_url.is_some(),
        provider: "torbox".to_string(),
        resolved_url,
        file_name: if file_name.is_empty() { None } else { Some(file_name) },
        file_size: if file_size > 0 { Some(file_size) } else { None },
        error,
    })
}

/// TorBox direct-HTTP flow: createwebdownload → requestdl.
async fn resolve_via_torbox_webdl(
    client: &reqwest::Client,
    api_key: &str,
    uri: &str,
) -> Result<DebridResolveResult, String> {
    let form = reqwest::multipart::Form::new().text("link", uri.to_string());
    let resp = client
        .post(format!("{}/webdl/createwebdownload", TORBOX_API_BASE))
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
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
            error: Some(torbox_error_message(&body, &status)),
        });
    }

    let download_id = json_u64(&body["data"]["id"]).unwrap_or(0);
    if download_id == 0 {
        return Ok(DebridResolveResult {
            success: false,
            provider: "torbox".to_string(),
            resolved_url: None,
            file_name: None,
            file_size: None,
            error: Some("No web download id returned".to_string()),
        });
    }

    let req_url = format!(
        "{}/webdl/requestdl?token={}&download_id={}",
        TORBOX_API_BASE, api_key, download_id
    );
    let resp = client
        .get(&req_url)
        .send()
        .await
        .map_err(|e| format!("TorBox API error: {}", e))?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("TorBox parse error: {}", e))?;

    let resolved_url = body["data"]["url"]
        .as_str()
        .or_else(|| body["data"].as_str())
        .or_else(|| body["data"]["permalink"].as_str())
        .map(|s| s.to_string());

    let error = if resolved_url.is_none() {
        Some("TorBox requestdl returned no download URL".to_string())
    } else {
        None
    };

    Ok(DebridResolveResult {
        success: resolved_url.is_some(),
        provider: "torbox".to_string(),
        resolved_url,
        file_name: body["data"]["filename"].as_str().map(|s| s.to_string()),
        file_size: body["data"]["size"].as_i64(),
        error,
    })
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

    if uri.starts_with("magnet:") {
        resolve_via_real_debrid_magnet(&client, api_key, uri).await
    } else {
        // HTTP link → single unrestrict/link call
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
}

/// Real-Debrid magnet flow: addMagnet → selectFiles → poll info → links → unrestrict.
async fn resolve_via_real_debrid_magnet(
    client: &reqwest::Client,
    api_key: &str,
    uri: &str,
) -> Result<DebridResolveResult, String> {
    let add = client
        .post(format!("{}/torrents/addMagnet", REAL_DEBRID_API_BASE))
        .header("Authorization", format!("Bearer {}", api_key))
        .form(&[("magnet", uri)])
        .send()
        .await
        .map_err(|e| format!("Real-Debrid API error: {}", e))?;

    let status = add.status();
    let body: serde_json::Value = add
        .json()
        .await
        .map_err(|e| format!("Real-Debrid parse error: {}", e))?;

    let mut torrent_id = body["id"].as_str().map(|s| s.to_string());

    if !status.is_success() || body["error"].as_str().is_some() {
        let err_code = body["error_code"].as_i64().unwrap_or(-1);
        if err_code != 22 {
            // Any error other than "torrent already added"
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

        // error_code 22 → magnet already in the user's account. Find it by infohash.
        if let Some(known) = magnet_infohash(uri) {
            let list_resp = client
                .get(format!("{}/torrents", REAL_DEBRID_API_BASE))
                .header("Authorization", format!("Bearer {}", api_key))
                .query(&[("filter", "active")])
                .send()
                .await
                .map_err(|e| format!("Real-Debrid API error: {}", e))?;
            let list: serde_json::Value = list_resp
                .json()
                .await
                .map_err(|e| format!("Real-Debrid parse error: {}", e))?;

            if let Some(arr) = list.as_array() {
                torrent_id = arr
                    .iter()
                    .find(|t| {
                        let h = t["hash"].as_str().unwrap_or("").to_lowercase();
                        h == known
                    })
                    .and_then(|t| t["id"].as_str().map(|s| s.to_string()));
            }
        }

        if torrent_id.is_none() {
            return Ok(DebridResolveResult {
                success: false,
                provider: "realdebrid".to_string(),
                resolved_url: None,
                file_name: None,
                file_size: None,
                error: Some(
                    "Torrent already added but could not be located by hash".to_string(),
                ),
            });
        }
    }

    let torrent_id = torrent_id.unwrap_or_default();
    if torrent_id.is_empty() {
        return Ok(DebridResolveResult {
            success: false,
            provider: "realdebrid".to_string(),
            resolved_url: None,
            file_name: None,
            file_size: None,
            error: Some("No torrent id returned".to_string()),
        });
    }

    if let Err(e) = real_debrid_select_and_wait(client, api_key, &torrent_id).await {
        return Ok(DebridResolveResult {
            success: false,
            provider: "realdebrid".to_string(),
            resolved_url: None,
            file_name: None,
            file_size: None,
            error: Some(e),
        });
    }

    // Get the download links for the finished torrent.
    let links_resp = client
        .get(format!("{}/torrents/links/{}", REAL_DEBRID_API_BASE, torrent_id))
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Real-Debrid API error: {}", e))?;
    let links_body: serde_json::Value = links_resp
        .json()
        .await
        .map_err(|e| format!("Real-Debrid parse error: {}", e))?;

    let link = links_body["links"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let Some(link) = link else {
        return Ok(DebridResolveResult {
            success: false,
            provider: "realdebrid".to_string(),
            resolved_url: None,
            file_name: None,
            file_size: None,
            error: Some("No download links returned".to_string()),
        });
    };

    // Unrestrict the first link to get a direct URL.
    let un = client
        .post(format!("{}/unrestrict/link", REAL_DEBRID_API_BASE))
        .header("Authorization", format!("Bearer {}", api_key))
        .form(&[("link", &link)])
        .send()
        .await
        .map_err(|e| format!("Real-Debrid API error: {}", e))?;
    let un_status = un.status();
    let un_body: serde_json::Value = un
        .json()
        .await
        .map_err(|e| format!("Real-Debrid parse error: {}", e))?;

    if !un_status.is_success() {
        let default_msg = format!("HTTP {}", un_status);
        let error_msg = un_body["error"].as_str().unwrap_or(&default_msg);
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
        resolved_url: un_body["download"].as_str().map(|s| s.to_string()),
        file_name: un_body["filename"].as_str().map(|s| s.to_string()),
        file_size: un_body["filesize"].as_i64(),
        error: None,
    })
}

const REAL_DEBRID_POLL_MAX_ATTEMPTS: u64 = 40;
const REAL_DEBRID_POLL_INTERVAL_SECS: u64 = 3;

/// Select all files for a Real-Debrid torrent and poll until it is ready to download.
async fn real_debrid_select_and_wait(
    client: &reqwest::Client,
    api_key: &str,
    torrent_id: &str,
) -> Result<(), String> {
    let sel = client
        .post(format!(
            "{}/torrents/selectFiles/{}",
            REAL_DEBRID_API_BASE, torrent_id
        ))
        .header("Authorization", format!("Bearer {}", api_key))
        .form(&[("files", "all")])
        .send()
        .await
        .map_err(|e| format!("Real-Debrid API error: {}", e))?;

    if !sel.status().is_success() {
        return Err(format!(
            "Real-Debrid selectFiles failed: HTTP {}",
            sel.status()
        ));
    }

    for _ in 0..REAL_DEBRID_POLL_MAX_ATTEMPTS {
        tokio::time::sleep(Duration::from_secs(REAL_DEBRID_POLL_INTERVAL_SECS)).await;

        let resp = client
            .get(format!("{}/torrents/info/{}", REAL_DEBRID_API_BASE, torrent_id))
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
            .map_err(|e| format!("Real-Debrid API error: {}", e))?;

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Real-Debrid parse error: {}", e))?;

        if let Some(err) = body["error"].as_str() {
            return Err(err.to_string());
        }

        let progress = body["progress"].as_f64().unwrap_or(0.0);
        let finished = body["downloadFinished"].as_bool() == Some(true);
        let status = body["status"].as_u64().unwrap_or(0);
        if progress >= 100.0 || finished || matches!(status, 2 | 6 | 7) {
            return Ok(());
        }
    }

    Err(format!(
        "Real-Debrid torrent not ready after {}s",
        REAL_DEBRID_POLL_MAX_ATTEMPTS * REAL_DEBRID_POLL_INTERVAL_SECS
    ))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn magnet_infohash_extracts_lowercase_hex() {
        let uri = "magnet:?xt=urn:btih:DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF&dn=game";
        assert_eq!(
            magnet_infohash(uri).as_deref(),
            Some("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
        );
    }

    #[test]
    fn magnet_infohash_accepts_dash_separated_hash() {
        // btih with dash separators (some magnet links) still resolves to the
        // first 40-hex segment.
        let uri = "magnet:?xt=urn:btih:DEADBEEF-DEADBEEF-DEADBEEF-DEADBEEF-DEADBEEF&dn=game";
        assert_eq!(
            magnet_infohash(uri).as_deref(),
            Some("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
        );
    }

    #[test]
    fn magnet_infohash_rejects_missing_or_short_hash() {
        assert_eq!(magnet_infohash("magnet:?xt=urn:btih:short&dn=game"), None);
        assert_eq!(magnet_infohash("https://example.com/file.rar"), None);
    }

    #[test]
    fn magnet_infohash_rejects_non_hex() {
        let uri = "magnet:?xt=urn:btih:ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ&dn=game";
        assert_eq!(magnet_infohash(uri), None);
    }

    #[test]
    fn json_u64_reads_number_or_string() {
        let num = serde_json::json!(42);
        let str_ = serde_json::json!("42");
        let bad = serde_json::json!("not-a-number");
        assert_eq!(json_u64(&num), Some(42));
        assert_eq!(json_u64(&str_), Some(42));
        assert_eq!(json_u64(&bad), None);
        assert_eq!(json_u64(&serde_json::Value::Null), None);
    }

    #[test]
    fn torbox_largest_file_skips_samples_and_metadata() {
        let files = serde_json::json!([
            { "id": 1, "name": "sample.mp4", "size": 99999999 },
            { "id": 2, "name": "notes.txt", "size": 50 },
            { "id": 3, "name": "game.rar", "size": 5000 },
            { "id": 4, "name": "game.part01.rar", "size": 8000 }
        ]);
        let arr: Vec<serde_json::Value> = files.as_array().unwrap().clone();
        let (id, name, size) = torbox_largest_file(&arr).unwrap();
        assert_eq!(id, 4);
        assert_eq!(name, "game.part01.rar");
        assert_eq!(size, 8000);
    }

    #[test]
    fn torbox_largest_file_empty_or_all_metadata_returns_none() {
        assert_eq!(torbox_largest_file(&[]), None);
        let files = serde_json::json!([{ "id": "1", "name": "cover.nfo", "size": 10 }]);
        let arr: Vec<serde_json::Value> = files.as_array().unwrap().clone();
        assert_eq!(torbox_largest_file(&arr), None);
    }

    #[test]
    fn torbox_error_message_prefers_detail() {
        let body = serde_json::json!({ "detail": "boom", "message": "meh" });
        let status = reqwest::StatusCode::BAD_REQUEST;
        assert_eq!(torbox_error_message(&body, &status), "boom");
        assert_eq!(
            torbox_error_message(&serde_json::Value::Null, &status),
            "400 Bad Request"
        );
    }

    #[test]
    fn torbox_extract_torrents_accepts_flat_array() {
        // Documented `mylist` shape: { data: [ ... ] }.
        let body = serde_json::json!({
            "data": [
                { "id": 7, "download_state": "cached" },
                { "id": 8, "download_state": "downloading" }
            ],
            "success": true
        });
        let torrents = torbox_extract_torrents(&body);
        assert_eq!(torrents.len(), 2);
        assert_eq!(json_u64(&torrents[0]["id"]), Some(7));
        assert_eq!(json_u64(&torrents[1]["id"]), Some(8));
    }

    #[test]
    fn torbox_extract_torrents_tolerates_nested_torrents_key() {
        let body = serde_json::json!({
            "data": { "torrents": [ { "id": 3, "download_state": "cached" } ] }
        });
        let torrents = torbox_extract_torrents(&body);
        assert_eq!(torrents.len(), 1);
        assert_eq!(json_u64(&torrents[0]["id"]), Some(3));
    }

    #[test]
    fn torbox_extract_torrents_accepts_single_object_with_id_param() {
        // mylist?id=... returns an object rather than a list.
        let body = serde_json::json!({
            "data": { "id": 5, "download_state": "uploading" }
        });
        let torrents = torbox_extract_torrents(&body);
        assert_eq!(torrents.len(), 1);
        assert_eq!(json_u64(&torrents[0]["id"]), Some(5));
    }

    #[test]
    fn torbox_extract_torrents_empty_on_missing_data() {
        assert!(torbox_extract_torrents(&serde_json::Value::Null).is_empty());
        assert!(torbox_extract_torrents(&serde_json::json!({ "error": "x" })).is_empty());
    }

    #[test]
    fn torbox_torrent_state_reads_download_state_then_status() {
        let t = serde_json::json!({ "download_state": "cached", "status": "bogus" });
        assert_eq!(torbox_torrent_state(&t), "cached");
        let t2 = serde_json::json!({ "status": "completed" });
        assert_eq!(torbox_torrent_state(&t2), "completed");
        assert_eq!(torbox_torrent_state(&serde_json::json!({})), "");
    }

    #[test]
    fn torbox_torrent_is_ready_matches_state_or_flags() {
        assert!(torbox_torrent_is_ready(&serde_json::json!({ "download_state": "cached" })));
        assert!(torbox_torrent_is_ready(&serde_json::json!({ "download_state": "uploading" })));
        assert!(torbox_torrent_is_ready(&serde_json::json!({ "download_state": "completed" })));
        assert!(torbox_torrent_is_ready(&serde_json::json!({ "download_finished": true })));
        assert!(torbox_torrent_is_ready(&serde_json::json!({ "download_present": true })));
        assert!(!torbox_torrent_is_ready(&serde_json::json!({ "download_state": "downloading" })));
        assert!(!torbox_torrent_is_ready(&serde_json::json!({ "download_state": "queued" })));
        assert!(!torbox_torrent_is_ready(
            &serde_json::json!({ "download_state": "stalled (no seeds)" })
        ));
        assert!(!torbox_torrent_is_ready(&serde_json::json!({})));
    }

    #[test]
    fn torbox_mylist_url_includes_id_and_bypass_cache() {
        let url = torbox_mylist_url(42);
        assert!(url.contains("/torrents/mylist?id=42"), "url: {url}");
        assert!(url.contains("bypass_cache=true"), "url: {url}");
    }

    #[test]
    fn torbox_ready_statuses_match_real_api_values() {
        // TorBox `DownloadStatus` strings (SDK). A cached or finished torrent is
        // immediately downloadable — this is the regression that caused the
        // launcher to hang on cached torrents.
        assert!(is_torbox_ready_status("cached"));
        assert!(is_torbox_ready_status("completed"));
        assert!(is_torbox_ready_status("uploading"));
        // The old buggy states do not exist in the TorBox API and must NOT match.
        assert!(!is_torbox_ready_status("download_finished"));
        assert!(!is_torbox_ready_status(""));
    }

    #[test]
    fn torbox_waiting_statuses_keep_polling() {
        // Downloading/queued/awaiting metadata are transient — the poll must
        // keep waiting instead of giving up or resolving.
        for s in ["downloading", "queued", "metaDL", "checkingResumeData", "paused", "stalled (no seeds)", "unknown"] {
            assert!(!is_torbox_ready_status(s), "should wait on: {s}");
            assert!(!is_torbox_error_status(s), "should wait on: {s}");
        }
    }

    #[test]
    fn torbox_error_statuses_abort_poll() {
        assert!(is_torbox_error_status("error"));
        assert!(is_torbox_error_status("metaDL_error"));
        assert!(!is_torbox_error_status("cached"));
        assert!(!is_torbox_error_status(""));
    }
}
