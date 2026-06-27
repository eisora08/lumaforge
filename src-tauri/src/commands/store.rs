use std::time::Duration;

use crate::models::steam_featured::{SteamFeaturedCategory, SteamFeaturedItem};

#[tauri::command]
pub fn resolve_steam_featured_categories(
    country_code: Option<String>,
    language: Option<String>,
) -> Result<Vec<SteamFeaturedCategory>, String> {
    let mut url = "https://store.steampowered.com/api/featuredcategories".to_string();

    let mut query_parts: Vec<String> = Vec::new();

    if let Some(country_code) = country_code {
        let trimmed = country_code.trim();

        if !trimmed.is_empty() {
            query_parts.push(format!("cc={}", trimmed));
        }
    }

    if let Some(language) = language {
        let trimmed = language.trim();

        if !trimmed.is_empty() {
            query_parts.push(format!("l={}", trimmed));
        }
    }

    if !query_parts.is_empty() {
        url.push('?');
        url.push_str(&query_parts.join("&"));
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("LumaForge/0.1.0")
        .timeout(Duration::from_secs(12))
        .connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("Error creando cliente HTTP: {}", error))?;

    let response = client
        .get(&url)
        .send()
        .map_err(|error| format!("Error consultando Steam Store: {}", error))?;

    if !response.status().is_success() {
        return Err(format!(
            "Steam Store respondió con estado {}",
            response.status()
        ));
    }

    let json: serde_json::Value = response
        .json()
        .map_err(|error| format!("Error leyendo respuesta de Steam Store: {}", error))?;

    let object = json
        .as_object()
        .ok_or_else(|| "Respuesta inválida de Steam Store.".to_string())?;

    let mut categories = Vec::new();

    for (key, value) in object {
        let category_object = match value.as_object() {
            Some(value) => value,
            None => continue,
        };

        let items = match category_object.get("items").and_then(|value| value.as_array()) {
            Some(value) => value,
            None => continue,
        };

        if items.is_empty() {
            continue;
        }

        let name = category_object
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or(key)
            .to_string();

        let mapped_items = items
            .iter()
            .filter_map(parse_featured_item)
            .collect::<Vec<SteamFeaturedItem>>();

        if mapped_items.is_empty() {
            continue;
        }

        categories.push(SteamFeaturedCategory {
            id: key.to_string(),
            name,
            items: mapped_items,
        });
    }

    categories.sort_by_key(|category| category_priority(&category.id));

    Ok(categories)
}

fn category_priority(id: &str) -> u8 {
    match id {
        "specials" => 0,
        "top_sellers" => 1,
        "new_releases" => 2,
        "coming_soon" => 3,
        _ => 10,
    }
}

fn parse_featured_item(value: &serde_json::Value) -> Option<SteamFeaturedItem> {
    let app_id = value
        .get("id")
        .or_else(|| value.get("appid"))
        .and_then(|value| value.as_u64())? as u32;

    let item_type = value
        .get("type")
        .and_then(|value| value.as_i64())
        .unwrap_or(0);

    if item_type != 0 {
        return None;
    }

    let name = value
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if name.is_empty() {
        return None;
    }

    let header_image = value
        .get("header_image")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    let large_capsule_image = value
        .get("large_capsule_image")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    let small_capsule_image = value
        .get("small_capsule_image")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    let discounted = value
        .get("discounted")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let discount_percent = value
        .get("discount_percent")
        .and_then(|value| value.as_i64());

    let original_price = value
        .get("original_price")
        .and_then(|value| value.as_i64());

    let final_price = value
        .get("final_price")
        .and_then(|value| value.as_i64());

    let currency = value
        .get("currency")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    let platforms = parse_platforms(value);

    Some(SteamFeaturedItem {
        app_id,
        name,
        header_image,
        large_capsule_image,
        small_capsule_image,
        discounted,
        discount_percent,
        original_price,
        final_price,
        currency,
        platforms,
    })
}

fn parse_platforms(value: &serde_json::Value) -> Vec<String> {
    let mut platforms = Vec::new();

    if value
        .get("windows_available")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        platforms.push("Windows".to_string());
    }

    if value
        .get("mac_available")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        platforms.push("macOS".to_string());
    }

    if value
        .get("linux_available")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        platforms.push("Linux".to_string());
    }

    platforms
}