use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

fn get_registry_path(app_handle: &AppHandle) -> PathBuf {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    app_dir.join("installed-games.json")
}

#[tauri::command]
pub fn read_installed_games_registry(
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let path = get_registry_path(&app_handle);
    if !path.exists() {
        return Ok("{}".to_string());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read installed-games.json: {}", e))?;
    Ok(content)
}

#[tauri::command]
pub fn write_installed_games_registry(
    app_handle: tauri::AppHandle,
    data: String,
) -> Result<(), String> {
    let path = get_registry_path(&app_handle);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create registry dir: {}", e))?;
    }
    fs::write(&path, &data)
        .map_err(|e| format!("Failed to write installed-games.json: {}", e))?;
    println!("[Registry] written to {:?}", path);
    Ok(())
}
