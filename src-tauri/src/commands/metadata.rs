use std::time::Duration;

use crate::models::steam_app_metadata::SteamAppMetadata;

#[tauri::command]
pub fn resolve_steam_app_metadata(
    app_ids: Vec<u32>,
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
        let url = format!(
            "https://store.steampowered.com/api/appdetails?appids={}",
            app_id
        );

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
            genres,
            publishers,
            release_date,
            categories,
            dlc_app_ids,
            pc_requirements,
            mac_requirements,
            linux_requirements,
            screenshots,
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
        genres: Vec::new(),
        publishers: Vec::new(),
        release_date: None,
        categories: Vec::new(),
        dlc_app_ids: Vec::new(),
        pc_requirements: None,
        mac_requirements: None,
        linux_requirements: None,
        screenshots: Vec::new(),
        resolved: false,
    }
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