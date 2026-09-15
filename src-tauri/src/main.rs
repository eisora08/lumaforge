// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // ── Linux: Force X11 before GTK initializes ─────────────────────────
    // tao 0.35.3 panics on Wayland: window.window().unwrap() returns None
    // because there's no X11-backed GdkWindow under native Wayland.
    // Forces XWayland which is stable. Remove when tao fixes Wayland.
    // See: https://github.com/tauri-apps/tao/issues/1178
    #[cfg(target_os = "linux")]
    {
        if std::env::var("GDK_BACKEND").is_err() {
            std::env::set_var("GDK_BACKEND", "x11");
        }
    }

    // Apply NVIDIA/WebKitGTK workaround (only matters on X11).
    // X11 + NVIDIA → WEBKIT_DISABLE_DMABUF_RENDERER=1
    #[cfg(target_os = "linux")]
    {
        webkit2gtk_nvidia_quirk::apply_workaround_with_options(
            webkit2gtk_nvidia_quirk::ApplyWorkaroundOptions::default(),
        );
    }

    lumaforge_lib::run()
}
