use tauri::Manager;

// ---------------------------------------------------------------------------
// close_splashscreen_and_show_main — Part 8
// Closes the splash (webview) window and shows the main window.
// Safe to call even if splash is already closed.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn close_splashscreen_and_show_main(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Try to close splash window (native window-based splash)
    if let Some(splash) = app_handle.get_webview_window("splashscreen") {
        splash.close().map_err(|e| format!("Failed to close splash: {}", e))?;
    }

    // Show and focus main window
    if let Some(main) = app_handle.get_webview_window("main") {
        main.show().map_err(|e| format!("Failed to show main: {}", e))?;
        main.set_focus().map_err(|e| format!("Failed to focus main: {}", e))?;
    }

    Ok(())
}
