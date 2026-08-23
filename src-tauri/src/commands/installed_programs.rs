use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use winreg::enums::*;
use winreg::RegKey;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledProgram {
    pub name: String,
    pub install_path: String,
    pub exe_path: Option<String>,
    pub display_icon: Option<String>,
    pub estimated_size_kb: Option<u32>,
}

const REGISTRY_UNINSTALL_PATHS: &[(&str, bool)] = &[
    // (path, is_hkcu)
    (
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        false,
    ),
    (
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        false,
    ),
    (
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        true,
    ),
];

fn extract_icon_path(display_icon: &str) -> Option<String> {
    // DisplayIcon can be: "C:\path\app.exe" or "C:\path\app.exe,0" or "C:\path\icon.ico"
    let trimmed = display_icon.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Split on comma — take the path part (before first comma)
    let icon_path = if let Some(comma_pos) = trimmed.find(',') {
        &trimmed[..comma_pos]
    } else {
        trimmed
    };
    // Strip surrounding quotes if present
    let icon_path = icon_path.trim().trim_matches('"');
    if icon_path.is_empty() {
        return None;
    }
    Some(icon_path.to_string())
}

fn find_main_exe_in_dir(dir: &str) -> Option<String> {
    // Find the largest .exe in the install directory (depth 1, non-recursive)
    let path = Path::new(dir);
    if !path.exists() || !path.is_dir() {
        return None;
    }

    let mut best: Option<(String, u64)> = None;

    let entries = match fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => return None,
    };

    for entry in entries.flatten() {
        let file_path = entry.path();
        if !file_path.is_file() {
            continue;
        }
        let ext = file_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if ext != "exe" {
            continue;
        }
        let name = file_path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let lower = name.to_lowercase();
        // Skip obvious non-game exes
        if lower.starts_with("unins")
            || lower.starts_with("uninstall")
            || lower.starts_with("setup")
            || lower.starts_with("vcredist")
            || lower.starts_with("vc_redist")
            || lower.starts_with("dxsetup")
            || lower.starts_with("dotnet")
            || lower.starts_with("install")
            || lower.starts_with("update")
        {
            continue;
        }
        let size = fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0);
        match &best {
            Some((_, best_size)) if size <= *best_size => {}
            _ => {
                best = Some((file_path.to_string_lossy().to_string(), size));
            }
        }
    }

    best.map(|(p, _)| p)
}

/// Scan Windows Uninstall registry for ALL installed programs.
/// Returns a comprehensive list with name, install path, exe, icon, and size.
#[tauri::command]
pub fn scan_installed_programs() -> Result<Vec<InstalledProgram>, String> {
    let mut results: Vec<InstalledProgram> = Vec::new();
    let mut seen_names: std::collections::HashSet<String> = std::collections::HashSet::new();

    for &(reg_path, is_hkcu) in REGISTRY_UNINSTALL_PATHS {
        let root_key = if is_hkcu {
            RegKey::predef(HKEY_CURRENT_USER)
        } else {
            RegKey::predef(HKEY_LOCAL_MACHINE)
        };

        let root = match root_key.open_subkey_with_flags(reg_path, KEY_READ) {
            Ok(k) => k,
            Err(_) => continue,
        };

        for subkey_name in root.enum_keys().filter_map(|r| r.ok()) {
            let subkey = match root.open_subkey_with_flags(&subkey_name, KEY_READ) {
                Ok(k) => k,
                Err(_) => continue,
            };

            let display_name: String = match subkey.get_value("DisplayName") {
                Ok(v) => v,
                Err(_) => continue,
            };

            let display_name = display_name.trim().to_string();
            if display_name.is_empty() {
                continue;
            }

            // Deduplicate by name (HKLM may have same entry as HKCU)
            if !seen_names.insert(display_name.to_lowercase()) {
                continue;
            }

            let install_location: String = subkey
                .get_value("InstallLocation")
                .unwrap_or_default();
            let install_location = install_location.trim().to_string();

            // Skip entries with no install location
            if install_location.is_empty() {
                continue;
            }

            // Skip entries that are just redistributables / system components
            let name_lower = display_name.to_lowercase();
            if name_lower.starts_with("microsoft")
                || name_lower.starts_with("windows")
                || name_lower.starts_with("redistributable")
                || name_lower.contains("visual c++")
                || name_lower.contains("runtime")
                || name_lower.contains(".net")
                || name_lower.contains("directx")
                || name_lower.contains("framework")
            {
                continue;
            }

            let display_icon: Option<String> = subkey
                .get_value("DisplayIcon")
                .ok()
                .and_then(|v: String| extract_icon_path(&v));

            let estimated_size_kb: Option<u32> = subkey
                .get_value("EstimatedSize")
                .ok()
                .map(|v: u32| v);

            // Try to find the main exe in the install directory
            let exe_path = find_main_exe_in_dir(&install_location);

            results.push(InstalledProgram {
                name: display_name,
                install_path: install_location,
                exe_path,
                display_icon,
                estimated_size_kb,
            });
        }
    }

    // Sort alphabetically by name
    results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(results)
}
