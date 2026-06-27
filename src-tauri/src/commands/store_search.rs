use std::time::Duration;

use crate::models::steam_store_search::SteamStoreSearchItem;

#[tauri::command]
pub fn resolve_steam_store_search(
    term: String,
    country_code: Option<String>,
    language: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<SteamStoreSearchItem>, String> {
    let trimmed_term = term.trim();

    if trimmed_term.len() < 2 {
        return Ok(Vec::new());
    }

    let mut url = reqwest::Url::parse("https://store.steampowered.com/search/suggest")
        .map_err(|error| format!("URL inválida: {}", error))?;

    {
        let mut pairs = url.query_pairs_mut();

        pairs.append_pair("term", trimmed_term);
        pairs.append_pair("f", "games");

        if let Some(country_code) = country_code {
            let trimmed = country_code.trim();

            if !trimmed.is_empty() {
                pairs.append_pair("cc", trimmed);
            }
        }

        if let Some(language) = language {
            let trimmed = language.trim();

            if !trimmed.is_empty() {
                pairs.append_pair("l", trimmed);
            }
        }
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("LumaForge/0.1.0")
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(6))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("Error creando cliente HTTP: {}", error))?;

    let response = client
        .get(url)
        .send()
        .map_err(|error| format!("Error consultando Steam Search: {}", error))?;

    if !response.status().is_success() {
        return Err(format!(
            "Steam Search respondió con estado {}",
            response.status()
        ));
    }

    let json: serde_json::Value = response
        .json()
        .map_err(|error| format!("Error leyendo respuesta de Steam Search: {}", error))?;

    let max_results = limit.unwrap_or(8).clamp(1, 20);
    let mut items = Vec::new();

    if let Some(array) = json.as_array() {
        for value in array.iter().take(max_results) {
            if let Some(item) = parse_search_item(value) {
                items.push(item);
            }
        }

        return Ok(items);
    }

    if let Some(array) = json.get("results").and_then(|value| value.as_array()) {
        for value in array.iter().take(max_results) {
            if let Some(item) = parse_search_item(value) {
                items.push(item);
            }
        }

        return Ok(items);
    }

    Ok(Vec::new())
}

fn parse_search_item(value: &serde_json::Value) -> Option<SteamStoreSearchItem> {
    let app_id = value
        .get("id")
        .or_else(|| value.get("appid"))
        .or_else(|| value.get("app_id"))
        .and_then(|value| {
            if let Some(number) = value.as_u64() {
                return Some(number as u32);
            }

            value.as_str()?.parse::<u32>().ok()
        })?;

    let name = value
        .get("name")
        .or_else(|| value.get("title"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if name.is_empty() {
        return None;
    }

    let image_url = value
        .get("img")
        .or_else(|| value.get("image"))
        .or_else(|| value.get("header_image"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    let price_label = value
        .get("price")
        .or_else(|| value.get("price_label"))
        .and_then(|value| value.as_str())
        .map(clean_html_text);

    let discount_label = value
        .get("discount")
        .or_else(|| value.get("discount_label"))
        .and_then(|value| value.as_str())
        .map(clean_html_text);

    Some(SteamStoreSearchItem {
        app_id,
        name,
        image_url,
        price_label,
        discount_label,
    })
}

fn clean_html_text(input: &str) -> String {
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

    output.trim().to_string()
}