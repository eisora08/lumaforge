use std::collections::HashMap;

use crate::models::game_name::GameNameResult;

#[tauri::command]
pub fn resolve_steam_app_names(app_ids: Vec<u32>) -> Result<Vec<GameNameResult>, String> {
    if app_ids.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("LumaForge/0.1.0")
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("Error creando cliente HTTP: {}", error))?;

    let mut results: HashMap<u32, GameNameResult> = HashMap::new();

    for app_id in app_ids {
        let url = format!(
            "https://store.steampowered.com/api/appdetails?appids={}",
            app_id
        );

        let response = client
            .get(&url)
            .send()
            .map_err(|error| format!("Error consultando Steam para {}: {}", app_id, error))?;

        if !response.status().is_success() {
            results.insert(
                app_id,
                GameNameResult {
                    app_id,
                    name: format!("Steam App {}", app_id),
                    resolved: false,
                },
            );

            continue;
        }

        let json: serde_json::Value = response
            .json()
            .map_err(|error| format!("Error leyendo respuesta de Steam: {}", error))?;

        let entry = json.get(app_id.to_string());

        let name = entry
            .and_then(|value| value.get("data"))
            .and_then(|data| data.get("name"))
            .and_then(|name| name.as_str())
            .map(|name| name.trim().to_string());

        match name {
            Some(name) if !name.is_empty() => {
                results.insert(
                    app_id,
                    GameNameResult {
                        app_id,
                        name,
                        resolved: true,
                    },
                );
            }
            _ => {
                results.insert(
                    app_id,
                    GameNameResult {
                        app_id,
                        name: format!("Steam App {}", app_id),
                        resolved: false,
                    },
                );
            }
        }
    }

    let mut output: Vec<GameNameResult> = results.into_values().collect();
    output.sort_by_key(|item| item.app_id);

    Ok(output)
}