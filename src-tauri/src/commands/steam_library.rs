use std::fs;
use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::utils::path_utils;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SteamLibraryInfo {
    pub path: String,
    pub is_primary: bool,
    pub has_steamapps: bool,
    pub disk_space_available: u64,
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/// Ensure the steamapps directory structure exists in a Steam library.
/// Creates `steamapps/`, `steamapps/common/`, and `depotcache/` if missing.
pub fn ensure_steamapps_structure(library_path: &str) -> Result<(), String> {
    let root = Path::new(library_path);

    let steamapps = root.join("steamapps");
    fs::create_dir_all(&steamapps)
        .map_err(|e| format!("Failed to create steamapps dir: {e}"))?;

    let common = steamapps.join("common");
    fs::create_dir_all(&common)
        .map_err(|e| format!("Failed to create common dir: {e}"))?;

    let depotcache = root.join("depotcache");
    fs::create_dir_all(&depotcache)
        .map_err(|e| format!("Failed to create depotcache dir: {e}"))?;

    Ok(())
}

/// Move game files from source directory to Steam library's steamapps/common/.
/// Returns the final install path.
pub fn install_game_to_library(
    source_dir: &str,
    library_path: &str,
    app_id: u64,
    game_name: &str,
    installdir: &str,
) -> Result<String, String> {
    ensure_steamapps_structure(library_path)?;

    let source = Path::new(source_dir);
    if !source.exists() {
        return Err(format!("Source directory does not exist: {source_dir}"));
    }

    let target = Path::new(library_path)
        .join("steamapps")
        .join("common")
        .join(installdir);

    // If target exists, remove it first (clean install)
    if target.exists() {
        fs::remove_dir_all(&target)
            .map_err(|e| format!("Failed to remove existing install: {e}"))?;
    }

    // Move all files from source to target
    fs::rename(source, &target)
        .map_err(|e| format!("Failed to move game files: {e}"))?;

    Ok(target.to_string_lossy().to_string())
}

/// Move manifest files from source to depotcache.
/// Manifests are expected at `{source_dir}/{depot_id}_{gid}.manifest`.
pub fn move_manifests_to_depotcache(
    source_dir: &str,
    library_path: &str,
    depots: &[(u64, String)], // (depot_id, manifest_gid)
) -> Result<u32, String> {
    ensure_steamapps_structure(library_path)?;

    let depotcache = Path::new(library_path).join("depotcache");
    let mut moved_count: u32 = 0;

    for (depot_id, manifest_gid) in depots {
        let filename = format!("{}_{}.manifest", depot_id, manifest_gid);
        let source = Path::new(source_dir).join(&filename);
        let dest = depotcache.join(&filename);

        if source.exists() {
            fs::copy(&source, &dest)
                .map_err(|e| format!("Failed to copy manifest {filename}: {e}"))?;
            moved_count += 1;
        }
    }

    Ok(moved_count)
}

/// Move manifests and backup copies to LumaForge backup dir.
pub fn move_manifests_to_depotcache_with_backup(
    app_handle: &tauri::AppHandle,
    app_id: u64,
    source_dir: &str,
    library_path: &str,
    depots: &[(u64, String)],
) -> Result<u32, String> {
    let count = move_manifests_to_depotcache(source_dir, library_path, depots)?;

    // Backup copies
    if let Ok(app_data) = app_handle.path().app_data_dir() {
        let backup_dir = app_data.join("manifest-backup").join(app_id.to_string());
        let _ = fs::create_dir_all(&backup_dir);
        for (depot_id, manifest_gid) in depots {
            let filename = format!("{}_{}.manifest", depot_id, manifest_gid);
            let source = Path::new(source_dir).join(&filename);
            if source.exists() {
                let _ = fs::copy(&source, backup_dir.join(&filename));
            }
        }
    }

    Ok(count)
}

/// Update libraryfolders.vdf to include an app in this library.
/// Steam uses this to track which apps are in which library folder.
pub fn update_libraryfolders_vdf(
    library_path: &str,
    app_id: u64,
) -> Result<(), String> {
    let vdf_path = Path::new(library_path)
        .join("steamapps")
        .join("libraryfolders.vdf");

    let mut content = if vdf_path.exists() {
        fs::read_to_string(&vdf_path)
            .map_err(|e| format!("Failed to read libraryfolders.vdf: {e}"))?
    } else {
        create_default_libraryfolders_vdf(library_path)
    };

    let app_id_str = app_id.to_string();

    // Check if app is already listed
    if content.contains(&format!("\"{app_id_str}\"")) {
        return Ok(());
    }

    // Find the library folder entry that matches our path and add the app
    // Simple approach: add the app to the first library folder section
    // The format is:
    // "libraryfolders"
    // {
    //     "0"
    //     {
    //         "path"		"/home/user/.steam/steam"
    //         "apps"
    //         {
    //             "730"		"30000000000"
    //         }
    //     }
    // }

    // Try to find existing "apps" block and add our app
    let apps_pattern = "\"apps\"";
    if let Some(pos) = content.find(apps_pattern) {
        // Find the opening brace after "apps"
        if let Some(brace_pos) = content[pos..].find('{') {
            let insert_at = pos + brace_pos + 1;
            let indent = "\t\t\t\t";
            let line = format!("{}\"{}\"\t\t\"0\"\n", indent, app_id_str);
            content.insert_str(insert_at, &line);
        }
    } else {
        // No apps block found, add a minimal one
        // Find the end of the first library folder section
        if let Some(pos) = content.find("\"path\"") {
            if let Some(line_end) = content[pos..].find('\n') {
                let insert_at = pos + line_end + 1;
                let block = format!(
                    "\t\t\t\"apps\"\n\t\t\t{{\n\t\t\t\t\"{}\"\t\t\"0\"\n\t\t\t}}\n",
                    app_id_str
                );
                content.insert_str(insert_at, &block);
            }
        }
    }

    fs::write(&vdf_path, &content)
        .map_err(|e| format!("Failed to write libraryfolders.vdf: {e}"))?;

    Ok(())
}

/// Detect all Steam libraries on the system.
pub fn detect_steam_libraries() -> Vec<SteamLibraryInfo> {
    let mut libraries = Vec::new();

    // Get primary Steam path
    if let Some(paths) = path_utils::detect_steam_paths() {
        let steam_root = &paths.steam_root;
        let disk_space = get_disk_space(steam_root);

        libraries.push(SteamLibraryInfo {
            path: steam_root.clone(),
            is_primary: true,
            has_steamapps: Path::new(steam_root)
                .join("steamapps")
                .is_dir(),
            disk_space_available: disk_space,
        });

        // Try to find additional libraries from libraryfolders.vdf
        let vdf_path = Path::new(steam_root)
            .join("steamapps")
            .join("libraryfolders.vdf");

        if vdf_path.exists() {
            if let Ok(content) = fs::read_to_string(&vdf_path) {
                for path in parse_library_paths_from_vdf(&content) {
                    if path != *steam_root && !libraries.iter().any(|l| l.path == path) {
                        let disk_space = get_disk_space(&path);
                        libraries.push(SteamLibraryInfo {
                            path: path.clone(),
                            is_primary: false,
                            has_steamapps: Path::new(&path)
                                .join("steamapps")
                                .is_dir(),
                            disk_space_available: disk_space,
                        });
                    }
                }
            }
        }
    }

    libraries
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn steam_library_install_game(
    source_dir: String,
    library_path: String,
    app_id: u64,
    game_name: String,
    installdir: String,
) -> Result<String, String> {
    install_game_to_library(&source_dir, &library_path, app_id, &game_name, &installdir)
}

#[tauri::command]
pub async fn steam_library_move_manifests(
    app_handle: tauri::AppHandle,
    source_dir: String,
    library_path: String,
    depots: Vec<(u64, String)>,
    app_id: Option<u64>,
) -> Result<u32, String> {
    if let Some(id) = app_id {
        move_manifests_to_depotcache_with_backup(&app_handle, id, &source_dir, &library_path, &depots)
    } else {
        move_manifests_to_depotcache(&source_dir, &library_path, &depots)
    }
}

#[tauri::command]
pub async fn steam_library_update_vdf(
    library_path: String,
    app_id: u64,
) -> Result<(), String> {
    update_libraryfolders_vdf(&library_path, app_id)
}

#[tauri::command]
pub async fn steam_library_detect() -> Result<Vec<SteamLibraryInfo>, String> {
    Ok(detect_steam_libraries())
}

#[tauri::command]
pub async fn steam_library_ensure_structure(
    library_path: String,
) -> Result<(), String> {
    ensure_steamapps_structure(&library_path)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn create_default_libraryfolders_vdf(steam_path: &str) -> String {
    format!(
        r#""libraryfolders"
{{
	"0"
	{{
		"path"		"{steam_path}"
		"label"		""
		"apps"
		{{
		}}
	}}
}}
"#
    )
}

fn parse_library_paths_from_vdf(content: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let mut in_libraryfolders = false;
    let mut in_folder = false;
    let mut depth = 0;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed == "\"libraryfolders\"" {
            in_libraryfolders = true;
            continue;
        }

        if in_libraryfolders {
            if trimmed == "{" {
                depth += 1;
                continue;
            }
            if trimmed == "}" {
                depth -= 1;
                if depth == 0 {
                    in_libraryfolders = false;
                }
                continue;
            }

            // We're inside a folder entry
            if depth == 1 && trimmed.starts_with('"') && trimmed.ends_with('"') {
                // This is a folder number like "0", "1", etc.
                in_folder = true;
                continue;
            }

            if in_folder && depth == 2 {
                // Parse "path" entry
                if trimmed.starts_with("\"path\"") {
                    let parts: Vec<&str> = trimmed.split('"').collect();
                    if parts.len() >= 4 {
                        let path = parts[3].to_string();
                        if !path.is_empty() {
                            paths.push(path);
                        }
                    }
                    in_folder = false;
                }
            }
        }
    }

    paths
}

fn get_disk_space(path: &str) -> u64 {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::MetadataExt;
        if let Ok(metadata) = fs::metadata(path) {
            // Approximate: use statvfs if available
            // For now, return 0 as a placeholder
            // A proper implementation would use libc::statvfs
            let _ = metadata;
        }
    }
    0
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ensure_steamapps_structure() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().to_str().unwrap();

        ensure_steamapps_structure(path).unwrap();

        assert!(tmp.path().join("steamapps").is_dir());
        assert!(tmp.path().join("steamapps/common").is_dir());
        assert!(tmp.path().join("depotcache").is_dir());
    }

    #[test]
    fn test_install_game_to_library() {
        let tmp = tempfile::TempDir::new().unwrap();
        let lib_path = tmp.path().join("library");
        let source = tmp.path().join("downloaded_game");

        // Create source with a test file
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("game.exe"), "test").unwrap();

        let result = install_game_to_library(
            source.to_str().unwrap(),
            lib_path.to_str().unwrap(),
            730,
            "Test Game",
            "TestGame",
        )
        .unwrap();

        assert!(Path::new(&result).exists());
        assert!(Path::new(&result).join("game.exe").exists());
    }

    #[test]
    fn test_move_manifests_to_depotcache() {
        let tmp = tempfile::TempDir::new().unwrap();
        let lib_path = tmp.path().join("library");
        let source = tmp.path().join("manifests");

        // Create source manifests
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("2555350_12345.manifest"), "test").unwrap();
        fs::write(source.join("2555351_67890.manifest"), "test2").unwrap();

        let depots = vec![(2555350, "12345".to_string())];
        let moved = move_manifests_to_depotcache(
            source.to_str().unwrap(),
            lib_path.to_str().unwrap(),
            &depots,
        )
        .unwrap();

        assert_eq!(moved, 1);
        assert!(lib_path.join("depotcache/2555350_12345.manifest").exists());
        assert!(!lib_path.join("depotcache/2555351_67890.manifest").exists());
    }

    #[test]
    fn test_parse_library_paths_from_vdf() {
        let vdf = r#""libraryfolders"
{
	"0"
	{
		"path"		"/home/user/.steam/steam"
		"apps"
		{
			"730"		"30000000000"
		}
	}
	"1"
	{
		"path"		"/mnt/games/SteamLibrary"
		"apps"
		{
		}
	}
}"#;

        let paths = parse_library_paths_from_vdf(vdf);
        assert_eq!(paths.len(), 2);
        assert!(paths.contains(&"/home/user/.steam/steam".to_string()));
        assert!(paths.contains(&"/mnt/games/SteamLibrary".to_string()));
    }
}
