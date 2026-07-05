use tauri::{LogicalPosition, Manager};

#[tauri::command]
pub fn show_achievement_overlay(
    app_handle: tauri::AppHandle,
    name: String,
    icon_url: Option<String>,
    app_id: Option<String>,
    rarity: Option<f64>,
    game_title: Option<String>,
    duration: Option<u64>,
    theme_vars: Option<serde_json::Value>,
    overlay_position: Option<String>,
) -> Result<(), String> {
    eprintln!("[ACH][OVERLAY][RUST] command_start");

    let dur = duration.unwrap_or(4500);
    let mut data = serde_json::json!({
        "name": name,
        "iconUrl": icon_url,
        "appId": app_id,
        "rarity": rarity,
        "gameTitle": game_title,
        "duration": dur,
    });
    if let Some(vars) = theme_vars {
        data["themeVars"] = vars;
    }
    let position = overlay_position.clone().unwrap_or_else(|| "top-right".to_string());
    data["overlayPosition"] = serde_json::Value::String(position.clone());
    let js = format!(
        "window.__showAchievementToast({})",
        serde_json::to_string(&data).unwrap()
    );

    eprintln!("[ACH][OVERLAY][RUST] dispatch_bg");

    let app_clone = app_handle.clone();
    let pos = position.clone();
    let label = "toast-notification";
    std::thread::spawn(move || {
        eprintln!("[ACH][OVERLAY][RUST] bg_start");

        let window = match app_clone.get_webview_window(label) {
            Some(w) => {
                eprintln!("[ACH][OVERLAY][RUST] window_exists=true");
                w
            }
            None => {
                eprintln!("[ACH][OVERLAY][RUST] window_create_start");
                let w = match tauri::WebviewWindowBuilder::new(
                    &app_clone,
                    label,
                    tauri::WebviewUrl::App("/toast-notification.html".into()),
                )
                .always_on_top(true)
                .decorations(false)
                .transparent(true)
                .resizable(false)
                .inner_size(420.0, 110.0)
                .skip_taskbar(true)
                .shadow(false)
                .visible(false)
                .build()
                {
                    Ok(w) => w,
                    Err(e) => {
                        eprintln!(
                            "[ACH][OVERLAY][RUST] window_create_failed error={}",
                            e
                        );
                        return;
                    }
                };
                eprintln!("[ACH][OVERLAY][RUST] window_created");
                w
            }
        };
        let _ = position_window(&app_clone, &window, &pos);

        // Brief pause for page JS to initialize before eval
        std::thread::sleep(std::time::Duration::from_millis(500));

        eprintln!("[ACH][OVERLAY][RUST] emit_start");
        let debug_js = if js.len() > 200 {
            format!("{}...[truncated]", &js[..200])
        } else {
            js.clone()
        };
        eprintln!("[ACH][OVERLAY][RUST] eval_js len={}: {}", js.len(), debug_js);
        let eval_result = window.eval(&js);
        match &eval_result {
            Ok(_) => eprintln!("[ACH][OVERLAY][RUST] eval_ok"),
            Err(e) => eprintln!("[ACH][OVERLAY][RUST] eval_error={}", e),
        }
        eprintln!("[ACH][OVERLAY][RUST] emit_done");

        // Show window only after content is rendered
        let _ = window.set_focus();
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        eprintln!("[ACH][OVERLAY][RUST] show_done");

        // Auto-close after duration
        std::thread::sleep(std::time::Duration::from_millis(dur + 350));
        eprintln!("[ACH][OVERLAY][RUST] hide_done");
        if let Some(w) = app_clone.get_webview_window(label) {
            let _ = w.close();
        }
    });

    eprintln!("[ACH][OVERLAY][RUST] command_return_ok");
    Ok(())
}

#[tauri::command]
pub fn show_session_overlay(
    app_handle: tauri::AppHandle,
    session_type: String,
    game_title: String,
    provider: String,
    image_url: Option<String>,
    duration_seconds: Option<u64>,
    duration: Option<u64>,
    theme_vars: Option<serde_json::Value>,
    overlay_position: Option<String>,
) -> Result<(), String> {
    eprintln!("[SESSION][OVERLAY][RUST] command_start type={}", session_type);

    let dur = duration.unwrap_or(if session_type == "launch" { 3000 } else { 4000 });
    let mut data = serde_json::json!({
        "sessionType": session_type,
        "gameTitle": game_title,
        "provider": provider,
        "imageUrl": image_url,
        "durationSeconds": duration_seconds,
        "duration": dur,
    });
    if let Some(vars) = theme_vars {
        data["themeVars"] = vars;
    }
    let position = overlay_position.clone().unwrap_or_else(|| "top-right".to_string());
    data["overlayPosition"] = serde_json::Value::String(position.clone());
    let js = format!(
        "window.__showSessionToast({})",
        serde_json::to_string(&data).unwrap()
    );

    eprintln!("[SESSION][OVERLAY][RUST] dispatch_bg");

    let app_clone = app_handle.clone();
    let pos = position.clone();
    let label = "toast-notification";
    std::thread::spawn(move || {
        eprintln!("[SESSION][OVERLAY][RUST] bg_start");

        let window = match app_clone.get_webview_window(label) {
            Some(w) => {
                eprintln!("[SESSION][OVERLAY][RUST] window_exists=true");
                w
            }
            None => {
                eprintln!("[SESSION][OVERLAY][RUST] window_create_start");
                let w = match tauri::WebviewWindowBuilder::new(
                    &app_clone,
                    label,
                    tauri::WebviewUrl::App("/toast-notification.html".into()),
                )
                .always_on_top(true)
                .decorations(false)
                .transparent(true)
                .resizable(false)
                .inner_size(420.0, 250.0)
                .skip_taskbar(true)
                .shadow(false)
                .visible(false)
                .build()
                {
                    Ok(w) => w,
                    Err(e) => {
                        eprintln!(
                            "[SESSION][OVERLAY][RUST] window_create_failed error={}",
                            e
                        );
                        return;
                    }
                };
                eprintln!("[SESSION][OVERLAY][RUST] window_created");
                w
            }
        };
        let _ = position_window(&app_clone, &window, &pos);

        std::thread::sleep(std::time::Duration::from_millis(500));

        eprintln!("[SESSION][OVERLAY][RUST] emit_start");
        let debug_js = if js.len() > 200 {
            format!("{}...[truncated]", &js[..200])
        } else {
            js.clone()
        };
        eprintln!("[SESSION][OVERLAY][RUST] eval_js len={}: {}", js.len(), debug_js);
        let eval_result = window.eval(&js);
        match &eval_result {
            Ok(_) => eprintln!("[SESSION][OVERLAY][RUST] eval_ok"),
            Err(e) => eprintln!("[SESSION][OVERLAY][RUST] eval_error={}", e),
        }
        eprintln!("[SESSION][OVERLAY][RUST] emit_done");

        let _ = window.set_focus();
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        eprintln!("[SESSION][OVERLAY][RUST] show_done");

        std::thread::sleep(std::time::Duration::from_millis(dur + 350));
        eprintln!("[SESSION][OVERLAY][RUST] hide_done");
        if let Some(w) = app_clone.get_webview_window(label) {
            let _ = w.close();
        }
    });

    eprintln!("[SESSION][OVERLAY][RUST] command_return_ok");
    Ok(())
}

#[tauri::command]
pub fn close_toast_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    eprintln!("[ACH][OVERLAY][RUST] close_toast_window");
    if let Some(window) = app_handle.get_webview_window("toast-notification") {
        let _ = window.hide();
    }
    Ok(())
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

            position_window(&app_handle, &w, "top-right")?;

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

fn position_window(
    app_handle: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    position: &str,
) -> Result<(), String> {
    if let Some(main) = app_handle.get_webview_window("main") {
        if let Ok(Some(monitor)) = main.current_monitor() {
            let scale = monitor.scale_factor();
            let logical_size: tauri::LogicalSize<f64> = monitor.size().to_logical(scale);
            let window_size = window.outer_size().map_err(|e| e.to_string())?;
            let logical_window: tauri::LogicalSize<f64> = window_size.to_logical(scale);

            let pad: i32 = 18;
            let w = logical_window.width as i32;
            let h = logical_window.height as i32;
            let mw = logical_size.width as i32;
            let mh = logical_size.height as i32;

            let (x, y) = match position {
                "top-left" => (pad, pad),
                "top-right" => ((mw - w).max(0) - pad, pad),
                "bottom-left" => (pad, (mh - h).max(0) - pad),
                "bottom-right" => ((mw - w).max(0) - pad, (mh - h).max(0) - pad),
                "top-center" => (((mw - w) / 2).max(0), pad),
                "bottom-center" => (((mw - w) / 2).max(0), (mh - h).max(0) - pad),
                _ => ((mw - w).max(0) - pad, pad),
            };

            window
                .set_position(LogicalPosition::new(x, y))
                .map_err(|e| format!("Failed to position: {}", e))?;
        }
    }
    Ok(())
}
