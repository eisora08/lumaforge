use serde::Deserialize;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;

// ---------------------------------------------------------------------------
// close_splashscreen_and_show_main — Part 8
// Closes the splash (webview) window and shows the main window.
// Reads startup-config.json to apply startMaximized / startInTray.
// Safe to call even if splash is already closed.
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
struct StartupConfig {
    #[serde(default)]
    start_maximized: bool,
    #[serde(default)]
    start_in_tray: bool,
    #[serde(default)]
    start_with_windows: bool,
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

#[tauri::command]
pub fn close_splashscreen_and_show_main(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Try to close splash window (native window-based splash)
    if let Some(splash) = app_handle.get_webview_window("splashscreen") {
        splash.close().map_err(|e| format!("Failed to close splash: {}", e))?;
    }

    // Show and focus main window
    if let Some(main) = app_handle.get_webview_window("main") {
        let cfg = read_startup_config(&app_handle);

        if cfg.start_in_tray {
            eprintln!("[Boot] startInTray: window hidden, splash closed");
        } else {
            // Show FIRST — maximize/fullscreen on a hidden window is a no-op on Windows
            main.show().map_err(|e| format!("Failed to show main: {}", e))?;

            match cfg.startup_window_mode.as_str() {
                "fullscreen" => {
                    eprintln!("[Boot] startupWindowMode=fullscreen → entering fullscreen");
                    let _ = main.set_fullscreen(true);
                }
                "maximized" => {
                    eprintln!("[Boot] startupWindowMode=maximized → maximizing");
                    let _ = main.maximize();
                }
                _ => {
                    // "windowed" — calculate proportional size from the primary monitor
                    // Formula: 55% of monitor width × 75% of monitor height
                    // Examples: 1920×1080 → 1056×810, 3440×1440 → 1892×1080
                    match main.primary_monitor() {
                        Ok(Some(monitor)) => {
                            let scale = monitor.scale_factor();
                            let phys = monitor.size();
                            // Calculate target in logical pixels (what the user sees)
                            let logical_w = phys.width as f64 / scale;
                            let logical_h = phys.height as f64 / scale;
                            let target_w = logical_w * 0.55;
                            let target_h = logical_h * 0.75;
                            let target = tauri::LogicalSize::new(target_w, target_h);
                            eprintln!(
                                "[Boot] startupWindowMode=windowed → monitor {}×{} (scale {:.1}), logical {:.0}×{:.0}, window {:.0}×{:.0}",
                                phys.width, phys.height, scale, logical_w, logical_h, target_w, target_h
                            );
                            if let Err(e) = main.set_size(target) {
                                eprintln!("[Boot] set_size failed: {}", e);
                            }
                            if let Err(e) = main.center() {
                                eprintln!("[Boot] center failed: {}", e);
                            }
                        }
                        Ok(None) => {
                            eprintln!("[Boot] startupWindowMode=windowed → no monitor found, keeping default size");
                        }
                        Err(e) => {
                            eprintln!("[Boot] startupWindowMode=windowed → primary_monitor error: {}", e);
                        }
                    }

                    // Legacy fallback: start_maximized overrides the calculation
                    if cfg.start_maximized {
                        let _ = main.maximize();
                    }
                }
            }

            main.set_focus().map_err(|e| format!("Failed to focus main: {}", e))?;
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// save_startup_config — called by the frontend when startup settings change.
// Writes a tiny JSON so the Rust side can read it on next launch.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_startup_config(
    app_handle: tauri::AppHandle,
    start_with_windows: bool,
    start_maximized: bool,
    start_in_tray: bool,
    close_to_tray: bool,
    launch_mode: String,
    startup_window_mode: String,
) -> Result<(), String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    let cfg = serde_json::json!({
        "start_with_windows": start_with_windows,
        "start_maximized": start_maximized,
        "start_in_tray": start_in_tray,
        "close_to_tray": close_to_tray,
        "launch_mode": launch_mode,
        "startup_window_mode": startup_window_mode,
    });

    let path = dir.join("startup-config.json");
    std::fs::write(&path, serde_json::to_string_pretty(&cfg).unwrap_or_default())
        .map_err(|e| format!("Failed to write startup config: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// set_autostart — enable / disable "Start with Windows" via the OS registry.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn set_autostart(app_handle: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let autostart = app_handle.autolaunch();
    if enabled {
        autostart.enable().map_err(|e| format!("Failed to enable autostart: {}", e))?;
    } else {
        autostart.disable().map_err(|e| format!("Failed to disable autostart: {}", e))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// read_startup_config_cmd — expose the startup config to the frontend.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Default)]
pub struct StartupConfigDto {
    pub start_with_windows: bool,
    pub start_maximized: bool,
    pub start_in_tray: bool,
    pub close_to_tray: bool,
    pub launch_mode: String,
    pub startup_window_mode: String,
}

#[tauri::command]
pub fn read_startup_config_cmd(app_handle: tauri::AppHandle) -> Result<StartupConfigDto, String> {
    let cfg = read_startup_config(&app_handle);
    Ok(StartupConfigDto {
        start_with_windows: cfg.start_with_windows,
        start_maximized: cfg.start_maximized,
        start_in_tray: cfg.start_in_tray,
        close_to_tray: cfg.close_to_tray,
        launch_mode: cfg.launch_mode,
        startup_window_mode: cfg.startup_window_mode,
    })
}
