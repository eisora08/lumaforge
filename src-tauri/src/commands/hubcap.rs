use std::time::Duration;
use std::time::Instant;

use crate::models::hubcap::{
    HubcapAppStatusResponse, HubcapDepotKeysResponse, HubcapHealthResponse, HubcapUserStatsResponse,
};

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("LumaForge/0.1.0")
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Error creando cliente HTTP: {}", e))
}

fn empty_stats(status: &str) -> HubcapUserStatsResponse {
    HubcapUserStatsResponse {
        ok: false,
        status: status.into(),
        username: None,
        today_usage: None,
        daily_limit: None,
        total_key_usage: None,
        generation_used: None,
        generation_limit: None,
        depot_keys_count: None,
        reset_at: None,
        reset_in_seconds: None,
        remaining: None,
        plan: None,
        last_used_at: None,
        api_key_usage_count: None,
        api_key_expires_at: None,
        can_make_requests: None,
        user_id: None,
        role_daily_limit: None,
        custom_api_limit: None,
        using_custom_api_limit: None,
        auto_update_enabled: None,
    }
}

fn parse_str_field(obj: &serde_json::Map<String, serde_json::Value>, names: &[&str]) -> Option<String> {
    for name in names {
        if let Some(v) = obj.get(*name) {
            if let Some(s) = v.as_str() {
                return Some(s.to_string());
            }
        }
    }
    None
}

fn parse_i64_field(obj: &serde_json::Map<String, serde_json::Value>, names: &[&str]) -> Option<i64> {
    for name in names {
        if let Some(v) = obj.get(*name) {
            if let Some(n) = v.as_i64() {
                return Some(n);
            }
        }
    }
    None
}

#[tauri::command]
pub async fn hubcap_health(base_url: String) -> Result<HubcapHealthResponse, String> {
    let start = Instant::now();
    let base = base_url.trim_end_matches('/').to_string();
    let url = format!("{}/api/v1/health", base);
    let client = build_client()?;

    match client.get(&url).send().await {
        Ok(response) => {
            let elapsed_ms = start.elapsed().as_millis() as u64;
            if response.status().is_success() {
                println!("[HUBCAP][HEALTH] status=online elapsedMs={}", elapsed_ms);
                Ok(HubcapHealthResponse {
                    status: "online".into(),
                    elapsed_ms,
                })
            } else {
                println!(
                    "[HUBCAP][HEALTH] status=degraded elapsedMs={} http={}",
                    elapsed_ms,
                    response.status().as_u16()
                );
                Ok(HubcapHealthResponse {
                    status: "degraded".into(),
                    elapsed_ms,
                })
            }
        }
        Err(e) => {
            let elapsed_ms = start.elapsed().as_millis() as u64;
            println!(
                "[HUBCAP][HEALTH] status=error elapsedMs={} error=\"{}\"",
                elapsed_ms, e
            );
            Ok(HubcapHealthResponse {
                status: "error".into(),
                elapsed_ms,
            })
        }
    }
}

#[tauri::command]
pub async fn hubcap_user_stats(
    base_url: String,
    api_key: String,
) -> Result<HubcapUserStatsResponse, String> {
    if api_key.is_empty() {
        return Ok(empty_stats("no_key"));
    }

    let base = base_url.trim_end_matches('/').to_string();
    let url = format!("{}/api/v1/user/stats", base);
    let client = build_client()?;

    match client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
    {
        Ok(response) => {
            let status_code = response.status().as_u16();
            match status_code {
                200 => match response.json::<serde_json::Value>().await {
                    Ok(json) => {
                        println!("[HUBCAP][USER_STATS] status=ok");
                        let obj = json.as_object().cloned().unwrap_or_default();

                        let today_usage = parse_i64_field(&obj, &[
                            "daily_usage", "dailyUsage",
                            "today_usage", "todayUsage", "todaysUsage",
                            "daily_lua_used", "daily_used", "usedToday", "used_today",
                            "lua_used", "luaUsed",
                        ]);

                        let daily_limit = parse_i64_field(&obj, &[
                            "daily_limit", "dailyLimit", "daily_lua_limit",
                            "daily_quota", "dailyQuota", "limit",
                            "lua_limit", "luaLimit",
                        ]);

                        let total_key_usage = parse_i64_field(&obj, &[
                            "api_key_usage_count", "apiKeyUsageCount",
                            "total_key_usage", "totalKeyUsage",
                            "totalUsage", "total_usage", "total",
                        ]);

                        let last_used_at = parse_str_field(&obj, &[
                            "last_used_at", "lastUsedAt",
                            "last_used", "lastUsed",
                        ]);

                        let generation_used = parse_i64_field(&obj, &[
                            "generation_used", "generationUsed", "generations_used",
                        ]);

                        let generation_limit = parse_i64_field(&obj, &[
                            "generation_limit", "generationLimit", "generations_limit",
                        ]);

                        let depot_keys_count = parse_i64_field(&obj, &[
                            "depot_keys_count", "depotKeysCount", "depot_keys",
                        ]);

                        let reset_at = obj
                            .get("reset_at")
                            .or_else(|| obj.get("resetAt"))
                            .or_else(|| obj.get("resetsAt"))
                            .or_else(|| obj.get("resets_at"))
                            .cloned();

                        let reset_in_seconds = parse_i64_field(&obj, &[
                            "reset_in_seconds", "resetInSeconds",
                            "time_left", "timeLeft",
                            "reset_in", "resetIn",
                        ]);

                        let remaining = obj.get("remaining").and_then(|v| v.as_i64());

                        let plan = parse_str_field(&obj, &["plan", "tier"]);

                        let username = parse_str_field(&obj, &["username"]);

                        let api_key_usage_count = parse_i64_field(&obj, &[
                            "api_key_usage_count", "apiKeyUsageCount",
                        ]);

                        let api_key_expires_at = parse_str_field(&obj, &[
                            "api_key_expires_at", "apiKeyExpiresAt",
                            "key_expires_at", "keyExpiresAt",
                        ]);

                        let can_make_requests = obj
                            .get("can_make_requests")
                            .or_else(|| obj.get("canMakeRequests"))
                            .and_then(|v| v.as_bool());

                        let user_id = parse_str_field(&obj, &["user_id", "userId"]);

                        let role_daily_limit = parse_i64_field(&obj, &[
                            "role_daily_limit", "roleDailyLimit",
                            "role_limit", "roleLimit",
                        ]);

                        let custom_api_limit = parse_i64_field(&obj, &[
                            "custom_api_limit", "customApiLimit",
                            "custom_limit", "customLimit",
                        ]);

                        let using_custom_api_limit = obj
                            .get("using_custom_api_limit")
                            .or_else(|| obj.get("usingCustomApiLimit"))
                            .or_else(|| obj.get("usingCustomLimit"))
                            .and_then(|v| v.as_bool());

                        let auto_update_enabled = obj
                            .get("auto_update_enabled")
                            .or_else(|| obj.get("autoUpdateEnabled"))
                            .and_then(|v| v.as_bool());

                        println!(
                            "[HUBCAP][USER_STATS] daily_usage={} daily_limit={} api_key_usage_count={} expires={} can_make={}",
                            today_usage.map_or(-1, |v| v),
                            daily_limit.map_or(-1, |v| v),
                            api_key_usage_count.map_or(-1, |v| v),
                            api_key_expires_at.as_deref().unwrap_or("null"),
                            can_make_requests.map_or("null", |v| if v { "true" } else { "false" }),
                        );

                        Ok(HubcapUserStatsResponse {
                            ok: true,
                            status: "ok".into(),
                            username,
                            today_usage,
                            daily_limit,
                            total_key_usage,
                            generation_used,
                            generation_limit,
                            depot_keys_count,
                            reset_at,
                            reset_in_seconds,
                            remaining,
                            plan,
                            last_used_at,
                            api_key_usage_count,
                            api_key_expires_at,
                            can_make_requests,
                            user_id,
                            role_daily_limit,
                            custom_api_limit,
                            using_custom_api_limit,
                            auto_update_enabled,
                        })
                    }
                    Err(e) => {
                        println!(
                            "[HUBCAP][USER_STATS] status=parse_error error=\"{}\"",
                            e
                        );
                        Ok(empty_stats("parse_error"))
                    }
                },
                401 => {
                    println!("[HUBCAP][USER_STATS] status=unauthorized");
                    Ok(empty_stats("unauthorized"))
                }
                403 => {
                    println!("[HUBCAP][USER_STATS] status=forbidden");
                    Ok(empty_stats("forbidden"))
                }
                429 => {
                    println!("[HUBCAP][USER_STATS] status=rate_limited");
                    Ok(empty_stats("rate_limited"))
                }
                _ => {
                    println!("[HUBCAP][USER_STATS] status=error http={}", status_code);
                    Ok(empty_stats("error"))
                }
            }
        }
        Err(e) => {
            println!(
                "[HUBCAP][USER_STATS] status=network_error error=\"{}\"",
                e
            );
            Ok(empty_stats("network_error"))
        }
    }
}

#[tauri::command]
pub async fn hubcap_depot_keys(
    base_url: String,
    api_key: String,
) -> Result<HubcapDepotKeysResponse, String> {
    if api_key.is_empty() {
        return Ok(HubcapDepotKeysResponse {
            status: "no_key".into(),
            count: 0,
        });
    }

    let base = base_url.trim_end_matches('/').to_string();
    let url = format!("{}/api/v1/depot-keys", base);
    let client = build_client()?;

    match client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
    {
        Ok(response) => {
            let status_code = response.status().as_u16();
            match status_code {
                200 => {
                    let count = response
                        .json::<serde_json::Value>()
                        .await
                        .ok()
                        .and_then(|v| v.as_array().map(|a| a.len() as i64))
                        .unwrap_or(0);
                    println!("[HUBCAP][DEPOT_KEYS] status=ok count={}", count);
                    Ok(HubcapDepotKeysResponse {
                        status: "ok".into(),
                        count,
                    })
                }
                401 => {
                    println!("[HUBCAP][DEPOT_KEYS] status=unauthorized count=0");
                    Ok(HubcapDepotKeysResponse {
                        status: "unauthorized".into(),
                        count: 0,
                    })
                }
                403 => {
                    println!("[HUBCAP][DEPOT_KEYS] status=forbidden count=0");
                    Ok(HubcapDepotKeysResponse {
                        status: "forbidden".into(),
                        count: 0,
                    })
                }
                _ => {
                    println!(
                        "[HUBCAP][DEPOT_KEYS] status=error count=0 http={}",
                        status_code
                    );
                    Ok(HubcapDepotKeysResponse {
                        status: "error".into(),
                        count: 0,
                    })
                }
            }
        }
        Err(e) => {
            println!(
                "[HUBCAP][DEPOT_KEYS] status=network_error count=0 error=\"{}\"",
                e
            );
            Ok(HubcapDepotKeysResponse {
                status: "network_error".into(),
                count: 0,
            })
        }
    }
}

fn empty_app_status(status: &str) -> HubcapAppStatusResponse {
    HubcapAppStatusResponse {
        ok: false,
        status: status.into(),
        app_id: None,
        game_name: None,
        manifest_file_exists: None,
        auto_update_enabled: None,
        update_in_progress: None,
        file_size: None,
        file_modified: None,
        file_age_days: None,
        needs_update: None,
        update_reason: None,
        timestamp: None,
    }
}

#[tauri::command]
pub async fn hubcap_app_status(
    base_url: String,
    api_key: String,
    app_id: String,
) -> Result<HubcapAppStatusResponse, String> {
    if api_key.is_empty() {
        return Ok(empty_app_status("no_key"));
    }

    let base = base_url.trim_end_matches('/').to_string();
    let url = format!("{}/api/v1/status/{}", base, app_id);
    let client = build_client()?;

    match client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
    {
        Ok(response) => {
            let status_code = response.status().as_u16();
            match status_code {
                200 => match response.json::<serde_json::Value>().await {
                    Ok(json) => {
                        let obj = json.as_object().cloned().unwrap_or_default();

                        let status = parse_str_field(&obj, &["status"]);
                        let game_name = parse_str_field(&obj, &["game_name", "gameName"]);
                        let app_id_val = parse_str_field(&obj, &["app_id", "appId"]);
                        let manifest_file_exists = obj
                            .get("manifest_file_exists")
                            .or_else(|| obj.get("manifestFileExists"))
                            .and_then(|v| v.as_bool());
                        let auto_update_enabled = obj
                            .get("auto_update_enabled")
                            .or_else(|| obj.get("autoUpdateEnabled"))
                            .and_then(|v| v.as_bool());
                        let update_in_progress = obj
                            .get("update_in_progress")
                            .or_else(|| obj.get("updateInProgress"))
                            .and_then(|v| v.as_bool());
                        let file_size = parse_i64_field(&obj, &["file_size", "fileSize"]);
                        let file_modified = parse_str_field(&obj, &["file_modified", "fileModified"]);
                        let file_age_days = obj
                            .get("file_age_days")
                            .or_else(|| obj.get("fileAgeDays"))
                            .and_then(|v| v.as_f64());
                        let needs_update = obj
                            .get("needs_update")
                            .or_else(|| obj.get("needsUpdate"))
                            .and_then(|v| v.as_bool());
                        let update_reason = parse_str_field(&obj, &["update_reason", "updateReason"]);
                        let timestamp = parse_str_field(&obj, &["timestamp"]);

                        println!(
                            "[HUBCAP][APP_STATUS] appid={} status={} manifestExists={} updateInProgress={} needsUpdate={} fileModified={} fileSize={}",
                            app_id,
                            status.as_deref().unwrap_or("null"),
                            manifest_file_exists.map_or("null".into(), |v| v.to_string()),
                            update_in_progress.map_or("null".into(), |v| v.to_string()),
                            needs_update.map_or("null".into(), |v| v.to_string()),
                            file_modified.as_deref().unwrap_or("null"),
                            file_size.map_or(-1, |v| v),
                        );

                        Ok(HubcapAppStatusResponse {
                            ok: true,
                            status: status.unwrap_or_else(|| "unknown".into()),
                            app_id: app_id_val,
                            game_name,
                            manifest_file_exists,
                            auto_update_enabled,
                            update_in_progress,
                            file_size,
                            file_modified,
                            file_age_days,
                            needs_update,
                            update_reason,
                            timestamp,
                        })
                    }
                    Err(e) => {
                        println!(
                            "[HUBCAP][APP_STATUS] status=parse_error error=\"{}\"",
                            e
                        );
                        Ok(empty_app_status("parse_error"))
                    }
                },
                401 => {
                    println!("[HUBCAP][APP_STATUS] status=unauthorized appid={}", app_id);
                    Ok(empty_app_status("unauthorized"))
                }
                403 => {
                    println!("[HUBCAP][APP_STATUS] status=forbidden appid={}", app_id);
                    Ok(empty_app_status("forbidden"))
                }
                429 => {
                    println!("[HUBCAP][APP_STATUS] status=rate_limited");
                    Ok(empty_app_status("rate_limited"))
                }
                _ => {
                    println!(
                        "[HUBCAP][APP_STATUS] status=error http={}",
                        status_code
                    );
                    Ok(empty_app_status("error"))
                }
            }
        }
        Err(e) => {
            println!(
                "[HUBCAP][APP_STATUS] status=network_error error=\"{}\"",
                e
            );
            Ok(empty_app_status("network_error"))
        }
    }
}
