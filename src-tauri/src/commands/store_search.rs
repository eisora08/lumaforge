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

    let max_results = limit.unwrap_or(8).clamp(1, 20);

    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 LumaForge/0.1.0")
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(6))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("Error creando cliente HTTP: {}", error))?;

    let suggest_items = fetch_search_suggest(
        &client,
        trimmed_term,
        country_code.as_deref(),
        language.as_deref(),
        max_results,
    );

    if let Ok(items) = suggest_items {
        if !items.is_empty() {
            return Ok(items);
        }
    }

    fetch_search_results_html(
        &client,
        trimmed_term,
        country_code.as_deref(),
        language.as_deref(),
        max_results,
    )
}

fn fetch_search_suggest(
    client: &reqwest::blocking::Client,
    term: &str,
    country_code: Option<&str>,
    language: Option<&str>,
    max_results: usize,
) -> Result<Vec<SteamStoreSearchItem>, String> {
    let mut url = reqwest::Url::parse("https://store.steampowered.com/search/suggest")
        .map_err(|error| format!("URL inválida: {}", error))?;

    {
        let mut pairs = url.query_pairs_mut();

        pairs.append_pair("term", term);
        pairs.append_pair("f", "games");

        if let Some(country_code) = country_code {
            if !country_code.trim().is_empty() {
                pairs.append_pair("cc", country_code.trim());
            }
        }

        if let Some(language) = language {
            if !language.trim().is_empty() {
                pairs.append_pair("l", language.trim());
            }
        }
    }

    let response = client
        .get(url)
        .send()
        .map_err(|error| format!("Error consultando Steam Search Suggest: {}", error))?;

    if !response.status().is_success() {
        return Err(format!(
            "Steam Search Suggest respondió con estado {}",
            response.status()
        ));
    }

    let text = response
        .text()
        .map_err(|error| format!("Error leyendo Steam Search Suggest: {}", error))?;

    parse_suggest_response(&text, max_results)
}

fn parse_suggest_response(
    text: &str,
    max_results: usize,
) -> Result<Vec<SteamStoreSearchItem>, String> {
    let json: serde_json::Value = match serde_json::from_str(text) {
        Ok(value) => value,
        Err(_) => {
            return Ok(parse_search_html(text, max_results));
        }
    };

    let mut items = Vec::new();

    if let Some(array) = json.as_array() {
        for value in array.iter().take(max_results) {
            if let Some(item) = parse_json_search_item(value) {
                items.push(item);
            }
        }

        return Ok(items);
    }

    if let Some(array) = json.get("results").and_then(|value| value.as_array()) {
        for value in array.iter().take(max_results) {
            if let Some(item) = parse_json_search_item(value) {
                items.push(item);
            }
        }

        return Ok(items);
    }

    if let Some(html) = json
        .get("html")
        .or_else(|| json.get("results_html"))
        .and_then(|value| value.as_str())
    {
        return Ok(parse_search_html(html, max_results));
    }

    Ok(Vec::new())
}
fn fetch_search_results_html(
    client: &reqwest::blocking::Client,
    term: &str,
    country_code: Option<&str>,
    language: Option<&str>,
    max_results: usize,
) -> Result<Vec<SteamStoreSearchItem>, String> {
    let mut url = reqwest::Url::parse("https://store.steampowered.com/search/results/")
        .map_err(|error| format!("URL inválida: {}", error))?;

    {
        let mut pairs = url.query_pairs_mut();

        pairs.append_pair("term", term);
        pairs.append_pair("query", term);
        pairs.append_pair("start", "0");
        pairs.append_pair("count", &max_results.to_string());
        pairs.append_pair("dynamic_data", "");
        pairs.append_pair("sort_by", "_ASC");
        pairs.append_pair("infinite", "1");
        pairs.append_pair("category1", "998");

        if let Some(country_code) = country_code {
            if !country_code.trim().is_empty() {
                pairs.append_pair("cc", country_code.trim());
            }
        }

        if let Some(language) = language {
            if !language.trim().is_empty() {
                pairs.append_pair("l", language.trim());
            }
        }
    }

    let response = client
        .get(url)
        .send()
        .map_err(|error| format!("Error consultando Steam Search Results: {}", error))?;

    if !response.status().is_success() {
        return Err(format!(
            "Steam Search Results respondió con estado {}",
            response.status()
        ));
    }

    let text = response
        .text()
        .map_err(|error| format!("Error leyendo Steam Search Results: {}", error))?;

    let json: serde_json::Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(_) => return Ok(parse_search_html(&text, max_results)),
    };

    if let Some(html) = json
        .get("results_html")
        .or_else(|| json.get("html"))
        .and_then(|value| value.as_str())
    {
        return Ok(parse_search_html(html, max_results));
    }

    Ok(parse_search_html(&text, max_results))
}

fn parse_json_search_item(value: &serde_json::Value) -> Option<SteamStoreSearchItem> {
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
        .map(clean_html_text)
        .filter(|value| !value.is_empty());

    let discount_label = value
        .get("discount")
        .or_else(|| value.get("discount_label"))
        .and_then(|value| value.as_str())
        .map(clean_html_text)
        .filter(|value| !value.is_empty());

    Some(SteamStoreSearchItem {
        app_id,
        name,
        image_url,
        price_label,
        discount_label,
    })
}

fn parse_search_html(html: &str, max_results: usize) -> Vec<SteamStoreSearchItem> {
    let mut items = Vec::new();

    for segment in html.split("data-ds-appid=\"").skip(1) {
        if items.len() >= max_results {
            break;
        }

        let app_id_raw = match segment.split('"').next() {
            Some(value) => value,
            None => continue,
        };

        let app_id = match app_id_raw
            .split(',')
            .next()
            .and_then(|value| value.parse::<u32>().ok())
        {
            Some(value) => value,
            None => continue,
        };

        let name = extract_between(segment, "<span class=\"title\">", "</span>")
            .map(clean_html_text)
            .unwrap_or_default();

        if name.is_empty() {
            continue;
        }

        let image_url = extract_image_url(segment);

        let discount_label = extract_between(
            segment,
            "<div class=\"col search_discount responsive_secondrow\">",
            "</div>",
        )
        .or_else(|| extract_between(segment, "<div class=\"col search_discount\">", "</div>"))
        .map(clean_html_text)
        .filter(|value| !value.is_empty());

        let price_label = extract_between(
            segment,
            "<div class=\"col search_price responsive_secondrow\">",
            "</div>",
        )
        .or_else(|| extract_between(segment, "<div class=\"col search_price discounted responsive_secondrow\">", "</div>"))
        .or_else(|| extract_between(segment, "<div class=\"col search_price\">", "</div>"))
        .map(clean_html_text)
        .filter(|value| !value.is_empty());

        items.push(SteamStoreSearchItem {
            app_id,
            name,
            image_url,
            price_label,
            discount_label,
        });
    }

    items
}

fn extract_image_url(segment: &str) -> Option<String> {
    let img_segment = segment.split("<img").nth(1)?;

    extract_between(img_segment, "src=\"", "\"")
        .map(|value| value.to_string())
        .filter(|value| !value.is_empty())
}

fn extract_between<'a>(input: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let start_index = input.find(start)? + start.len();
    let rest = &input[start_index..];
    let end_index = rest.find(end)?;

    Some(&rest[..end_index])
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

    output
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
        .trim()
        .to_string()
}