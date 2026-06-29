use crate::models::steam_grid_db_artwork::SteamGridDbArtwork;

const BASE_URL: &str = "https://www.steamgriddb.com/api/v2";
const USER_AGENT: &str = "LumaForge/0.1.0";
const REQUEST_TIMEOUT_SECS: u64 = 15;

#[tauri::command]
pub fn resolve_steamgriddb_artwork(
    app_ids: Vec<u32>,
    api_key: String,
) -> Result<Vec<SteamGridDbArtwork>, String> {
    if app_ids.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {}", error))?;

    let mut results = Vec::new();

    for app_id in app_ids {
        let artwork = resolve_single(&client, &api_key, app_id);
        results.push(artwork);
    }

    Ok(results)
}

fn resolve_single(
    client: &reqwest::blocking::Client,
    api_key: &str,
    app_id: u32,
) -> SteamGridDbArtwork {
    let game_id = match resolve_game_id(client, api_key, app_id) {
        Some(id) => id,
        None => {
            return SteamGridDbArtwork {
                app_id,
                grid_url: None,
                grid_thumb_url: None,
                hero_url: None,
                logo_url: None,
                icon_url: None,
            };
        }
    };

    let (grid_url, grid_thumb_url) = fetch_best_grid(client, api_key, game_id);
    let hero_url = fetch_first_hero(client, api_key, game_id);
    let logo_url = fetch_first_logo(client, api_key, game_id);
    let icon_url = fetch_first_icon(client, api_key, game_id);

    SteamGridDbArtwork {
        app_id,
        grid_url,
        grid_thumb_url,
        hero_url,
        logo_url,
        icon_url,
    }
}

fn resolve_game_id(
    client: &reqwest::blocking::Client,
    api_key: &str,
    app_id: u32,
) -> Option<u32> {
    let url = format!("{}/games/steam/{}", BASE_URL, app_id);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let json: serde_json::Value = response.json().ok()?;

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

/// Fetch grids for a game, preferring 600×900 poster grids.
/// Prefers static (non-animated) images.
/// Returns (best_url, best_thumb_url).
fn fetch_best_grid(
    client: &reqwest::blocking::Client,
    api_key: &str,
    game_id: u32,
) -> (Option<String>, Option<String>) {
    let url = format!("{}/grids/game/{}?dimensions=600x900", BASE_URL, game_id);

    let response = match client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
    {
        Ok(resp) if resp.status().is_success() => resp,
        _ => return (None, None),
    };

    let json: serde_json::Value = match response.json() {
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

fn fetch_first_hero(
    client: &reqwest::blocking::Client,
    api_key: &str,
    game_id: u32,
) -> Option<String> {
    let url = format!("{}/heroes/game/{}", BASE_URL, game_id);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let json: serde_json::Value = response.json().ok()?;

    let heroes = json.get("data")?.as_array()?;

    // Prefer static hero image
    let chosen = heroes.iter().find(|h| {
        h.get("animated").and_then(|a| a.as_bool()).unwrap_or(false) == false
    }).or_else(|| heroes.first());

    chosen?.get("url")?.as_str().map(|s| s.to_string())
}

fn fetch_first_logo(
    client: &reqwest::blocking::Client,
    api_key: &str,
    game_id: u32,
) -> Option<String> {
    let url = format!("{}/logos/game/{}", BASE_URL, game_id);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let json: serde_json::Value = response.json().ok()?;

    let logos = json.get("data")?.as_array()?;

    // Prefer static logo
    let chosen = logos.iter().find(|l| {
        l.get("animated").and_then(|a| a.as_bool()).unwrap_or(false) == false
    }).or_else(|| logos.first());

    chosen?.get("url")?.as_str().map(|s| s.to_string())
}

fn fetch_first_icon(
    client: &reqwest::blocking::Client,
    api_key: &str,
    game_id: u32,
) -> Option<String> {
    let url = format!("{}/icons/game/{}", BASE_URL, game_id);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let json: serde_json::Value = response.json().ok()?;

    let icons = json.get("data")?.as_array()?;

    // Prefer static icon
    let chosen = icons.iter().find(|i| {
        i.get("animated").and_then(|a| a.as_bool()).unwrap_or(false) == false
    }).or_else(|| icons.first());

    chosen?.get("url")?.as_str().map(|s| s.to_string())
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
            hero_url: Some("https://example.com/hero.jpg".into()),
            logo_url: Some("https://example.com/logo.png".into()),
            icon_url: Some("https://example.com/icon.png".into()),
        };
        assert_eq!(artwork.app_id, 12345);
        assert_eq!(artwork.logo_url, Some("https://example.com/logo.png".into()));
    }
}
