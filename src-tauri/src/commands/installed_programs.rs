use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[cfg(windows)]
use winreg::enums::*;
#[cfg(windows)]
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

#[cfg(windows)]
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
#[cfg(windows)]
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

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn scan_installed_programs() -> Result<Vec<InstalledProgram>, String> {
    let mut results: Vec<InstalledProgram> = Vec::new();
    let mut seen_names: std::collections::HashSet<String> = std::collections::HashSet::new();

    let mut desktop_dirs: Vec<std::path::PathBuf> = Vec::new();

    // Standard XDG application directories
    if let Ok(home) = std::env::var("HOME") {
        let home = std::path::PathBuf::from(&home);
        desktop_dirs.push(home.join(".local/share/applications"));
        desktop_dirs.push(home.join(".local/share/flatpak/exports/share/applications"));
        desktop_dirs.push(home.join(".var/app/*/share/applications"));
    }
    desktop_dirs.push(std::path::PathBuf::from("/usr/share/applications"));
    desktop_dirs.push(std::path::PathBuf::from("/usr/local/share/applications"));
    desktop_dirs.push(std::path::PathBuf::from("/var/lib/flatpak/exports/share/applications"));
    desktop_dirs.push(std::path::PathBuf::from("/opt/*/share/applications"));
    desktop_dirs.push(std::path::PathBuf::from("/snap/*/current/meta/gui"));

    // Also check for AppImage desktop files
    if let Ok(home) = std::env::var("HOME") {
        desktop_dirs.push(std::path::PathBuf::from(&home).join("Desktop"));
    }

    for dir in &desktop_dirs {
        // Handle glob patterns by expanding them
        let expanded_dirs = if dir.to_string_lossy().contains('*') {
            expand_glob_dirs(dir)
        } else {
            vec![dir.clone()]
        };

        for expanded_dir in &expanded_dirs {
            if !expanded_dir.exists() {
                continue;
            }

            let entries = match fs::read_dir(expanded_dir) {
                Ok(e) => e,
                Err(_) => continue,
            };

            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if ext != "desktop" {
                    continue;
                }

                if let Some(program) = parse_desktop_file(&path) {
                    let name_lower = program.name.to_lowercase();
                    // Skip system/hidden entries
                    if name_lower.starts_with("gnome-")
                        || name_lower.starts_with("org.gnome.")
                        || name_lower.starts_with("kde-")
                        || name_lower.starts_with("org.kde.")
                    {
                        continue;
                    }
                    if !seen_names.insert(name_lower) {
                        continue;
                    }
                    results.push(program);
                }
            }
        }
    }

    results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(results)
}

fn expand_glob_dirs(pattern: &std::path::Path) -> Vec<std::path::PathBuf> {
    let pattern_str = pattern.to_string_lossy().to_string();
    let parts: Vec<&str> = pattern_str.splitn(2, '*').collect();
    if parts.len() < 2 {
        return vec![pattern.to_path_buf()];
    }
    let prefix = parts[0];
    let suffix = parts[1];

    let prefix_path = std::path::Path::new(prefix);
    if !prefix_path.exists() {
        return vec![];
    }

    let mut results = Vec::new();
    if let Ok(entries) = fs::read_dir(prefix_path) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let candidate = entry.path().join(suffix.trim_start_matches('/'));
                if candidate.exists() {
                    results.push(candidate);
                }
            }
        }
    }
    results
}

fn parse_desktop_file(path: &std::path::Path) -> Option<InstalledProgram> {
    let content = fs::read_to_string(path).ok()?;
    let mut name: Option<String> = None;
    let mut exec: Option<String> = None;
    let mut icon: Option<String> = None;
    let mut no_display = false;
    let mut in_desktop_entry = false;

    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_desktop_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_desktop_entry {
            continue;
        }
        if line.starts_with("NoDisplay=true") {
            no_display = true;
        }
        if let Some(val) = line.strip_prefix("Name=") {
            if name.is_none() {
                name = Some(val.to_string());
            }
        }
        if let Some(val) = line.strip_prefix("Exec=") {
            // Exec can contain %f, %u, etc. — strip those
            let exec_clean = val
                .split_whitespace()
                .filter(|arg| !arg.starts_with('%'))
                .collect::<Vec<_>>()
                .join(" ");
            exec = Some(exec_clean);
        }
        if let Some(val) = line.strip_prefix("Icon=") {
            icon = Some(val.to_string());
        }
    }

    if no_display {
        return None;
    }

    let name = name?;
    let exec_path = exec.as_deref().unwrap_or("");

    // Resolve the executable path
    let exe_path = if exec_path.starts_with('/') {
        Some(exec_path.to_string())
    } else if !exec_path.is_empty() {
        // Try to find it in PATH
        std::process::Command::new("which")
            .arg(exec_path.split_whitespace().next().unwrap_or(""))
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                } else {
                    None
                }
            })
    } else {
        None
    };

    // Get install path from the .desktop file location
    let install_path = path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    Some(InstalledProgram {
        name,
        install_path,
        exe_path,
        display_icon: icon,
        estimated_size_kb: None,
    })
}
