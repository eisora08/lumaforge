use tauri::{LogicalPosition, Manager};


#[cfg(target_os = "windows")]
fn force_topmost(window: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::*;
    use windows::Win32::Foundation::*;

    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            SetWindowPos(
                HWND(hwnd .0 as isize),
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            );
        }
    }
}

#[tauri::command]
pub fn show_toast_notification(
    app_handle: tauri::AppHandle,
    message: String,
    variant: String,
    title: String,
    duration: u64,
    theme_surface_active: String,
    theme_surface_border: String,
    theme_surface_blur: String,
    theme_color_text: String,
    theme_color_muted: String,
    theme_color_accent: String,
) -> Result<(), String> {
    let label = "toast-notification";

    let theme = serde_json::json!({
        "surfaceActive": theme_surface_active,
        "surfaceBorder": theme_surface_border,
        "surfaceBlur": theme_surface_blur,
        "colorText": theme_color_text,
        "colorMuted": theme_color_muted,
        "colorAccent": theme_color_accent,
    });

    let data = serde_json::json!({
        "message": message,
        "variant": variant,
        "title": title,
        "duration": duration,
        "theme": theme
    });

    let window = match app_handle.get_webview_window(label) {
        Some(w) => w,
        None => {
            let w = tauri::WebviewWindowBuilder::new(
                &app_handle,
                label,
                tauri::WebviewUrl::App("/toast-notification.html".into()),
            )
            .always_on_top(true)
            .decorations(false)
            .transparent(true)
            .resizable(false)
            .inner_size(440.0, 130.0)
            .skip_taskbar(true)
            .shadow(false)
            .visible(true)
            .build()
            .map_err(|e| format!("Failed to create toast window: {}", e))?;

            position_top_right(&app_handle, &w)?;

            w
        }
    };

    let _ = window.set_focus();

    let _ = window.set_ignore_cursor_events(true);

    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);

    let _ = window.hide();
    let _ = window.show();

    let js = format!(
        "window.__showToast({})",
        serde_json::to_string(&data).unwrap()
    );

    window.eval(&js).ok();

    let app_clone = app_handle.clone();
    std::thread::spawn(move || {
        let total = duration + 350;
        std::thread::sleep(std::time::Duration::from_millis(total));
        if let Some(w) = app_clone.get_webview_window(label) {
            let _ = w.close();
        }
    });

    Ok(())
}

fn position_top_right(
    app_handle: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<(), String> {
    if let Some(main) = app_handle.get_webview_window("main") {
        if let Ok(Some(monitor)) = main.current_monitor() {
            let scale = monitor.scale_factor();
            let logical_size: tauri::LogicalSize<f64> = monitor.size().to_logical(scale);
            let window_size = window.outer_size().map_err(|e| e.to_string())?;
            let logical_window: tauri::LogicalSize<f64> = window_size.to_logical(scale);

            let x = (logical_size.width as i32 - logical_window.width as i32).max(0) - 18;
            let y = 18;

            window
                .set_position(LogicalPosition::new(x, y))
                .map_err(|e| format!("Failed to position: {}", e))?;
        }
    }
    Ok(())
}
