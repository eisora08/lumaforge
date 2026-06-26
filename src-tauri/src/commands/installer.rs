use crate::models::install_result::InstallResult;
use crate::utils::{archive_utils, download_utils, install_utils};

#[tauri::command]
pub fn download_and_install_package(
    download_url: String,
    lua_target: String,
    depotcache_target: String,
    create_backups: bool,
) -> Result<InstallResult, String> {
    if download_url.trim().is_empty() {
        return Err("La URL de descarga está vacía.".to_string());
    }

    if lua_target.trim().is_empty() {
        return Err("La ruta config/lua está vacía.".to_string());
    }

    if depotcache_target.trim().is_empty() {
        return Err("La ruta depotcache está vacía.".to_string());
    }

    let zip_path = download_utils::download_file_to_temp(&download_url)?;
    let extracted_folder = archive_utils::extract_zip(&zip_path)?;

    let counts = install_utils::install_extracted_package(
        &extracted_folder,
        &lua_target,
        &depotcache_target,
        create_backups,
    )?;

    Ok(InstallResult {
        lua_installed: counts.lua_installed,
        manifests_installed: counts.manifests_installed,
        backups_created: counts.backups_created,
        message: format!(
            "Instalación completada: {} LUA(s), {} manifest(s), {} backup(s)",
            counts.lua_installed,
            counts.manifests_installed,
            counts.backups_created
        ),
    })
}