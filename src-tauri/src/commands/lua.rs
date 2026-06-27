use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::models::installed_lua_script::InstalledLuaScript;
use crate::models::lua_action_result::LuaActionResult;

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

#[tauri::command]
pub fn set_lua_script_enabled(
    lua_path: String,
    file_name: String,
    enabled: bool,
) -> Result<LuaActionResult, String> {
    let lua_dir = validate_lua_dir(&lua_path)?;
    validate_lua_file_name(&file_name)?;

    let current_path = lua_dir.join(&file_name);

    if !current_path.exists() {
        return Err("El archivo Lua no existe.".to_string());
    }

    let app_id = parse_lua_app_id(&file_name)
        .ok_or("No se pudo detectar el AppID del archivo Lua.")?;

    let target_name = if enabled {
        format!("{}.lua", app_id)
    } else {
        format!("{}.lua.disabled", app_id)
    };

    if file_name == target_name {
        return Ok(LuaActionResult {
            success: true,
            message: if enabled {
                "El script ya estaba activo.".to_string()
            } else {
                "El script ya estaba deshabilitado.".to_string()
            },
        });
    }

    let target_path = lua_dir.join(&target_name);

    if target_path.exists() {
        return Err(format!(
            "No se puede renombrar porque ya existe {}.",
            target_name
        ));
    }

    fs::rename(&current_path, &target_path)
        .map_err(|error| format!("No se pudo cambiar el estado del Lua: {}", error))?;

    Ok(LuaActionResult {
        success: true,
        message: if enabled {
            "Script Lua activado correctamente.".to_string()
        } else {
            "Script Lua deshabilitado correctamente.".to_string()
        },
    })
}

#[tauri::command]
pub fn delete_lua_script(
    lua_path: String,
    file_name: String,
) -> Result<LuaActionResult, String> {
    let lua_dir = validate_lua_dir(&lua_path)?;
    validate_lua_file_name(&file_name)?;

    let target_path = lua_dir.join(&file_name);

    if !target_path.exists() {
        return Err("El archivo Lua no existe.".to_string());
    }

    fs::remove_file(&target_path)
        .map_err(|error| format!("No se pudo eliminar el Lua: {}", error))?;

    Ok(LuaActionResult {
        success: true,
        message: "Script Lua eliminado correctamente.".to_string(),
    })
}

fn validate_lua_dir(lua_path: &str) -> Result<PathBuf, String> {
    if lua_path.trim().is_empty() {
        return Err("La ruta config/lua está vacía.".to_string());
    }

    let lua_dir = PathBuf::from(lua_path);

    if !lua_dir.exists() {
        return Err("La carpeta config/lua no existe.".to_string());
    }

    if !lua_dir.is_dir() {
        return Err("La ruta config/lua no es una carpeta.".to_string());
    }

    Ok(lua_dir)
}

fn validate_lua_file_name(file_name: &str) -> Result<(), String> {
    if parse_lua_app_id(file_name).is_none() {
        return Err(
            "Nombre inválido. Solo se permiten archivos tipo 123456.lua o 123456.lua.disabled."
                .to_string(),
        );
    }

    Ok(())
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