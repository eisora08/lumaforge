use std::time::Duration;

use crate::models::steam_app_metadata::SteamAppMetadata;

const DEBUG_STEAM_MEDIA: bool = false;

#[tauri::command]
pub fn resolve_steam_app_metadata(
    app_ids: Vec<u32>,
    language: Option<String>,
    country: Option<String>,
) -> Result<Vec<SteamAppMetadata>, String> {
    if app_ids.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("LumaForge/0.1.0")
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("[HTTP][TIMEOUT] Error creando cliente HTTP: {}", error))?;

    let mut output = Vec::new();

    for app_id in app_ids {
        let mut url = format!(
            "https://store.steampowered.com/api/appdetails?appids={}",
            app_id
        );
        if let Some(ref lang) = language {
            url.push_str(&format!("&l={}", lang));
        }
        if let Some(ref cc) = country {
            url.push_str(&format!("&cc={}", cc));
        }

        if DEBUG_STEAM_MEDIA && (language.is_some() || country.is_some()) {
            println!("[STORE][STEAM_MEDIA_FETCH] appid={} language={:?} country={:?} url={}", app_id, language, country, url);
        }

        let response = match client.get(&url).send() {
            Ok(value) => value,
            Err(_) => {
                output.push(fallback_metadata(app_id));
                continue;
            }
        };

        if !response.status().is_success() {
            output.push(fallback_metadata(app_id));
            continue;
        }

        let json: serde_json::Value = match response.json() {
            Ok(value) => value,
            Err(_) => {
                output.push(fallback_metadata(app_id));
                continue;
            }
        };

        let entry = match json.get(app_id.to_string()) {
            Some(value) => value,
            None => {
                output.push(fallback_metadata(app_id));
                continue;
            }
        };

        let success = entry
            .get("success")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);

        if !success {
            output.push(fallback_metadata(app_id));
            continue;
        }

        let data = match entry.get("data") {
            Some(value) => value,
            None => {
                output.push(fallback_metadata(app_id));
                continue;
            }
        };

        // Diagnostic: log available top-level keys to debug missing movies
        {
            let keys: Vec<String> = data.as_object()
                .map(|obj| obj.keys().cloned().collect())
                .unwrap_or_default();
            let has_movies = data.get("movies").is_some();
            let movies_count = data.get("movies")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let movies_names: String = data.get("movies")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| {
                            m.get("name").and_then(|n| n.as_str()).map(|s| format!("\"{}\"", s))
                        })
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            if DEBUG_STEAM_MEDIA {
                if has_movies {
                    println!("[STORE][STEAM_APPDETAILS_MOVIES] appid={} count={} names={}", app_id, movies_count, movies_names);
                    if language.is_some() || country.is_some() {
                        println!("[STORE][STEAM_MEDIA_FETCH_RESULT] appid={} language={:?} movies={} names={}", app_id, language, movies_count, movies_names);
                    }
                } else {
                    println!("[STORE][STEAM_APPDETAILS_KEYS] appid={} has_movies=false keys={:?}", app_id, keys);
                }
            }
        }

        let name = data
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        if name.is_empty() {
            output.push(fallback_metadata(app_id));
            continue;
        }

        let developer = data
            .get("developers")
            .and_then(|value| value.as_array())
            .and_then(|items| items.first())
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());

        let header_image = data
            .get("header_image")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());

        let capsule_image = data
            .get("capsule_image")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());

        let capsule_image_v5 = data
            .get("capsule_imagev5")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());

        let background_image = data
            .get("background")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());

        let platforms = parse_platforms(data);
        let languages = parse_languages(data);

        let dlc_array = data
            .get("dlc")
            .and_then(|value| value.as_array());

        let dlc_count = dlc_array
            .map(|items| items.len())
            .unwrap_or(0);

        let dlc_app_ids = dlc_array
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_u64().map(|id| id as u32))
                    .collect()
            })
            .unwrap_or_default();

        let short_description = data
            .get("short_description")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());

        let detailed_description = data
            .get("detailed_description")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());

        let about_the_game = data
            .get("about_the_game")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());

        let legal_notice = data
            .get("legal_notice")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());

        let genres = parse_genres(data);

        let publishers = data
            .get("publishers")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let release_date = data
            .get("release_date")
            .and_then(|value| value.get("date"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());

        let categories = data
            .get("categories")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        item.get("description")
                            .and_then(|desc| desc.as_str())
                            .map(|desc| desc.to_string())
                    })
                    .collect()
            })
            .unwrap_or_default();

        let pc_requirements = parse_requirements(data, "pc_requirements");
        let mac_requirements = parse_requirements(data, "mac_requirements");
        let linux_requirements = parse_requirements(data, "linux_requirements");

        let screenshots = data
            .get("screenshots")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|s| s.get("path_full").and_then(|u| u.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        use crate::models::steam_app_metadata::SteamMovie;
        let movies = data
            .get("movies")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| {
                        let id = m.get("id").and_then(|v| v.as_u64())?;
                        let name = m
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let thumbnail = m
                            .get("thumbnail")
                            .and_then(|v| v.as_str())
                            .map(String::from);
                        let highlight = m
                            .get("highlight")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let mp4 = m.get("mp4");
                        let webm = m.get("webm");
                        Some(SteamMovie {
                            id,
                            name,
                            thumbnail,
                            mp4_max: mp4
                                .and_then(|v| v.get("max"))
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            mp4_480: mp4
                                .and_then(|v| v.get("480"))
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            webm_max: webm
                                .and_then(|v| v.get("max"))
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            webm_480: webm
                                .and_then(|v| v.get("480"))
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            hls: m
                                .get("hls")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            hls_h264: m
                                .get("hls_h264")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            dash: m
                                .get("dash")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            dash_h264: m
                                .get("dash_h264")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            dash_av1: m
                                .get("dash_av1")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            highlight,
                        })
                    })
                    .collect::<Vec<SteamMovie>>()
            })
            .unwrap_or_default();

        let parsed_movies = movies.len();
        if parsed_movies > 0 && DEBUG_STEAM_MEDIA {
            let names: Vec<String> = movies.iter().map(|m| format!("\"{}\"", m.name.clone())).collect();
            println!("[STORE][MOVIES_PARSED] appid={} count={} names={}", app_id, parsed_movies, names.join(", "));
        }

        output.push(SteamAppMetadata {
            app_id,
            name,
            developer,
            header_image,
            capsule_image,
            capsule_image_v5,
            library_hero_image: None,
            background_image,
            hero_image: None,
            library_header_image: None,
            wide_cover_image: None,
            logo_image: None,
            library_logo_image: None,
            platforms,
            languages,
            dlc_count,
            short_description,
            detailed_description,
            about_the_game,
            legal_notice,
            store_drm_notice: None,
            genres,
            publishers,
            release_date,
            categories,
            dlc_app_ids,
            pc_requirements,
            mac_requirements,
            linux_requirements,
            screenshots,
            movies,
            resolved: true,
        });
    }

    output.sort_by_key(|item| item.app_id);

    Ok(output)
}

fn parse_genres(data: &serde_json::Value) -> Vec<String> {
    data.get("genres")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get("description")
                        .and_then(|desc| desc.as_str())
                        .map(|desc| desc.to_string())
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_requirements(
    data: &serde_json::Value,
    key: &str,
) -> Option<crate::models::steam_app_metadata::SystemRequirements> {
    let req = data.get(key)?;
    if !req.is_object() {
        return None;
    }
    let minimum = req
        .get("minimum")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let recommended = req
        .get("recommended")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    if minimum.is_none() && recommended.is_none() {
        return None;
    }
    Some(crate::models::steam_app_metadata::SystemRequirements {
        minimum,
        recommended,
    })
}

fn fallback_metadata(app_id: u32) -> SteamAppMetadata {
    SteamAppMetadata {
        app_id,
        name: format!("Steam App {}", app_id),
        developer: None,
        header_image: None,
        capsule_image: None,
        capsule_image_v5: None,
        library_hero_image: None,
        background_image: None,
        hero_image: None,
        library_header_image: None,
        wide_cover_image: None,
        logo_image: None,
        library_logo_image: None,
        platforms: Vec::new(),
        languages: Vec::new(),
        dlc_count: 0,
        short_description: None,
        detailed_description: None,
        about_the_game: None,
        legal_notice: None,
        store_drm_notice: None,
        genres: Vec::new(),
        publishers: Vec::new(),
        release_date: None,
        categories: Vec::new(),
        dlc_app_ids: Vec::new(),
        pc_requirements: None,
        mac_requirements: None,
        linux_requirements: None,
        screenshots: Vec::new(),
        movies: Vec::new(),
        resolved: false,
    }
}

#[tauri::command]
pub fn fetch_steam_store_drm_notice(
    app_id: u32,
) -> Result<Option<String>, String> {
    let url = format!(
        "https://store.steampowered.com/app/{}?l=english&cc=us",
        app_id
    );

    let client = reqwest::blocking::Client::builder()
        .user_agent("LumaForge/0.1.0")
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("[HTTP][CLIENT] Failed to build client: {}", e))?;

    let response = match client.get(&url).send() {
        Ok(r) => r,
        Err(e) => {
            println!("[STORE][DRM_HTML_FETCH] appid={} ok=false error=fetch-failed msg=\"{}\"", app_id, e);
            return Ok(None);
        }
    };

    if !response.status().is_success() {
        println!("[STORE][DRM_HTML_FETCH] appid={} ok=false error=http-{}", app_id, response.status().as_u16());
        return Ok(None);
    }

    let html = match response.text() {
        Ok(t) => t,
        Err(e) => {
            println!("[STORE][DRM_HTML_FETCH] appid={} ok=false error=read-failed msg=\"{}\"", app_id, e);
            return Ok(None);
        }
    };

    let notice = extract_drm_notice_from_html(&html);

    println!(
        "[STORE][DRM_HTML_FETCH] appid={} ok=true found={} notice=\"{}\"",
        app_id,
        notice.is_some(),
        notice.as_deref().unwrap_or("")
    );

    Ok(notice)
}

fn extract_drm_notice_from_html(html: &str) -> Option<String> {
    // Look for <div class="DRM_notice">...content...</div>
    let marker = "class=\"DRM_notice\"";
    let start = html.find(marker)?;

    // Find the opening > of the div tag that contains the marker
    let content_start = html[start..].find('>')? + start + 1;

    // Find the closing </div>
    let closing = html[content_start..].find("</div>")?;
    let raw = &html[content_start..content_start + closing];

    // Strip HTML tags (e.g. <br>)
    let mut notice = String::new();
    let mut in_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => notice.push(ch),
            _ => {}
        }
    }

    // Decode common HTML entities
    let decoded = notice
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");

    let trimmed = decoded.trim().to_string();

    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed)
}

fn parse_platforms(data: &serde_json::Value) -> Vec<String> {
    let mut platforms = Vec::new();

    let windows = data
        .get("platforms")
        .and_then(|platforms| platforms.get("windows"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    if windows {
        platforms.push("Windows".to_string());
    }

    let mac = data
        .get("platforms")
        .and_then(|platforms| platforms.get("mac"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    if mac {
        platforms.push("macOS".to_string());
    }

    let linux = data
        .get("platforms")
        .and_then(|platforms| platforms.get("linux"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    if linux {
        platforms.push("Linux".to_string());
    }

    platforms
}

fn parse_languages(data: &serde_json::Value) -> Vec<String> {
    let raw = data
        .get("supported_languages")
        .and_then(|value| value.as_str())
        .unwrap_or("");

    if raw.trim().is_empty() {
        return Vec::new();
    }

    let cleaned = strip_html(raw)
        .replace('*', "")
        .replace("languages with full audio support", "")
        .replace("Languages with full audio support", "")
        .replace('\r', "")
        .replace('\n', ",");

    cleaned
        .split(',')
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .take(8)
        .collect()
}

fn strip_html(input: &str) -> String {
    let mut output = String::new();
    let mut inside_tag = false;

    for character in input.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => output.push(character),
            _ => {}
        }
    }

    output
}