 use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri::Manager;

use crate::commands::game_cache::{get_game_dir, get_media_dir};
use crate::commands::process::hide_window;
use std::process::Command;


#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| format!("Failed to open folder: {}", e))
}

#[tauri::command]
pub fn open_game_metadata_folder(app_handle: AppHandle, app_id: String) -> Result<(), String> {
    let dir = get_game_dir(&app_handle, &app_id)?;
    open::that(&dir).map_err(|e| format!("Failed to open metadata folder: {}", e))
}

#[tauri::command]
pub fn open_game_media_folder(app_handle: AppHandle, app_id: String) -> Result<(), String> {
    let dir = get_media_dir(&app_handle, &app_id)?;
    open::that(&dir).map_err(|e| format!("Failed to open media folder: {}", e))
}

#[tauri::command]
pub fn open_app_data(app_handle: AppHandle) -> Result<(), String> {
    let dir = app_handle.path().app_data_dir().map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    }
    open::that(&dir).map_err(|e| format!("Failed to open app data folder: {}", e))
}

#[tauri::command]
pub fn open_logs(app_handle: AppHandle) -> Result<(), String> {
    let dir = app_handle.path().app_log_dir().map_err(|e| format!("Failed to resolve logs dir: {}", e))?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create logs dir: {}", e))?;
    }
    open::that(&dir).map_err(|e| format!("Failed to open logs folder: {}", e))
}

#[tauri::command]
pub async fn clear_temp_cache(app_handle: AppHandle) -> Result<usize, String> {
    let cache_dir = app_handle.path().app_cache_dir().map_err(|e| format!("Failed to resolve cache dir: {}", e))?;
    let temp_dirs = vec![
        cache_dir.join("temp"),
        cache_dir.join("thumbnails"),
        cache_dir.join("screenshots"),
    ];
    let mut removed = 0usize;
    for dir in &temp_dirs {
        if dir.exists() {
            match std::fs::remove_dir_all(dir) {
                Ok(_) => { removed += 1; }
                Err(e) => eprintln!("[DESKTOP] clear_temp_cache: failed to remove {:?}: {}", dir, e),
            }
        }
    }
    Ok(removed)
}

#[tauri::command]
pub fn get_system_info() -> Result<serde_json::Value, String> {
    use serde_json::json;
    Ok(json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "family": std::env::consts::FAMILY,
        "exe_path": std::env::current_exe().ok().map(|p| p.to_string_lossy().to_string()),
        "current_dir": std::env::current_dir().ok().map(|p| p.to_string_lossy().to_string()),
    }))
}

#[tauri::command]
pub async fn power_shutdown() -> Result<(), String> {
    let cmd = if cfg!(target_os = "windows") {
        hide_window(Command::new("shutdown").args(["/s", "/t", "3"])).spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("osascript").args(["-e", "tell app \"System Events\" to shut down"]).spawn()
    } else {
        std::process::Command::new("systemctl").args(["poweroff"]).spawn()
    };
    cmd.map_err(|e| format!("Failed to trigger shutdown: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn power_suspend() -> Result<(), String> {
    let cmd = if cfg!(target_os = "windows") {
        hide_window(Command::new("rundll32.exe")
            .args(["powrprof.dll,SetSuspendState", "0", "1", "0"]))
            .spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("osascript").args(["-e", "tell app \"System Events\" to sleep"]).spawn()
    } else {
        std::process::Command::new("systemctl").args(["suspend"]).spawn()
    };
    cmd.map_err(|e| format!("Failed to trigger suspend: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn power_hibernate() -> Result<(), String> {
    let cmd = if cfg!(target_os = "windows") {
        hide_window(Command::new("shutdown").args(["/h"])).spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("osascript").args(["-e", "tell app \"System Events\" to sleep"]).spawn()
    } else {
        std::process::Command::new("systemctl").args(["hibernate"]).spawn()
    };
    cmd.map_err(|e| format!("Failed to trigger hibernate: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn power_restart() -> Result<(), String> {
    let cmd = if cfg!(target_os = "windows") {
        hide_window(Command::new("shutdown").args(["/r", "/t", "3"])).spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("osascript").args(["-e", "tell app \"System Events\" to restart"]).spawn()
    } else {
        std::process::Command::new("systemctl").args(["reboot"]).spawn()
    };
    cmd.map_err(|e| format!("Failed to trigger restart: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn create_shortcut(exe_path: String, name: String) -> Result<String, String> {
    use windows::{
        core::{Interface, HSTRING},
        Win32::{
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile,
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{IShellLinkW, ShellLink},
        },
    };

    unsafe {
    
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| format!("COM init failed: {:?}", e))?;

        let shell_link: IShellLinkW = match CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
        {
            Ok(link) => link,
            Err(e) => {
                CoUninitialize();
                return Err(format!("Failed to create ShellLink: {:?}", e));
            }
        };

  
        if !Path::new(&exe_path).exists() {
            CoUninitialize();
            return Err(format!("Invalid executable path: {}", exe_path));
        }


        if let Err(e) = shell_link.SetPath(&HSTRING::from(&exe_path)) {
            CoUninitialize();
            return Err(format!("SetPath failed: {:?}", e));
        }

        if let Some(parent) = Path::new(&exe_path).parent() {
            if let Err(e) =
                shell_link.SetWorkingDirectory(&HSTRING::from(parent.to_string_lossy().to_string()))
            {
                CoUninitialize();
                return Err(format!("SetWorkingDirectory failed: {:?}", e));
            }
        }


        let user = std::env::var("USERPROFILE").map_err(|_| "USERPROFILE not found")?;

        let one_drive_desktop = PathBuf::from(&user).join("OneDrive").join("Desktop");

        let desktop = if one_drive_desktop.exists() {
            one_drive_desktop
        } else {
            PathBuf::from(user).join("Desktop")
        };


        if !desktop.exists() {
            std::fs::create_dir_all(&desktop)
                .map_err(|e| format!("Failed to create desktop dir: {}", e))?;
        }

        let shortcut_path = desktop.join(format!("{}.lnk", name));


        let persist: IPersistFile = match shell_link.cast() {
            Ok(p) => p,
            Err(_) => {
                CoUninitialize();
                return Err("Failed to cast to IPersistFile".to_string());
            }
        };

  
        if let Err(e) = persist.Save(
            &HSTRING::from(shortcut_path.to_string_lossy().to_string()),
            true,
        ) {
            CoUninitialize();
            return Err(format!("Save failed: {:?}", e));
        }


        CoUninitialize();

        Ok(shortcut_path.to_string_lossy().to_string())
    }
}
