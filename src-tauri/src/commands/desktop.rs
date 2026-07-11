 use std::path::{Path, PathBuf};

use tauri::AppHandle;

use crate::commands::game_cache::{get_game_dir, get_media_dir};


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
