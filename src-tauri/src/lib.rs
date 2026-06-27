mod commands;
mod models;
mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::steam::detect_steam_paths,
            commands::installer::download_and_install_package,
            commands::provider::check_provider_availability,
            commands::lua::scan_installed_lua_scripts
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}