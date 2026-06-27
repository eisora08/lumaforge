use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use crate::models::installed_lua_script::InstalledLuaScript;

#[tauri::command]
pub fn scan_installed_lua_scripts(
    lua_path: String,
) -> Result<Vec<InstalledLuaScript>, String> {
    if lua_path.trim().is_empty() {
        return Err("La ruta config/lua está vacía.".to_string());
    }

    let lua_dir = Path::new(&lua_path);

    if !lua_dir.exists() {
        return Ok(Vec::new());
    }

    if !lua_dir.is_dir() {
        return Err("La ruta config/lua no es una carpeta válida.".to_string());
    }

    let entries = fs::read_dir(lua_dir)
        .map_err(|error| format!("No se pudo leer config/lua: {}", error))?;

    let mut scripts = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let file_name = match path.file_name().and_then(|value| value.to_str()) {
            Some(value) => value.to_string(),
            None => continue,
        };

        let app_id = match parse_lua_app_id(&file_name) {
            Some(value) => value,
            None => continue,
        };

        let metadata = match fs::metadata(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);

        scripts.push(InstalledLuaScript {
            app_id,
            file_name: file_name.clone(),
            path: path.to_string_lossy().to_string(),
            is_disabled: file_name.ends_with(".lua.disabled"),
            file_size: metadata.len(),
            modified_at,
        });
    }

    scripts.sort_by_key(|script| script.app_id);

    Ok(scripts)
}

fn parse_lua_app_id(file_name: &str) -> Option<u32> {
    let raw_app_id = if file_name.ends_with(".lua.disabled") {
        file_name.trim_end_matches(".lua.disabled")
    } else if file_name.ends_with(".lua") {
        file_name.trim_end_matches(".lua")
    } else {
        return None;
    };

    if raw_app_id.is_empty() || !raw_app_id.chars().all(|char| char.is_ascii_digit()) {
        return None;
    }

    raw_app_id.parse::<u32>().ok()
}