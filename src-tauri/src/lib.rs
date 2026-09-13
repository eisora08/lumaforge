mod commands;
mod lua_engine;
mod models;
mod utils;

use commands::achievement_watcher::{AchievementWatcher, AchievementWatcherState};
use std::sync::Mutex;
use tauri::Emitter;
use tauri::Listener;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

/// Build the tray context menu with recent games + actions.
/// `is_console_mode` controls the label on the switch item:
///   - true  → "Switch to Desktop Mode"
///   - false → "Switch to Console Mode"
fn build_tray_menu(
    app_handle: &tauri::AppHandle,
    is_console_mode: bool,
) -> Option<tauri::menu::Menu<tauri::Wry>> {
    let mut menu = MenuBuilder::new(app_handle);

    // ── Recent games ──
    if let Some(state) = app_handle.try_state::<commands::sqlite_cache::SqliteCoreDb>() {
        if let Ok(recent) = commands::playtime::get_recent_played_games(state) {
            if !recent.is_empty() {
                for game in &recent {
                    let label = if game.title.len() > 40 {
                        format!("{}…", &game.title[..39])
                    } else {
                        game.title.clone()
                    };
                    if let Ok(item) = MenuItemBuilder::new(format!("🎮 {}", label))
                        .id(format!("tray-game-{}", game.app_id))
                        .build(app_handle)
                    {
                        menu = menu.item(&item);
                    }
                }
                if let Ok(sep) = PredefinedMenuItem::separator(app_handle) {
                    menu = menu.item(&sep);
                }
            }
        }
    }

    // ── Static actions ──
    if let Ok(show) = MenuItemBuilder::new("Open LumaForge").id("tray-show").build(app_handle) {
        menu = menu.item(&show);
    }
    let switch_label = if is_console_mode {
        "Switch to Desktop Mode"
    } else {
        "Switch to Console Mode"
    };
    if let Ok(switch) = MenuItemBuilder::new(switch_label)
        .id("tray-switch-mode")
        .build(app_handle)
    {
        menu = menu.item(&switch);
    }
    if let Ok(sep) = PredefinedMenuItem::separator(app_handle) {
        menu = menu.item(&sep);
    }
    if let Ok(exit) = MenuItemBuilder::new("Exit").id("tray-exit").build(app_handle) {
        menu = menu.item(&exit);
    }

    menu.build().ok()
}

/// Rebuild the tray context menu with the correct switch-mode label.
/// Called from the `lumaforge-mode-changed` event listener.
fn rebuild_tray_menu(
    app_handle: tauri::AppHandle,
    is_console_mode: bool,
) -> Result<(), String> {
    let new_menu = build_tray_menu(&app_handle, is_console_mode)
        .ok_or_else(|| "Failed to build tray menu".to_string())?;
    let tray = app_handle
        .tray_by_id("lumaforge-tray")
        .ok_or_else(|| "Tray icon not found — is close-to-tray enabled?")?;
    tray.set_menu(Some(new_menu))
        .map_err(|e| format!("Failed to set tray menu: {}", e))
}

/// Read startup preferences written by the frontend (Settings → Startup).
/// The JSON file lives next to localStorage under the app data dir but is
/// written as a plain file so Rust can read it *before* the webview loads.
fn read_startup_config(app_handle: &tauri::AppHandle) -> StartupConfig {
    let path = app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("startup-config.json"));

    if let Some(path) = path {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<StartupConfig>(&data) {
                return cfg;
            }
        }
    }
    StartupConfig::default()
}

#[derive(serde::Deserialize, Default)]
struct StartupConfig {
    #[serde(default)]
    start_with_windows: bool,
    #[serde(default)]
    start_maximized: bool,
    #[serde(default)]
    start_in_tray: bool,
    #[serde(default)]
    close_to_tray: bool,
    #[serde(default = "default_launch_mode")]
    launch_mode: String,
    #[serde(default = "default_window_mode")]
    startup_window_mode: String,
}

fn default_launch_mode() -> String {
    "last-used".to_string()
}

fn default_window_mode() -> String {
    "windowed".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::SIZE
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin({
            use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
            tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None)
        })
        .setup(|app| {
            // ── Single-instance lock ──────────────────────────────────────
            let startup_cfg = read_startup_config(app.handle());

            // ── Epic Auth: global AppHandle for token path resolution ────
            commands::epic_auth::init_app_handle(app.handle().clone());

            // ── Achievement file watcher state ─────────────────────────────
            app.manage(AchievementWatcherState(Mutex::new(AchievementWatcher::new())));

            // ── SQLite cache databases ─────────────────────────────────────
            app.manage(commands::sqlite_cache::initialize_core_sqlite(app.handle()));
            app.manage(commands::sqlite_cache::initialize_achievements_sqlite(app.handle()));
            app.manage(commands::sqlite_cache::initialize_store_sqlite(app.handle()));

            // ── Close-to-tray: system tray icon + context menu + intercept close ──
            if startup_cfg.close_to_tray {
                let handle_for_menu = app.handle().clone();

                // Determine initial mode from startup config
                let is_console = startup_cfg.launch_mode == "console";

                // Build initial tray menu (label reflects current mode)
                let initial_menu = build_tray_menu(&handle_for_menu, is_console);

                let handle_clone = app.handle().clone();
                let mut tray = TrayIconBuilder::with_id("lumaforge-tray")
                    .icon(app.default_window_icon().cloned().expect("no icon in app bundle"))
                    .tooltip("LumaForge — click to restore");

                // Only attach menu if it built successfully
                if let Some(ref menu) = initial_menu {
                    tray = tray.menu(menu);
                }

                let tray = tray
                    .on_menu_event(move |app_handle, event| {
                        let id = event.id().as_ref();
                        match id {
                            "tray-show" => {
                                if let Some(main) = app_handle.get_webview_window("main") {
                                    let _ = main.show();
                                    let _ = main.set_focus();
                                }
                            }
                            "tray-switch-mode" => {
                                let _ = app_handle.emit("lumaforge-tray-switch-mode", ());
                            }
                            "tray-exit" => {
                                app_handle.exit(0);
                            }
                            _ if id.starts_with("tray-game-") => {
                                let app_id = id.strip_prefix("tray-game-").unwrap_or("");
                                let _ = app_handle.emit("lumaforge-tray-open-game", serde_json::json!({ "app_id": app_id }));
                                if let Some(main) = app_handle.get_webview_window("main") {
                                    let _ = main.show();
                                    let _ = main.set_focus();
                                }
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(move |tray_icon, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            if let Some(main) = handle_clone.get_webview_window("main") {
                                let _ = main.show();
                                let _ = main.set_focus();
                            }
                        }
                        // Right-click: the OS shows the menu set at creation time.
                        // Do NOT call set_menu here — replacing the menu handle
                        // while Windows is displaying it causes the menu to vanish.
                    })
                    .build(app.handle())
                    .map_err(|e| eprintln!("[Boot] Failed to create tray icon: {}", e));

                if tray.is_ok() {
                    eprintln!("[Boot] System tray icon created (close-to-tray enabled)");
                }

                // Intercept close → hide instead of quit
                if let Some(main) = app.get_webview_window("main") {
                    let main_clone = main.clone();
                    let handle_emit = app.handle().clone();
                    main.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = main_clone.hide();
                            let _ = handle_emit.emit("lumaforge-minimized-to-tray", ());
                        }
                    });
                }

                // Listen for frontend quit request (from close confirmation modal)
                {
                    let handle = app.handle().clone();
                    app.listen("lumaforge-quit", move |_| {
                        handle.exit(0);
                    });
                }
            }

            // ── Listen for mode changes → rebuild tray menu with correct label ──
            {
                let handle = app.handle().clone();
                app.handle().listen("lumaforge-mode-changed", move |event| {
                    let is_console = event
                        .payload()
                        .trim_matches('"')
                        == "console";
                    if let Err(e) = rebuild_tray_menu(handle.clone(), is_console) {
                        eprintln!("[Tray] Rebuild on mode change failed: {}", e);
                    }
                });
            }

            // ── Apply dynamic window size at boot (before TS loads) ─────────
            // The window-state plugin may have restored a stale size; re-apply
            // the monitor-proportional size when windowed mode is configured.
            {
                let cfg = read_startup_config(app.handle());
                if let Some(main) = app.get_webview_window("main") {
                    match cfg.startup_window_mode.as_str() {
                        "fullscreen" => {
                            let _ = main.set_fullscreen(true);
                        }
                        "maximized" => {
                            let _ = main.maximize();
                        }
                        _ => {
                            // "windowed" — resize from monitor
                            if let Ok(Some(monitor)) = main.primary_monitor() {
                                let scale = monitor.scale_factor();
                                let phys = monitor.size();
                                let logical_w = phys.width as f64 / scale;
                                let logical_h = phys.height as f64 / scale;
                                let target_w = logical_w * 0.55;
                                let target_h = logical_h * 0.75;
                                let target = tauri::LogicalSize::new(target_w, target_h);
                                eprintln!(
                                    "[Boot][Setup] windowed → monitor {}×{} (scale {:.1}), window {:.0}×{:.0}",
                                    phys.width, phys.height, scale, target_w, target_h
                                );
                                let _ = main.set_size(target);
                                let _ = main.center();
                            }
                            if cfg.start_maximized {
                                let _ = main.maximize();
                            }
                        }
                    }
                }
            }

            // ── Failsafe: show main window after timeout ───────────────────
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(20));
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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance launches, focus the existing window
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
            if let Some(splash) = app.get_webview_window("splashscreen") {
                let _ = splash.close();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            commands::splash::close_splashscreen_and_show_main,
            commands::splash::save_startup_config,
            commands::splash::set_autostart,
            commands::splash::read_startup_config_cmd,
            commands::steam::detect_steam_paths,
            commands::steam_news::fetch_steam_news,
            commands::installer::download_and_install_package,
            commands::provider::check_provider_availability,
            commands::lua::scan_installed_lua_scripts,
            commands::lua::set_lua_script_enabled,
            commands::lua::delete_lua_script,
            commands::metadata::resolve_steam_app_metadata,
            commands::metadata::fetch_steam_store_drm_notice,
            commands::metadata::fetch_json_from_url,
            commands::reviews::resolve_steam_review_summaries,
            commands::store_search::resolve_steam_store_search,
            commands::steam_grid_db::resolve_steamgriddb_artwork,
            commands::steam_grid_db::search_steamgriddb_games,
            commands::steam_grid_db::resolve_steamgriddb_artwork_by_game_id,
            commands::web_image_search::search_web_images,

            commands::steam_keys::steam_keys_ensure_cache,
            commands::steam_keys::steam_keys_update_cache,
            commands::steam_keys::steam_keys_generate_lua,
            commands::steam_keys::steam_keys_pin_manifest,
            commands::steam_keys::steam_keys_fetch_manifests,
            commands::steam_keys::steam_keys_update_all_pins,
            commands::steam_keys::steam_keys_query_dlcs,
            commands::steam_keys::steam_keys_add_dlc,
            commands::steam_keys::steam_keys_add_all_dlcs,
            commands::steam_keys::steam_keys_lua_exists,
            commands::steam_keys::steam_keys_has_pins,
            commands::steam_keys::steam_keys_unpin_all,
            commands::steam_keys::steam_keys_pin_to_current,
            commands::steam_keys::steam_keys_pin_to_latest,

            commands::cloud::cloud_get_status,
            commands::cloud::cloud_get_providers,
            commands::cloud::cloud_connect,
            commands::cloud::cloud_connect_local,
            commands::cloud::cloud_disconnect,
            commands::cloud::cloud_add_app,
            commands::cloud::cloud_remove_app,
            commands::cloud::cloud_is_app_registered,
            commands::cloud::cloud_start_oauth,
            commands::cloud::cloud_set_r2_credentials,
            commands::cloud::cloud_set_s3_credentials,
            commands::cloud::cloud_get_r2_credentials,
            commands::cloud::cloud_get_s3_credentials,

            commands::sync::compute_file_hash,
            commands::sync::read_sync_index,
            commands::sync::write_sync_index,
            commands::sync::check_package_update,
            commands::sync::mark_sync_index_item,
            commands::steam::scan_steam_login_users,
            commands::steam::scan_steam_installed_games,
            commands::steam::launch_steam_app,
            commands::steam::install_steam_app,
            commands::steam::uninstall_steam_app,
            commands::steam::open_steam_store_app,
            commands::steam::open_steam_library,
            commands::steam::check_steam_game_installed,
            commands::steam_user_stats::scan_steam_user_game_stats,
            commands::steam_achievements::fetch_steam_player_achievements,
            commands::steam_achievements::fetch_steam_global_achievement_percentages,
            commands::steam_achievements::fetch_steam_achievement_schema,
            commands::steam_achievements::scan_steam_appcache_achievements,
            commands::steam_achievements::parse_user_game_stats_raw,
            commands::steam_achievements::detect_steam_account_id_for_app,
            commands::steam_achievements::write_achievement_cache,
            commands::steam_achievements::read_achievement_cache,
            commands::steam_achievements::delete_achievement_cache,
            commands::steam_achievements::generate_achievement_schema,
            commands::steam_achievements::read_achievements_app_schema_folder,
            commands::steam_achievements::download_achievement_image,
            commands::steam_achievements::resolve_achievement_image_paths,
            commands::steam_achievements::ensure_achievement_images,
            commands::steam_achievements::debug_achievement_progress,
            commands::steam_achievements::parse_librarycache_achievements,
            commands::steam_achievements::check_achievement_librarycache_metadata,
            commands::steam_achievements::cleanup_achievement_orphan_images,
            commands::steam_achievements::validate_portable_paths,
            commands::steam_achievements::validate_generated_achievement_schema,
            commands::steam_achievements::resolve_achievement_path,
            commands::steam_achievements::resolve_achievement_image_path,
            commands::steam_achievements::read_achievement_progress_index,
            commands::steam_achievements::scan_achievement_folders,
            commands::achievement_watcher::start_achievement_watcher,
            commands::achievement_watcher::stop_achievement_watcher,
            commands::achievement_watcher::get_achievement_watcher_status,
            commands::achievement_watcher::list_librarycache_appids,
            commands::game::scan_local_games,
            commands::game::scan_local_game_folders,
            commands::process::launch_executable,
            commands::process::launch_executable_str,
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
            commands::game_media_cache::clear_game_media_cache,
            commands::game_media_cache::clear_all_game_media_cache,
            commands::store_cache::read_store_appinfo,
            commands::store_cache::write_store_appinfo,
            commands::store_cache::update_store_appinfo_entry,
            commands::store_cache::read_store_review_summary,
            commands::store_cache::write_store_review_summary,
            commands::store_cache::get_store_media_cache,
            commands::store_cache::read_store_discovery_index,
            commands::store_cache::write_store_discovery_index,
            commands::store_cache::read_store_sgdb_artwork_cache,
            commands::store_cache::write_store_sgdb_artwork_cache,
            commands::store_cache::read_store_catalog_sections_cache,
            commands::store_cache::write_store_catalog_sections_cache,
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
            commands::game_cache::batch_update_game_names,
            commands::game_cache::download_store_image,
            commands::game_cache::update_game_artwork,
            commands::game_cache::migrate_to_canonical_cache,
            commands::game_cache::safe_download_image,
            commands::game_cache::resolve_game_media_paths,
            commands::game_cache::resolve_game_media_paths_batch,
            commands::game_cache::get_game_media_paths,
            commands::game_cache::repair_appinfo_media_paths,
            commands::game_cache::repair_media_roles,
            commands::game_cache::read_game_media_data_url,
            commands::game_cache::resolve_provider_game_path,
            commands::game_cache::resolve_game_media_path,
            commands::game_cache::resolve_to_tauri_asset_url,
            commands::game_cache::migrate_game_media_to_relative,
            commands::game_cache::save_game_media_file,
            commands::game_cache::delete_game_media_file,
            commands::provider_media::save_provider_media_from_path,
            commands::provider_media::download_provider_media_from_url,
            commands::provider_media::delete_provider_media_file,
            commands::provider_media::save_provider_media_from_base64,
            commands::provider_media::open_provider_media_folder,
            commands::provider_media::list_provider_media_files,
            commands::media_cache::get_media_cache_stats,
            commands::media_cache::compact_media_cache,
            commands::startup_snapshot::read_startup_snapshot,
            commands::startup_snapshot::write_startup_snapshot,
            commands::startup_snapshot::clear_startup_snapshot,
            commands::startup_snapshot::validate_snapshot_media_paths,
            commands::startup_snapshot::validate_snapshot_media_paths_batch,
            commands::source_cache::read_source_availability_index,
            commands::source_cache::write_source_availability_index,
            commands::playtime::read_playtime_store,
            commands::playtime::record_play_session_start,
            commands::playtime::record_play_session_end,
            commands::playtime::get_recent_played_games,
            commands::sqlite_cache::check_sqlite_health,
            commands::sqlite_cache::read_library_cache,
            commands::sqlite_cache::write_library_cache,
            commands::sqlite_cache::delete_library_cache,
            commands::sqlite_cache::upsert_game_v2,
            commands::sqlite_cache::batch_upsert_games_v2,
            commands::sqlite_cache::get_game_v2,
            commands::sqlite_cache::get_game_v2_by_app_id,
            commands::sqlite_cache::get_games_v2_by_app_id,
            commands::sqlite_cache::get_all_games_v2,
            commands::sqlite_cache::get_games_v2_by_source,
            commands::sqlite_cache::search_games_v2,
            commands::sqlite_cache::delete_game_v2,
            commands::sqlite_cache::delete_stale_games_v2,
            commands::sqlite_cache::export_games_v2,
            commands::sqlite_cache::import_games_v2,
            commands::sqlite_cache::get_game_v2_count,
            commands::sqlite_cache::update_playtime_v2,
            commands::sqlite_cache::update_completion_status_v2,
            commands::sqlite_cache::increment_play_count_v2,
            commands::sqlite_cache::add_playtime_v2,
            commands::sqlite_cache::play_queue::get_play_queue,
            commands::sqlite_cache::play_queue::add_to_play_queue,
            commands::sqlite_cache::play_queue::remove_from_play_queue,
            commands::sqlite_cache::play_queue::reorder_play_queue,
            commands::sqlite_cache::play_queue::clear_play_queue,
            commands::sqlite_cache::collections::get_all_collections,
            commands::sqlite_cache::collections::get_collection_items,
            commands::sqlite_cache::collections::create_collection,
            commands::sqlite_cache::collections::update_collection,
            commands::sqlite_cache::collections::delete_collection,
            commands::sqlite_cache::collections::add_game_to_collection,
            commands::sqlite_cache::collections::remove_game_from_collection,
            commands::sqlite_cache::collections::reorder_collection_items,
            commands::sqlite_cache::collections::save_collection_cover,
            commands::steam_index::scan_and_build_full_dataset,
            commands::installed_games_registry::read_installed_games_registry,
            commands::installed_games_registry::write_installed_games_registry,
            commands::process::file_exists,
            commands::process::delete_file,
            commands::process::get_file_metadata,
            commands::process::pick_file,
            commands::process::pick_folder,
            commands::process::calculate_directory_size,
            commands::desktop::open_folder,
            commands::desktop::open_app_data,
            commands::desktop::open_logs,
            commands::desktop::clear_temp_cache,
            commands::desktop::get_system_info,
            commands::desktop::power_shutdown,
            commands::desktop::power_suspend,
            commands::desktop::power_hibernate,
            commands::desktop::power_restart,
            commands::desktop::open_game_metadata_folder,
            commands::desktop::open_game_media_folder,
            commands::desktop::create_shortcut,
            commands::toast::show_achievement_overlay,
            commands::toast::show_achievement_overlay_batch,
            commands::toast::show_session_overlay,
            commands::toast::close_toast_window,
            commands::toast::show_toast_notification,
            commands::hubcap::hubcap_health,
            commands::hubcap::hubcap_user_stats,
            commands::hubcap::hubcap_depot_keys,
            commands::hubcap::hubcap_app_status,
            commands::provider_status_cache::read_provider_status,
            commands::provider_status_cache::write_provider_status,
            commands::provider_status_cache::read_provider_status_snapshot,
            commands::provider_status_cache::write_provider_status_snapshot,
            commands::scan_state::read_scan_state,
            commands::scan_state::write_scan_state,
            commands::steam_owned::fetch_steam_owned_games,
            commands::steam_owned::read_steam_owned_cache,
            commands::profile::save_profile_media,
            commands::profile::delete_profile_media,
            commands::igdb::igdb_get_access_token,
            commands::igdb::igdb_search_by_steam_app_id,
            commands::igdb::igdb_search_games_by_name,
            commands::igdb::igdb_query_catalog,
            commands::epic::scan_epic_installed_games,
            commands::epic::check_epic_game_installed,
            commands::epic::launch_epic_game,
            commands::epic::epic_open_install,
            commands::epic_auth::epic_get_auth_url,
            commands::epic_auth::epic_exchange_code,
            commands::epic_auth::epic_refresh_stored_tokens,
            commands::epic_auth::epic_is_logged_in,
            commands::epic_auth::epic_get_account_info,
            commands::epic_auth::epic_logout,
            commands::epic_auth::epic_start_auth_flow,
            commands::epic_catalog::epic_fetch_owned_games,
            commands::epic_catalog::epic_fetch_filtered_owned_games,
            commands::epic_catalog::epic_get_catalog_items,
            commands::epic_catalog::epic_fetch_playtime,
            commands::epic_catalog::epic_sync_library,
            commands::epic_catalog::epic_fetch_and_save_metadata,
            commands::epic_achievements::epic_fetch_achievement_schema,
            commands::epic_achievements::epic_fetch_player_achievements,
            commands::store_catalog::get_catalog_meta,
            commands::store_catalog::import_steam_catalog,
            commands::store_catalog::query_catalog_by_genre,
            commands::store_catalog::query_catalog_search,
            commands::store_catalog::query_catalog_game,
            commands::store_catalog::query_catalog_featured,
            commands::store_catalog::query_catalog_new_noteworthy,
            commands::store_catalog::query_catalog_hidden_gems,
            commands::store_catalog::query_catalog_top_rated,
            commands::store_catalog::query_catalog_cult_classics,
            commands::repack_catalog::get_repack_catalog_meta,
            commands::repack_catalog::import_repack_catalog,
            commands::repack_catalog::query_repack_catalog_fuzzy,
            commands::repack_catalog::query_repack_catalog_by_repacker_fuzzy,
            commands::repack_catalog::query_repack_catalog_by_app_id,
            commands::repack_catalog::query_repack_catalog_all,
            commands::repack_catalog::query_repack_catalog_by_repacker,
            commands::repack_catalog::query_repack_catalog_page,
            commands::repack_catalog::query_repack_repackers,
            commands::debrid_installer::cancel_debrid_download,
            commands::debrid_installer::pause_debrid_download,
            commands::debrid_installer::clean_debrid_temp_files,
            commands::debrid_installer::has_debrid_temp_files,
            commands::debrid_installer::download_debrid_package,
            commands::debrid_installer::setup_debrid_game,
            commands::debrid_installer::verify_debrid_installation,
            commands::debrid_installer::launch_debrid_game,
            commands::debrid_installer::check_installer_status,
            commands::debrid_installer::run_installer_again,
            commands::debrid_installer::detect_install_path_from_registry,
            commands::torrent::start_torrent_download,
            commands::hydra_source::fetch_and_import_hydra_source,
            commands::hydra_source::validate_hydra_source_url,
            commands::hydra_source::list_hydra_sources,
            commands::hydra_source::add_hydra_source,
            commands::hydra_source::remove_hydra_source,
            commands::hydra_source::toggle_hydra_source,
            commands::hydra_source::refresh_all_hydra_sources,
            commands::hydra_source::clear_hydra_cache,
            commands::hydra_source::import_repack_feed,
            commands::hydra_source::list_imported_feeds,
            commands::hydra_source::remove_imported_feed,
            commands::hydra_source::webview_fetch_callback,
            commands::hydra_source::fetch_url_via_webview,
            commands::debrid_resolver::resolve_debrid_download_url,
            commands::debrid_resolver::check_debrid_provider_status,
            commands::backup::write_backup_archive,
            commands::backup::read_backup_archive,
            commands::backup::list_backup_archives,
            commands::backup::delete_backup_archive,
            commands::backup::validate_backup_file,
            commands::backup::get_app_data_dir_path,
            commands::file_utils::create_directory,
            commands::file_utils::write_text_file,
            commands::file_utils::read_text_file,
            commands::file_utils::list_files_in_dir,
            commands::file_utils::delete_directory,
            commands::file_utils::scan_directory_recursive,
            commands::file_utils::get_file_size,
            commands::external_files::scan_external_file_collection,
            commands::external_files::read_file_collection_content,
            commands::external_files::restore_external_files,
            commands::external_files::create_external_safety_backup,
            commands::external_files::restore_from_safety_backup,
            commands::external_files::verify_file_checksums,
            commands::external_files::resolve_achievements_root_dir,
            commands::external_files::resolve_app_data_dir,
            commands::external_files::detect_crack_save_type,
            commands::steam_achievement_sources::audit_steam_achievement_sources,
            commands::steam_achievement_sources::export_steam_achievement_sources,
            commands::steam_achievement_sources::read_steam_achievement_source_for_game,
            commands::steam_achievement_sources::check_steam_running,
            commands::steam_achievement_sources::restore_steam_achievement_sources,
            commands::extension::extension_file_exists,
            commands::extension::extension_file_status,
            commands::extension::extension_rename_file,
            commands::extension::extension_batch_rename,
            commands::extension::extension_remove_file,
            commands::extension::extension_copy_file,
            commands::extension::extension_create_dir,
            commands::extension::extension_get_dll_version,
            commands::extension::extension_list_directory,
            commands::extension::extension_download_file,
            commands::extension::extension_extract_zip,
            commands::extension::extension_run_process,
            commands::extension::extension_fetch_url_as_text,
            commands::extension::extension_find_largest_exe,
            commands::extension::extension_extract_zip_all,
            commands::extension::extension_write_text_file,
            commands::extension_lifecycle::load_extension,
            commands::extension_lifecycle::call_extension_detect,
            commands::extension_lifecycle::call_extension_install,
            commands::extension_lifecycle::call_extension_enable,
            commands::extension_lifecycle::call_extension_disable,
            commands::extension_lifecycle::call_extension_uninstall,
            commands::extension_lifecycle::write_extension_config,
            commands::extension_lifecycle::read_extension_config,
            commands::extension_lifecycle::delete_extension_directory,
            commands::extension_lifecycle::scan_extensions_directory,
            commands::thirdparty::list_thirdparty_tools,
            commands::thirdparty::install_thirdparty_tool,
            commands::thirdparty::uninstall_thirdparty_tool,
            commands::thirdparty::check_thirdparty_updates,
            commands::thirdparty::update_thirdparty_tool,
            commands::thirdparty::set_thirdparty_tool_enabled,
            commands::thirdparty::open_thirdparty_folder,
            commands::thirdparty::set_thirdparty_tool_variant,
            commands::game_fix::library_get_game_fix_info,
            commands::game_fix::library_apply_online_fix,
            commands::game_fix::library_apply_smoke_api,
            commands::game_fix::library_apply_steamless,
            commands::game_fix::library_unfix_steamless,
            commands::game_fix::library_unfix_smoke_api,
            commands::game_fix::library_unfix_online_fix,
            commands::game_fix::library_check_fix_installations,
            commands::game_fix::library_install_smoke_api,
            commands::game_fix::library_install_steamless,
            commands::game_fix::library_install_koaloader,
            commands::game_fix::library_has_online_fix_fix,
            commands::game_fix::library_has_smoke_api_fix,
            commands::game_fix::library_has_steamless_fix,
            commands::game_fix::library_has_goldberg_fix,
            commands::game_fix::library_apply_goldberg,
            commands::game_fix::library_unfix_goldberg,
            commands::game_fix::library_get_applied_fix_ids,
            commands::game_fix::library_open_steam_launch_options,
            commands::game_fix::seed_gse_saves_folder,
            commands::game_fix::library_apply_catalog_fix,
            commands::game_fix::library_has_catalog_fix,
            commands::game_fix::library_unfix_catalog_fix,
            commands::sqlite_cache::upsert_achievement_summary,
            commands::sqlite_cache::get_achievement_summary,
            commands::sqlite_cache::get_all_achievement_summaries,
            commands::sqlite_cache::upsert_achievement,
            commands::sqlite_cache::batch_upsert_achievements,
            commands::sqlite_cache::get_achievements_for_game,
            commands::sqlite_cache::delete_achievements_for_game,
            commands::sqlite_cache::upsert_achievement_progress,
            commands::sqlite_cache::get_achievement_progress_for_game,
            commands::sqlite_cache::upsert_achievement_percentages,
            commands::sqlite_cache::get_achievement_percentages,
            commands::sqlite_cache::upsert_game_session,
            commands::sqlite_cache::get_game_sessions_for_game,
            commands::sqlite_cache::get_all_game_sessions,
            commands::sqlite_cache::delete_game_sessions_for_game,
            commands::sqlite_cache::update_game_session_end,
            commands::sqlite_cache::get_recent_game_sessions,
            commands::sqlite_cache::entities::get_all_genres,
            commands::sqlite_cache::entities::get_genres_for_game,
            commands::sqlite_cache::entities::get_genre_counts,
            commands::sqlite_cache::entities::set_game_genres,
            commands::sqlite_cache::entities::get_all_developers,
            commands::sqlite_cache::entities::get_developers_for_game,
            commands::sqlite_cache::entities::set_game_developers,
            commands::sqlite_cache::entities::get_publishers_for_game,
            commands::sqlite_cache::entities::set_game_publishers,
            commands::sqlite_cache::entities::get_all_categories,
            commands::sqlite_cache::entities::get_categories_for_game,
            commands::sqlite_cache::entities::set_game_categories,
            commands::sqlite_cache::entities::get_all_features,
            commands::sqlite_cache::entities::get_features_for_game,
            commands::sqlite_cache::entities::set_game_features,
            commands::sqlite_cache::entities::get_all_tags,
            commands::sqlite_cache::entities::get_tags_for_game,
            commands::sqlite_cache::entities::set_game_tags,
            commands::sqlite_cache::entities::migrate_game_entities_from_json,
            commands::sqlite_cache::entities::get_all_game_entities,
            commands::sqlite_cache::game_files::upsert_game_file_cmd,
            commands::sqlite_cache::game_files::upsert_game_files_media_cmd,
            commands::sqlite_cache::game_files::upsert_game_files_depot_cmd,
            commands::sqlite_cache::game_files::upsert_game_files_fingerprints_cmd,
            commands::sqlite_cache::game_files::get_game_file_cmd,
            commands::sqlite_cache::game_files::get_game_files_media_cmd,
            commands::sqlite_cache::game_files::delete_game_file_cmd,
            commands::sqlite_cache::game_files::get_installed_game_files_cmd,
            commands::sqlite_cache::game_actions::add_game_action_cmd,
            commands::sqlite_cache::game_actions::get_game_actions_cmd,
            commands::sqlite_cache::game_actions::get_all_game_actions_cmd,
            commands::sqlite_cache::game_actions::update_game_action_cmd,
            commands::sqlite_cache::game_actions::delete_game_action_cmd,
            commands::sqlite_cache::game_actions::delete_game_actions_for_game_cmd,
            commands::sqlite_cache::import_exclusions::add_import_exclusion_cmd,
            commands::sqlite_cache::import_exclusions::get_import_exclusions_cmd,
            commands::sqlite_cache::import_exclusions::is_game_excluded_cmd,
            commands::sqlite_cache::import_exclusions::is_folder_excluded_cmd,
            commands::sqlite_cache::import_exclusions::remove_import_exclusion_cmd,
            commands::sqlite_cache::upsert_store_review,
            commands::sqlite_cache::get_store_review,
            commands::sqlite_cache::batch_get_store_reviews,
            commands::sqlite_cache::upsert_provider_status,
            commands::sqlite_cache::get_provider_status_from_db,
            commands::sqlite_cache::get_all_provider_statuses,
            commands::sqlite_cache::upsert_game_catalog_blob,
            commands::sqlite_cache::get_game_catalog_blob,
            commands::installed_programs::scan_installed_programs,
            commands::crack_achievements::parse_tenoke_user_stats,
            commands::crack_achievements::parse_onlinefix_achievements_ini,
            commands::launcher_achievements::read_launcher_achievements,
            commands::launcher_achievements::write_launcher_achievements,
            commands::launcher_achievements::read_launcher_xp_events,
            commands::launcher_achievements::write_launcher_xp_events,
            commands::depot_downloader::depot_downloader_resolve_depots,
            commands::depot_downloader::depot_downloader_start,
            commands::depot_downloader::depot_downloader_cancel,
            commands::depot_downloader::depot_downloader_pause,
            commands::depot_downloader::depot_downloader_status,
            commands::depot_downloader::depot_downloader_default_output_dir,
            commands::depot_downloader::depot_downloader_parse_lua_manifests,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
