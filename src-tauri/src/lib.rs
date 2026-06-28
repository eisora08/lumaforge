mod commands;
mod models;
mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::steam::detect_steam_paths,
            commands::steam_news::fetch_steam_news,
            commands::installer::download_and_install_package,
            commands::provider::check_provider_availability,
            commands::lua::scan_installed_lua_scripts,
            commands::lua::set_lua_script_enabled,
            commands::lua::delete_lua_script,
            commands::game::resolve_steam_app_names,
            commands::metadata::resolve_steam_app_metadata,
            commands::reviews::resolve_steam_review_summaries,
            commands::store::resolve_steam_featured_categories,
            commands::store_search::resolve_steam_store_search,
            commands::steam_grid_db::resolve_steamgriddb_artwork,
            commands::artwork_cache::read_artwork_cache_index,
            commands::artwork_cache::write_artwork_cache_index,
            commands::artwork_cache::cache_remote_artwork,
            commands::artwork_cache::clear_artwork_cache_for_game,
            commands::artwork_cache::clear_all_artwork_cache,
            commands::sync::compute_file_hash,
            commands::sync::read_sync_index,
            commands::sync::write_sync_index,
            commands::sync::check_package_update,
            commands::sync::mark_sync_index_item,
            commands::steam::scan_steam_installed_games,
            commands::steam::launch_steam_app,
            commands::steam::install_steam_app,
            commands::game::scan_local_games,
            commands::game::scan_local_game_folders,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
