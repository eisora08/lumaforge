use std::fs;
use std::path::Path;
use std::sync::LazyLock;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use crate::lua_engine::{LuaEngine, LuaEngineConfig, LuaFunctionResult, LuaExtensionTable};

static ENGINES: LazyLock<DashMap<String, LuaEngine>> = LazyLock::new(|| DashMap::new());

#[tauri::command]
pub fn load_extension(
    extension_id: String,
    script_path: String,
) -> Result<LuaExtensionTable, String> {
    eprintln!(
        "[Backend Rust] ===== Loading Lua extension: {} from {} =====",
        extension_id, script_path
    );

    let script = fs::read_to_string(&script_path)
        .map_err(|e| format!("Failed to read extension script '{}': {}", script_path, e))?;

    let mut engine = LuaEngine::new(LuaEngineConfig::default())?;
    let table = engine.load_and_evaluate(&extension_id, &script)?;

    ENGINES.insert(extension_id.clone(), engine);

    eprintln!(
        "[Backend Rust] ===== Lua extension loaded: {} name={:?} version={:?} has_detect={} has_install={} has_enable={} has_disable={} has_uninstall={} =====",
        extension_id,
        table.name,
        table.version,
        table.has_detect,
        table.has_install,
        table.has_enable,
        table.has_disable,
        table.has_uninstall,
    );

    Ok(table)
}

fn get_engine(extension_id: &str) -> Result<dashmap::mapref::one::Ref<'_, String, LuaEngine>, String> {
    ENGINES
        .get(extension_id)
        .ok_or_else(|| format!("Extension '{}' is not loaded. Call load_extension first.", extension_id))
}

#[allow(dead_code)]
fn engine_has_fn(extension_id: &str, func_name: &str) -> bool {
    ENGINES
        .get(extension_id)
        .map(|e| e.has_function(func_name))
        .unwrap_or(false)
}

fn call_extension_fn(
    extension_id: &str,
    func_name: &str,
    install_dir: &str,
) -> Result<LuaFunctionResult, String> {
    let engine = get_engine(extension_id)?;
    engine.call_function(func_name, install_dir)
}

#[tauri::command]
pub fn call_extension_detect(
    extension_id: String,
    install_dir: String,
) -> Result<LuaFunctionResult, String> {
    eprintln!(
        "[Backend Rust] Executing Lua function 'detect' for extension: {} install_dir={}",
        extension_id, install_dir
    );
    call_extension_fn(&extension_id, "detect", &install_dir)
}

#[tauri::command]
pub fn call_extension_install(
    extension_id: String,
    install_dir: String,
) -> Result<LuaFunctionResult, String> {
    eprintln!(
        "[Backend Rust] Executing Lua function 'install' for extension: {} install_dir={}",
        extension_id, install_dir
    );
    call_extension_fn(&extension_id, "install", &install_dir)
}

#[tauri::command]
pub fn call_extension_enable(
    extension_id: String,
    install_dir: String,
) -> Result<LuaFunctionResult, String> {
    eprintln!(
        "[Backend Rust] Executing Lua function 'enable' for extension: {} install_dir={}",
        extension_id, install_dir
    );
    call_extension_fn(&extension_id, "enable", &install_dir)
}

#[tauri::command]
pub fn call_extension_disable(
    extension_id: String,
    install_dir: String,
) -> Result<LuaFunctionResult, String> {
    eprintln!(
        "[Backend Rust] Executing Lua function 'disable' for extension: {} install_dir={}",
        extension_id, install_dir
    );
    call_extension_fn(&extension_id, "disable", &install_dir)
}

#[tauri::command]
pub fn call_extension_uninstall(
    extension_id: String,
    install_dir: String,
) -> Result<LuaFunctionResult, String> {
    eprintln!(
        "[Backend Rust] Executing Lua function 'uninstall' for extension: {} install_dir={}",
        extension_id, install_dir
    );
    call_extension_fn(&extension_id, "uninstall", &install_dir)
}

// =============================================================================
// Extension Config + Directory Management (cascading lifecycle support)
// =============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtensionConfig {
    pub enabled: bool,
}

/// Write an extension-config.json into the extension's AppData directory.
/// This is the "local registry config" the launcher checks to determine
/// whether an extension should be treated as enabled or disabled.
#[tauri::command]
pub fn write_extension_config(dir_path: String, enabled: bool) -> Result<(), String> {
    let dir = Path::new(&dir_path);
    fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create extension config directory: {}", e))?;
    let config_path = dir.join("extension-config.json");
    let config = ExtensionConfig { enabled };
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize extension config: {}", e))?;
    fs::write(&config_path, &json)
        .map_err(|e| format!("Failed to write extension config: {}", e))?;
    eprintln!("[EXT][CONFIG] dir={:?} enabled={}", config_path, enabled);
    Ok(())
}

/// Read the extension-config.json from the extension's AppData directory.
/// Returns None when the file doesn't exist (first-boot or pre-migration).
#[tauri::command]
pub fn read_extension_config(dir_path: String) -> Result<Option<ExtensionConfig>, String> {
    let config_path = Path::new(&dir_path).join("extension-config.json");
    if !config_path.exists() {
        return Ok(None);
    }
    let json = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read extension config: {}", e))?;
    let config: ExtensionConfig = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse extension config: {}", e))?;
    Ok(Some(config))
}

/// Delete the extension's entire AppData directory (extension.lua,
/// manifest.json, extension-config.json, and any other state files).
/// This is the "core application action" for uninstall — after the Lua
/// uninstall() hook removes managed files from the host path, this
/// command cleans up the launcher's own extension storage.
#[tauri::command]
pub fn delete_extension_directory(dir_path: String) -> Result<(), String> {
    let dir = Path::new(&dir_path);
    if !dir.exists() {
        eprintln!("[EXT][DELETE] dir={:?} does not exist — nothing to delete", dir);
        return Ok(());
    }
    fs::remove_dir_all(dir)
        .map_err(|e| format!("Failed to delete extension directory: {}", e))?;
    eprintln!("[EXT][DELETE] dir={:?} deleted", dir);
    Ok(())
}

// =============================================================================
// Extension Directory Scanner
// =============================================================================

#[derive(Serialize)]
pub struct ExtensionDirEntry {
    pub dir_name: String,
    pub manifest_json: Option<String>,
    pub has_extension_lua: bool,
}

#[derive(Serialize)]
pub struct ScanExtensionsResult {
    pub entries: Vec<ExtensionDirEntry>,
}

/// Scan a directory for extension subdirectories.
/// Each subdirectory must contain manifest.json and extension.lua to be valid.
/// Returns the raw JSON content of each manifest alongside dir metadata.
#[tauri::command]
pub fn scan_extensions_directory(base_path: String) -> Result<ScanExtensionsResult, String> {
    let dir = Path::new(&base_path);
    if !dir.exists() || !dir.is_dir() {
        return Ok(ScanExtensionsResult { entries: vec![] });
    }

    let mut entries: Vec<ExtensionDirEntry> = Vec::new();
    let read_dir = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let dir_name = match entry.file_name().to_str() {
            Some(name) => name.to_string(),
            None => continue,
        };

        let manifest_path = path.join("manifest.json");
        let lua_path = path.join("extension.lua");

        let manifest_json = if manifest_path.exists() {
            match fs::read_to_string(&manifest_path) {
                Ok(content) => Some(content),
                Err(_) => None,
            }
        } else {
            None
        };

        let has_extension_lua = lua_path.exists();

        entries.push(ExtensionDirEntry {
            dir_name,
            manifest_json,
            has_extension_lua,
        });
    }

    eprintln!(
        "[EXT][SCAN] path={} entries={}",
        base_path,
        entries.len()
    );

    Ok(ScanExtensionsResult { entries })
}
