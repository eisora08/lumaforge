mod commands;
mod models;
mod utils;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Initialize SQLite cache database
            let sqlite_db = commands::sqlite_cache::initialize_sqlite(app.handle());
            app.manage(sqlite_db);

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(10));
                if let Some(main) = handle.get_webview_window("main") {
                    if !main.is_visible().unwrap_or(false) {
                        eprintln!("[Boot] Rust failsafe: showing main window after timeout");
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                }
                if let Some(splash) = handle.get_webview_window("splashscreen") {
                    eprintln!("[Boot] Rust failsafe: closing splashscreen");
                    let _ = splash.close();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::splash::close_splashscreen_and_show_main,
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
            commands::steam::scan_steam_login_users,
            commands::steam::scan_steam_installed_games,
            commands::steam::launch_steam_app,
            commands::steam::install_steam_app,
            commands::steam_user_stats::scan_steam_user_game_stats,
            commands::steam_achievements::fetch_steam_player_achievements,
            commands::steam_achievements::fetch_steam_global_achievement_percentages,
            commands::steam_achievements::fetch_steam_achievement_schema,
            commands::steam_achievements::scan_steam_appcache_achievements,
            commands::steam_achievements::parse_user_game_stats_raw,
            commands::steam_achievements::write_achievement_cache,
            commands::steam_achievements::read_achievement_cache,
            commands::steam_achievements::read_achievements_app_schema_folder,
            commands::steam_achievements::download_achievement_image,
            commands::steam_achievements::resolve_achievement_image_paths,
            commands::steam_achievements::ensure_achievement_images,
            commands::steam_achievements::debug_achievement_progress,
            commands::steam_achievements::parse_librarycache_achievements,
            commands::game::scan_local_games,
            commands::game::scan_local_game_folders,
            commands::process::launch_executable,
            commands::process::terminate_process,
            commands::process::terminate_process_tree,
            commands::process::terminate_process_by_name,
            commands::process::is_process_running,
            commands::process::list_processes,
            commands::process::discover_executables,
            commands::process::focus_game_window,
            commands::game_media_cache::get_game_media_cache,
            commands::game_media_cache::get_all_game_media_cache,
            commands::game_media_cache::save_game_media_cache,
            commands::game_media_cache::cache_remote_game_media,
            commands::game_media_cache::clear_game_media_cache,
            commands::game_media_cache::clear_all_game_media_cache,
            commands::store_cache::read_store_appinfo,
            commands::store_cache::write_store_appinfo,
            commands::store_cache::update_store_appinfo_entry,
            commands::store_cache::read_store_game_details,
            commands::store_cache::write_store_game_details,
            commands::store_cache::read_store_review_summary,
            commands::store_cache::write_store_review_summary,
            commands::store_cache::get_store_media_cache,
            commands::store_cache::cache_store_remote_media,
            commands::store_cache::clear_store_cache,
            commands::library_cache::read_library_appinfo,
            commands::library_cache::write_library_appinfo,
            commands::library_cache::update_library_appinfo_entry,
            commands::library_cache::read_library_game_details,
            commands::library_cache::write_library_game_details,
            commands::library_cache::library_get_game_media_cache,
            commands::library_cache::library_save_game_media_cache,
            commands::library_cache::library_clear_game_media_cache,
            commands::library_cache::library_clear_all_game_media_cache,
            commands::library_cache::read_library_cache_index,
            commands::library_cache::write_library_cache_index,
            commands::library_cache::read_image_as_data_url,
            commands::library_cache::cache_library_game_media,
            commands::game_cache::read_canonical_appinfos,
            commands::game_cache::get_game_app_info,
            commands::game_cache::save_game_app_info,
            commands::game_cache::get_store_details,
            commands::game_cache::save_store_details,
            commands::game_cache::get_game_artwork,
            commands::game_cache::save_game_artwork,
            commands::game_cache::cache_landscape_image,
            commands::game_cache::cache_cover_image,
            commands::game_cache::cache_background_image,
            commands::game_cache::cache_logo_image,
            commands::game_cache::cache_icon_image,
            commands::game_cache::update_game_appinfo_media,
            commands::game_cache::update_game_artwork,
            commands::game_cache::migrate_to_canonical_cache,
            commands::game_cache::safe_download_image,
            commands::game_cache::resolve_game_media_paths,
            commands::game_cache::get_game_media_paths,
            commands::game_cache::repair_appinfo_media_paths,
            commands::game_cache::repair_media_roles,
            commands::game_cache::read_game_media_data_url,
            commands::media_cache::get_media_cache_stats,
            commands::media_cache::compact_media_cache,
            commands::startup_snapshot::read_startup_snapshot,
            commands::startup_snapshot::write_startup_snapshot,
            commands::startup_snapshot::clear_startup_snapshot,
            commands::startup_snapshot::validate_snapshot_media_paths,
            commands::source_cache::read_source_availability_index,
            commands::source_cache::write_source_availability_index,
            commands::playtime::read_playtime_store,
            commands::playtime::write_playtime_store,
            commands::playtime::record_play_session_start,
            commands::playtime::record_play_session_end,
            commands::playtime::import_external_playtime,
            commands::sqlite_cache::check_sqlite_health,
            commands::sqlite_cache::get_media_cache,
            commands::sqlite_cache::get_metadata_cache,
            commands::sqlite_cache::insert_media_cache,
            commands::sqlite_cache::insert_metadata_cache,
            commands::sqlite_cache::read_library_cache,
            commands::sqlite_cache::write_library_cache,
            commands::sqlite_cache::delete_library_cache,
            commands::sqlite_cache::upsert_game,
            commands::sqlite_cache::batch_upsert_games,
            commands::sqlite_cache::read_all_games,
            commands::sqlite_cache::get_game_count,
            commands::steam_index::scan_and_build_full_dataset,
            commands::installed_games_registry::read_installed_games_registry,
            commands::installed_games_registry::write_installed_games_registry,
            commands::process::file_exists,
            commands::desktop::open_folder,
            commands::desktop::create_shortcut,
            commands::toast::show_toast_notification,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
