use std::fs;
use std::path::Path;
use walkdir::WalkDir;

pub struct InstallCounts {
    pub lua_installed: usize,
    pub manifests_installed: usize,
    pub backups_created: usize,
}

pub fn install_extracted_package(
    extracted_folder: &Path,
    lua_target: &str,
    depotcache_target: &str,
    create_backups: bool,
) -> Result<InstallCounts, String> {
    let lua_target_path = Path::new(lua_target);
    let depotcache_target_path = Path::new(depotcache_target);

    fs::create_dir_all(lua_target_path)
        .map_err(|error| format!("Error creando carpeta lua: {}", error))?;

    fs::create_dir_all(depotcache_target_path)
        .map_err(|error| format!("Error creando carpeta depotcache: {}", error))?;

    let mut counts = InstallCounts {
        lua_installed: 0,
        manifests_installed: 0,
        backups_created: 0,
    };

    for entry in WalkDir::new(extracted_folder).into_iter().filter_map(Result::ok) {
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let extension = path
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("")
            .to_lowercase();

        match extension.as_str() {
            "lua" => {
                let created_backup =
                    copy_with_optional_backup(path, lua_target_path, create_backups)?;
                counts.lua_installed += 1;

                if created_backup {
                    counts.backups_created += 1;
                }
            }
            "manifest" => {
                let created_backup =
                    copy_with_optional_backup(path, depotcache_target_path, create_backups)?;
                counts.manifests_installed += 1;

                if created_backup {
                    counts.backups_created += 1;
                }
            }
            _ => {}
        }
    }

    Ok(counts)
}

fn copy_with_optional_backup(
    source_file: &Path,
    target_folder: &Path,
    create_backups: bool,
) -> Result<bool, String> {
    let file_name = source_file
        .file_name()
        .ok_or("Archivo sin nombre válido")?;

    let target_file = target_folder.join(file_name);
    let mut backup_created = false;

    if target_file.exists() && create_backups {
        let backup_file = create_backup_path(&target_file);

        fs::copy(&target_file, &backup_file)
            .map_err(|error| format!("Error creando backup: {}", error))?;

        backup_created = true;
    }

    fs::copy(source_file, &target_file)
        .map_err(|error| format!("Error copiando archivo: {}", error))?;

    Ok(backup_created)
}

fn create_backup_path(target_file: &Path) -> std::path::PathBuf {
    let file_name = target_file
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();

    target_file.with_file_name(format!("{}.backup", file_name))
}