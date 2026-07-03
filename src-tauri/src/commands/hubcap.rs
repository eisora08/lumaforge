use std::time::Duration;
use std::time::Instant;

use crate::models::hubcap::{
    HubcapDepotKeysResponse, HubcapHealthResponse, HubcapUserStatsResponse,
};

fn build_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("LumaForge/0.1.0")
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(10))
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
pub fn hubcap_health(base_url: String) -> Result<HubcapHealthResponse, String> {
    let start = Instant::now();
    let base = base_url.trim_end_matches('/').to_string();
    let url = format!("{}/api/v1/health", base);
    let client = build_client()?;

    match client.get(&url).send() {
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
pub fn hubcap_user_stats(
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
    {
        Ok(response) => {
            let status_code = response.status().as_u16();
            match status_code {
                200 => match response.json::<serde_json::Value>() {
                    Ok(json) => {
                        println!("[HUBCAP][USER_STATS] status=ok");
                        let obj = json.as_object().cloned().unwrap_or_default();

                        let today_usage = parse_i64_field(&obj, &[
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
pub fn hubcap_depot_keys(
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
    {
        Ok(response) => {
            let status_code = response.status().as_u16();
            match status_code {
                200 => {
                    let count = response
                        .json::<serde_json::Value>()
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
