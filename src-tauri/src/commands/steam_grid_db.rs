use crate::models::steam_grid_db_artwork::{SteamGridDbArtwork, SteamGridDbGameSearchResult};

const BASE_URL: &str = "https://www.steamgriddb.com/api/v2";
const USER_AGENT: &str = "LumaForge/0.1.0";
const REQUEST_TIMEOUT_SECS: u64 = 15;

#[tauri::command]
pub async fn resolve_steamgriddb_artwork(
    app_ids: Vec<u32>,
    api_key: String,
) -> Result<Vec<SteamGridDbArtwork>, String> {
    if app_ids.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .connect_timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {}", error))?;

    let mut results = Vec::new();

    for app_id in app_ids {
        let artwork = resolve_single(&client, &api_key, app_id).await;
        results.push(artwork);
    }

    Ok(results)
}

/// Search SteamGridDB by game name — for manual games without a Steam App ID.
/// Uses the SGDB `/search/autocomplete/{term}` endpoint (NOT `/games/search/`).
/// Response: { "data": [{ "id": 2254, "name": "Half-Life 2", "types": ["steam"], "verified": true }] }
#[tauri::command]
pub async fn search_steamgriddb_games(
    name: String,
    api_key: String,
) -> Result<Vec<SteamGridDbGameSearchResult>, String> {
    if name.trim().is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .connect_timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {}", error))?;

    let encoded_name = urlencoding::encode(&name);
    let url = format!("{}/search/autocomplete/{}", BASE_URL, encoded_name);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|error| format!("SGDB search request failed: {}", error))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        let snippet = if body.contains("<!DOCTYPE") || body.contains("<html") {
            format!("(HTML response, status {})", status)
        } else {
            truncate_str(&body, 200)
        };
        return Err(format!("SGDB search failed ({}) {}", status, snippet));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("SGDB search response is not valid JSON: {}", error))?;

    let data = match json.get("data").and_then(|d| d.as_array()) {
        Some(arr) => arr,
        None => return Ok(Vec::new()),
    };

    let results: Vec<SteamGridDbGameSearchResult> = data
        .iter()
        .map(|game| {
            SteamGridDbGameSearchResult {
                sgdb_game_id: game.get("id").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                name: game.get("name").and_then(|v| v.as_str()).map(String::from),
                release_date: game.get("release_date").and_then(|v| v.as_str()).map(String::from),
                image_url: game.get("image").and_then(|v| v.as_str()).map(String::from),
            }
        })
        .collect();

    Ok(results)
}

/// Fetch artwork by SGDB internal game ID — for manual games selected via name search.
/// Same artwork endpoints as resolve_single but skips the Steam App ID → game ID resolution.
#[tauri::command]
pub async fn resolve_steamgriddb_artwork_by_game_id(
    sgdb_game_id: u32,
    api_key: String,
) -> Result<SteamGridDbArtwork, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .connect_timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {}", error))?;

    let (grid_url, grid_thumb_url) = fetch_best_vertical_grid(&client, &api_key, sgdb_game_id).await;
    let (grid_horizontal_url, grid_horizontal_thumb_url) = fetch_best_horizontal_grid(&client, &api_key, sgdb_game_id).await;
    let hero_url = fetch_first_hero(&client, &api_key, sgdb_game_id).await;
    let logo_url = fetch_first_logo(&client, &api_key, sgdb_game_id).await;
    let icon_url = fetch_first_icon(&client, &api_key, sgdb_game_id).await;

    Ok(SteamGridDbArtwork {
        app_id: sgdb_game_id,
        grid_url,
        grid_thumb_url,
        grid_horizontal_url,
        grid_horizontal_thumb_url,
        hero_url,
        logo_url,
        icon_url,
    })
}

async fn resolve_single(
    client: &reqwest::Client,
    api_key: &str,
    app_id: u32,
) -> SteamGridDbArtwork {
    let game_id = match resolve_game_id(client, api_key, app_id).await {
        Some(id) => id,
        None => {
            return SteamGridDbArtwork {
                app_id,
                grid_url: None,
                grid_thumb_url: None,
                grid_horizontal_url: None,
                grid_horizontal_thumb_url: None,
                hero_url: None,
                logo_url: None,
                icon_url: None,
            };
        }
    };

    let (grid_url, grid_thumb_url) = fetch_best_vertical_grid(client, api_key, game_id).await;
    let (grid_horizontal_url, grid_horizontal_thumb_url) = fetch_best_horizontal_grid(client, api_key, game_id).await;
    let hero_url = fetch_first_hero(client, api_key, game_id).await;
    let logo_url = fetch_first_logo(client, api_key, game_id).await;
    let icon_url = fetch_first_icon(client, api_key, game_id).await;

    SteamGridDbArtwork {
        app_id,
        grid_url,
        grid_thumb_url,
        grid_horizontal_url,
        grid_horizontal_thumb_url,
        hero_url,
        logo_url,
        icon_url,
    }
}

async fn resolve_game_id(
    client: &reqwest::Client,
    api_key: &str,
    app_id: u32,
) -> Option<u32> {
    let url = format!("{}/games/steam/{}", BASE_URL, app_id);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let json: serde_json::Value = response.json().await.ok()?;

    json.get("data")
        .and_then(|data| {
            if data.is_array() {
                data.as_array()?.first()?.get("id")?.as_u64()
            } else {
                data.get("id")?.as_u64()
            }
        })
        .map(|id| id as u32)
}

/// Fetch vertical/poster grids (600×900) for cover images.
/// Prefers static (non-animated) images.
/// Returns (best_url, best_thumb_url).
async fn fetch_best_vertical_grid(
    client: &reqwest::Client,
    api_key: &str,
    game_id: u32,
) -> (Option<String>, Option<String>) {
    let url = format!("{}/grids/game/{}?dimensions=600x900", BASE_URL, game_id);

    let response = match client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => resp,
        _ => return (None, None),
    };

    let json: serde_json::Value = match response.json().await {
        Ok(v) => v,
        Err(_) => return (None, None),
    };

    let grids = match json.get("data").and_then(|d| d.as_array()) {
        Some(arr) => arr,
        None => return (None, None),
    };

    // Prefer static image; fall back to first if none found
    let chosen = grids.iter().find(|g| {
        g.get("animated").and_then(|a| a.as_bool()).unwrap_or(false) == false
    }).or_else(|| grids.first());

    let chosen = match chosen {
        Some(g) => g,
        None => return (None, None),
    };

    let url = chosen
        .get("url")
        .and_then(|v| v.as_str())
        .map(String::from);
    let thumb = chosen
        .get("thumb")
        .and_then(|v| v.as_str())
        .map(String::from);

    (url, thumb)
}

/// Fetch horizontal/landscape grids (aspect ratio >= 1.30) for landscape images.
/// Does NOT filter by dimensions — fetches all grids and picks the best horizontal one.
/// Prefers static (non-animated) images.
/// Returns (best_url, best_thumb_url).
async fn fetch_best_horizontal_grid(
    client: &reqwest::Client,
    api_key: &str,
    game_id: u32,
) -> (Option<String>, Option<String>) {
    let url = format!("{}/grids/game/{}", BASE_URL, game_id);

    let response = match client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => resp,
        _ => return (None, None),
    };

    let json: serde_json::Value = match response.json().await {
        Ok(v) => v,
        Err(_) => return (None, None),
    };

    let grids = match json.get("data").and_then(|d| d.as_array()) {
        Some(arr) => arr,
        None => return (None, None),
    };

    // Find static horizontal grids (aspect >= 1.30)
    let horizontal: Vec<&serde_json::Value> = grids.iter()
        .filter(|g| {
            let animated = g.get("animated").and_then(|a| a.as_bool()).unwrap_or(false);
            if animated { return false; }
            let w = g.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as f64;
            let h = g.get("height").and_then(|v| v.as_u64()).unwrap_or(1) as f64;
            if h == 0.0 { return false; }
            let aspect = w / h;
            aspect >= 1.30
        })
        .collect();

    if horizontal.is_empty() {
        return (None, None);
    }

    // Pick the one with largest width (highest quality)
    let chosen = horizontal.iter().max_by_key(|g| {
        g.get("width").and_then(|v| v.as_u64()).unwrap_or(0)
    });

    let chosen = match chosen {
        Some(g) => g,
        None => return (None, None),
    };

    let url = chosen
        .get("url")
        .and_then(|v| v.as_str())
        .map(String::from);
    let thumb = chosen
        .get("thumb")
        .and_then(|v| v.as_str())
        .map(String::from);

    (url, thumb)
}

async fn fetch_first_hero(
    client: &reqwest::Client,
    api_key: &str,
    game_id: u32,
) -> Option<String> {
    let url = format!("{}/heroes/game/{}", BASE_URL, game_id);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let json: serde_json::Value = response.json().await.ok()?;

    let heroes = json.get("data")?.as_array()?;

    // Prefer static hero image
    let chosen = heroes.iter().find(|h| {
        h.get("animated").and_then(|a| a.as_bool()).unwrap_or(false) == false
    }).or_else(|| heroes.first());

    chosen?.get("url")?.as_str().map(|s| s.to_string())
}

async fn fetch_first_logo(
    client: &reqwest::Client,
    api_key: &str,
    game_id: u32,
) -> Option<String> {
    let url = format!("{}/logos/game/{}", BASE_URL, game_id);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let json: serde_json::Value = response.json().await.ok()?;

    let logos = json.get("data")?.as_array()?;

    // Prefer static logo
    let chosen = logos.iter().find(|l| {
        l.get("animated").and_then(|a| a.as_bool()).unwrap_or(false) == false
    }).or_else(|| logos.first());

    chosen?.get("url")?.as_str().map(|s| s.to_string())
}

async fn fetch_first_icon(
    client: &reqwest::Client,
    api_key: &str,
    game_id: u32,
) -> Option<String> {
    let url = format!("{}/icons/game/{}", BASE_URL, game_id);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let json: serde_json::Value = response.json().await.ok()?;

    let icons = json.get("data")?.as_array()?;

    // Prefer static icon
    let chosen = icons.iter().find(|i| {
        i.get("animated").and_then(|a| a.as_bool()).unwrap_or(false) == false
    }).or_else(|| icons.first());

    chosen?.get("url")?.as_str().map(|s| s.to_string())
}

fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}…", &s[..max_len])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_steam_grid_db_types() {
        let artwork = SteamGridDbArtwork {
            app_id: 12345,
            grid_url: Some("https://example.com/grid.jpg".into()),
            grid_thumb_url: Some("https://example.com/thumb.jpg".into()),
            grid_horizontal_url: Some("https://example.com/grid-h.jpg".into()),
            grid_horizontal_thumb_url: Some("https://example.com/thumb-h.jpg".into()),
            hero_url: Some("https://example.com/hero.jpg".into()),
            logo_url: Some("https://example.com/logo.png".into()),
            icon_url: Some("https://example.com/icon.png".into()),
        };
        assert_eq!(artwork.app_id, 12345);
        assert_eq!(artwork.logo_url, Some("https://example.com/logo.png".into()));
        assert_eq!(artwork.grid_horizontal_url, Some("https://example.com/grid-h.jpg".into()));
    }
}
