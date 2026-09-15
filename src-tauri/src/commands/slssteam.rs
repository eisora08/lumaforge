use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use tauri::Manager;

use crate::utils::slssteam_config;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SLSSteamStatus {
    pub installed: bool,
    pub slssteam_so_path: Option<String>,
    pub library_inject_so_path: Option<String>,
    pub config_exists: bool,
    pub steam_path: Option<String>,
    pub steam_install_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamLaunchResult {
    pub success: bool,
    pub message: String,
}

// ---------------------------------------------------------------------------
// Path detection
// ---------------------------------------------------------------------------

/// Find the Steam installation directory.
pub fn find_steam_install() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let home = dirs::home_dir()?;
        let candidates = [
            home.join(".steam").join("steam"),
            home.join(".local").join("share").join("Steam"),
            home.join(".var")
                .join("app")
                .join("com.valvesoftware.Steam")
                .join("data")
                .join("Steam"),
        ];

        for path in &candidates {
            if path.join("steamapps").is_dir() {
                return Some(path.to_string_lossy().to_string());
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(key) = winreg::OpenKey::with_predef(
            winreg::HKEY_CURRENT_USER,
            r"Software\Valve\Steam",
        ) {
            if let Ok(val) = key.get_value::<String, _>("SteamPath") {
                return Some(std::path::Path::new(&val)
                    .to_string_lossy()
                    .to_string());
            }
        }
    }

    None
}

/// Detect if Steam installation is Flatpak or Native.
pub fn detect_steam_install_type(steam_path: &str) -> String {
    if steam_path.contains(".var/app/com.valvesoftware.Steam") {
        "flatpak".to_string()
    } else {
        "native".to_string()
    }
}

/// Get the expected SLSsteam library directory based on install type.
fn slssteam_lib_dir(steam_path: &str) -> PathBuf {
    let install_type = detect_steam_install_type(steam_path);

    if install_type == "flatpak" {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".var")
            .join("app")
            .join("com.valvesoftware.Steam")
            .join(".local")
            .join("share")
            .join("SLSsteam")
    } else {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".local")
            .join("share")
            .join("SLSsteam")
    }
}

// ---------------------------------------------------------------------------
// SLS Steam detection
// ---------------------------------------------------------------------------

/// Find SLSsteam.so path.
pub fn find_slssteam_so(steam_path: Option<&str>, app_data_dir: &Path) -> Option<String> {
    // Check known locations
    let mut candidates = vec![
        PathBuf::from("/usr/lib32/libSLSsteam.so"),
        dirs::home_dir()?.join(".local/share/SLSsteam/SLSsteam.so"),
        dirs::home_dir()?.join(".var/app/com.valvesoftware.Steam/.local/share/SLSsteam/SLSsteam.so"),
    ];

    // Also check based on steam_path
    if let Some(sp) = steam_path {
        let install_type = detect_steam_install_type(sp);
        if install_type == "flatpak" {
            candidates.push(
                dirs::home_dir()?.join(".var/app/com.valvesoftware.Steam/.local/share/SLSsteam/SLSsteam.so"),
            );
        } else {
            candidates.push(
                dirs::home_dir()?.join(".local/share/SLSsteam/SLSsteam.so"),
            );
        }
    }

    for path in &candidates {
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    // Check in thirdparty/slssteam/ (LumaForge installation)
    // The SLS Steam 7z extracts into bin/ subdirectory
    let base = app_data_dir.join("thirdparty").join("slssteam");
    let bin_path = base.join("bin").join("SLSsteam.so");
    if bin_path.exists() {
        return Some(bin_path.to_string_lossy().to_string());
    }
    let root_path = base.join("SLSsteam.so");
    if root_path.exists() {
        return Some(root_path.to_string_lossy().to_string());
    }

    None
}

/// Find library-inject.so path.
pub fn find_library_inject_so(steam_path: Option<&str>, app_data_dir: &Path) -> Option<String> {
    let mut candidates = vec![
        PathBuf::from("/usr/lib32/libSLS-library-inject.so"),
        dirs::home_dir()?.join(".local/share/SLSsteam/library-inject.so"),
        dirs::home_dir()?.join(".var/app/com.valvesoftware.Steam/.local/share/SLSsteam/library-inject.so"),
    ];

    if let Some(sp) = steam_path {
        let install_type = detect_steam_install_type(sp);
        if install_type == "flatpak" {
            candidates.push(
                dirs::home_dir()?.join(".var/app/com.valvesoftware.Steam/.local/share/SLSsteam/library-inject.so"),
            );
        } else {
            candidates.push(
                dirs::home_dir()?.join(".local/share/SLSsteam/library-inject.so"),
            );
        }
    }

    for path in &candidates {
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    let base = app_data_dir.join("thirdparty").join("slssteam");
    let bin_path = base.join("bin").join("library-inject.so");
    if bin_path.exists() {
        return Some(bin_path.to_string_lossy().to_string());
    }
    let root_path = base.join("library-inject.so");
    if root_path.exists() {
        return Some(root_path.to_string_lossy().to_string());
    }

    None
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

fn get_app_data_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))
}

/// Get the current SLS Steam status.
#[tauri::command]
pub fn slssteam_status(app_handle: tauri::AppHandle) -> Result<SLSSteamStatus, String> {
    let app_data = get_app_data_dir(&app_handle)?;
    let steam_path = find_steam_install();
    let slssteam_so = find_slssteam_so(steam_path.as_deref(), &app_data);
    let library_inject_so = find_library_inject_so(steam_path.as_deref(), &app_data);
    let config_exists = slssteam_config::config_exists();
    let install_type = steam_path.as_deref().map(detect_steam_install_type);

    Ok(SLSSteamStatus {
        installed: slssteam_so.is_some() && library_inject_so.is_some(),
        slssteam_so_path: slssteam_so,
        library_inject_so_path: library_inject_so,
        config_exists,
        steam_path,
        steam_install_type: install_type,
    })
}

// ---------------------------------------------------------------------------
// Steam process management
// ---------------------------------------------------------------------------

/// Kill the running Steam process.
/// Returns the paths of SLSsteam.so and library-inject.so loaded in the process.
#[tauri::command]
pub fn slssteam_kill_steam() -> Result<bool, String> {
    let output = StdCommand::new("pkill")
        .args(["-f", "^steam$"])
        .output()
        .or_else(|_| {
            // Fallback: try killall
            StdCommand::new("killall")
                .arg("steam")
                .output()
        })
        .map_err(|e| format!("Failed to kill Steam: {e}"))?;

    Ok(output.status.success())
}

// ---------------------------------------------------------------------------
// Steam launch with LD_AUDIT
// ---------------------------------------------------------------------------

/// Start Steam with SLSsteam libraries injected via LD_AUDIT.
#[tauri::command]
pub fn slssteam_start_steam(app_handle: tauri::AppHandle) -> Result<SteamLaunchResult, String> {
    let app_data = get_app_data_dir(&app_handle)?;
    let steam_path = find_steam_install()
        .ok_or("Steam installation not found")?;

    let slssteam_so = find_slssteam_so(Some(&steam_path), &app_data)
        .ok_or("SLSsteam.so not found. Install SLS Steam from Settings > Third-Party Tools.")?;

    let library_inject_so = find_library_inject_so(Some(&steam_path), &app_data)
        .ok_or("library-inject.so not found. Install SLS Steam from Settings > Third-Party Tools.")?;

    // Ensure config exists with API enabled
    let _ = slssteam_config::ensure_api_enabled();

    // Build LD_AUDIT value
    let ld_audit = format!("{library_inject_so}:{slssteam_so}");

    // Set environment and launch Steam
    let mut cmd = StdCommand::new("steam");
    cmd.env("LD_AUDIT", &ld_audit);

    // Set working directory to Steam root
    cmd.current_dir(&steam_path);

    cmd.spawn()
        .map_err(|e| format!("Failed to launch Steam: {e}"))?;

    Ok(SteamLaunchResult {
        success: true,
        message: format!("Steam started with SLS Steam (LD_AUDIT={ld_audit})"),
    })
}

// ---------------------------------------------------------------------------
// Named pipe API (send commands to running SLS Steam)
// ---------------------------------------------------------------------------

/// Send a command to SLS Steam via its named pipe API.
#[tauri::command]
pub fn slssteam_api_send(command: String) -> Result<bool, String> {
    let pipe_path = "/tmp/SLSsteam.API";

    if !Path::new(pipe_path).exists() {
        return Err("SLS Steam API pipe not found. Is Steam running with SLS Steam?".to_string());
    }

    fs::write(pipe_path, &command)
        .map_err(|e| format!("Failed to write to SLS Steam API pipe: {e}"))?;

    Ok(true)
}

// ---------------------------------------------------------------------------
// steam.sh patching
// ---------------------------------------------------------------------------

/// Patch steam.sh to load SLSsteam libraries via LD_AUDIT.
/// Creates a backup of the original file.
#[tauri::command]
pub fn slssteam_patch_steam_sh(app_handle: tauri::AppHandle) -> Result<bool, String> {
    let app_data = get_app_data_dir(&app_handle)?;
    let steam_path = find_steam_install()
        .ok_or("Steam installation not found")?;

    let steam_sh = Path::new(&steam_path).join("steam.sh");
    if !steam_sh.exists() {
        return Err("steam.sh not found".to_string());
    }

    let slssteam_so = find_slssteam_so(Some(&steam_path), &app_data)
        .ok_or("SLSsteam.so not found")?;
    let library_inject_so = find_library_inject_so(Some(&steam_path), &app_data)
        .ok_or("library-inject.so not found")?;

    let install_type = detect_steam_install_type(&steam_path);
    let ld_audit = format!("{library_inject_so}:{slssteam_so}");

    // Read original
    let content = fs::read_to_string(&steam_sh)
        .map_err(|e| format!("Failed to read steam.sh: {e}"))?;

    // Create backup
    let backup = steam_sh.with_extension("sh.bak");
    if !backup.exists() {
        fs::copy(&steam_sh, &backup)
            .map_err(|e| format!("Failed to create backup: {e}"))?;
    }

    // Remove existing LD_AUDIT lines and insert new one
    let lines: Vec<&str> = content.lines().collect();
    let mut new_lines: Vec<String> = Vec::new();
    let mut inserted = false;

    for (i, line) in lines.iter().enumerate() {
        if line.contains("export LD_AUDIT=") {
            continue; // Skip old LD_AUDIT lines
        }
        new_lines.push(line.to_string());

        // Insert after line 10 (index 10)
        if !inserted && i == 9 {
            new_lines.push(format!("export LD_AUDIT={ld_audit}"));
            inserted = true;
        }
    }

    // If we didn't insert yet (file < 10 lines), append at end
    if !inserted {
        new_lines.push(format!("export LD_AUDIT={ld_audit}"));
    }

    let new_content = new_lines.join("\n");
    fs::write(&steam_sh, &new_content)
        .map_err(|e| format!("Failed to write steam.sh: {e}"))?;

    // Create steam.cfg to block updates
    let steam_cfg = Path::new(&steam_path).join("steam.cfg");
    let cfg_content = "BootStrapperInhibitAll=enable\nBootStrapperForceSelfUpdate=disable\n";
    fs::write(&steam_cfg, cfg_content)
        .map_err(|e| format!("Failed to create steam.cfg: {e}"))?;

    Ok(true)
}

// ---------------------------------------------------------------------------
// Config management (delegates to slssteam_config)
// ---------------------------------------------------------------------------

/// Add a game to SLS Steam's AdditionalApps config.
#[tauri::command]
pub fn slssteam_config_add_additional_app(
    app_id: String,
    comment: Option<String>,
) -> Result<bool, String> {
    slssteam_config::add_additional_app(&app_id, comment.as_deref().unwrap_or(""))
}

/// Remove a game from SLS Steam's AdditionalApps config.
#[tauri::command]
pub fn slssteam_config_remove_additional_app(app_id: String) -> Result<bool, String> {
    slssteam_config::remove_additional_app(&app_id)
}

/// Add an AppToken to SLS Steam's config.
#[tauri::command]
pub fn slssteam_config_add_app_token(app_id: String, token: String) -> Result<bool, String> {
    slssteam_config::add_app_token(&app_id, &token)
}

/// Add a FakeAppId to SLS Steam's config.
#[tauri::command]
pub fn slssteam_config_add_fake_app_id(
    app_id: String,
    fake_appid: Option<String>,
    comment: Option<String>,
) -> Result<bool, String> {
    slssteam_config::add_fake_app_id(
        &app_id,
        fake_appid.as_deref().unwrap_or("480"),
        comment.as_deref().unwrap_or(""),
    )
}

/// Remove a FakeAppId from SLS Steam's config.
#[tauri::command]
pub fn slssteam_config_remove_fake_app_id(
    app_id: String,
    fake_appid: Option<String>,
) -> Result<bool, String> {
    slssteam_config::remove_fake_app_id(
        &app_id,
        fake_appid.as_deref().unwrap_or("480"),
    )
}

/// Check if a game is in SLS Steam's AdditionalApps.
#[tauri::command]
pub fn slssteam_config_is_in_additional_apps(app_id: String) -> Result<bool, String> {
    slssteam_config::is_in_additional_apps(&app_id)
}

/// Get all game IDs from SLS Steam's AdditionalApps.
#[tauri::command]
pub fn slssteam_config_get_additional_apps() -> Result<Vec<String>, String> {
    slssteam_config::get_additional_apps()
}

/// Fix indentation in SLS Steam config.
#[tauri::command]
pub fn slssteam_config_fix_indentation() -> Result<bool, String> {
    slssteam_config::fix_additional_apps_indentation()?;
    slssteam_config::fix_app_tokens_indentation()?;
    Ok(true)
}

// ---------------------------------------------------------------------------
// Full setup (patch steam.sh + ensure config)
// ---------------------------------------------------------------------------

/// Perform full SLS Steam setup: patch steam.sh, create steam.cfg, ensure config.
#[tauri::command]
pub fn slssteam_full_setup(app_handle: tauri::AppHandle) -> Result<String, String> {
    let steam_path = find_steam_install()
        .ok_or("Steam installation not found")?;

    // 1. Patch steam.sh
    slssteam_patch_steam_sh(app_handle.clone())?;

    // 2. Ensure config exists
    let config_path = slssteam_config::get_config_path();
    if !config_path.exists() {
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config dir: {e}"))?;
        }
        // Create minimal config
        let default_config = r#"# SLSsteam Configuration
# Generated by LumaForge

DisableFamilyShareLock: yes
UseWhitelist: no
AppIds:
AdditionalApps:
DlcData:
AppTokens:
CDKeys:
FakeOffline:
FakeAppIds:
ManifestIds:
DepotBlacklist:
GameTitles:
SubscriptionTimestamps:
DenuvoGames:
SteamIdOverride:
SmartTickets: 0x1
MaxSchemaTries: 10
LaunchOptions:
SafeMode: no
WarnHashMissmatch: no
NotifyInit: yes
API: yes
Plugins: no
DisableCloud: yes
DisableUpdates: yes
FakeName: ""
FakeEmail: ""
FakeWalletBalance: 0
LogLevels: 0xff
DumpClientInterfaces: no
ExtendedLogging: no
"#;
        fs::write(&config_path, default_config)
            .map_err(|e| format!("Failed to create default config: {e}"))?;
    }

    // 3. Ensure API is enabled
    let _ = slssteam_config::ensure_api_enabled();

    // 4. Fix indentation
    let _ = slssteam_config::fix_additional_apps_indentation();
    let _ = slssteam_config::fix_app_tokens_indentation();

    let install_type = detect_steam_install_type(&steam_path);
    Ok(format!(
        "SLS Steam setup complete ({install_type} installation). Steam.sh patched, steam.cfg created, config initialized."
    ))
}
