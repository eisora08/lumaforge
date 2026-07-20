use std::fs;
use std::path::Path;
use std::sync::LazyLock;
use dashmap::DashMap;
use serde::Serialize;
use crate::lua_engine::{LuaEngine, LuaEngineConfig, LuaFunctionResult, LuaExtensionTable};

static ENGINES: LazyLock<DashMap<String, LuaEngine>> = LazyLock::new(|| DashMap::new());

#[tauri::command]
pub fn load_extension(
    extension_id: String,
    script_path: String,
) -> Result<LuaExtensionTable, String> {
    let script = fs::read_to_string(&script_path)
        .map_err(|e| format!("Failed to read extension script '{}': {}", script_path, e))?;

    let mut engine = LuaEngine::new(LuaEngineConfig::default())?;
    let table = engine.load_and_evaluate(&extension_id, &script)?;

    ENGINES.insert(extension_id.clone(), engine);

    eprintln!(
        "[EXT][LOAD] extension_id={} name={:?} version={:?}",
        extension_id, table.name, table.version
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
    call_extension_fn(&extension_id, "detect", &install_dir)
}

#[tauri::command]
pub fn call_extension_install(
    extension_id: String,
    install_dir: String,
) -> Result<LuaFunctionResult, String> {
    call_extension_fn(&extension_id, "install", &install_dir)
}

#[tauri::command]
pub fn call_extension_enable(
    extension_id: String,
    install_dir: String,
) -> Result<LuaFunctionResult, String> {
    call_extension_fn(&extension_id, "enable", &install_dir)
}

#[tauri::command]
pub fn call_extension_disable(
    extension_id: String,
    install_dir: String,
) -> Result<LuaFunctionResult, String> {
    call_extension_fn(&extension_id, "disable", &install_dir)
}

#[tauri::command]
pub fn call_extension_uninstall(
    extension_id: String,
    install_dir: String,
) -> Result<LuaFunctionResult, String> {
    call_extension_fn(&extension_id, "uninstall", &install_dir)
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
