use std::collections::HashMap;

use tauri::AppHandle;

use crate::models::install_result::InstallResult;
use crate::utils::progress_utils::emit_installer_progress;
use crate::utils::{archive_utils, download_utils, install_utils};

#[tauri::command]
pub async fn download_and_install_package(
    app_handle: AppHandle,
    job_id: String,
    download_url: String,
    lua_target: String,
    depotcache_target: String,
    create_backups: bool,
    headers: Option<HashMap<String, String>>,
    temp_folder: Option<String>,
) -> Result<InstallResult, String> {
    if job_id.trim().is_empty() {
        return Err("El job_id está vacío.".to_string());
    }

    if download_url.trim().is_empty() {
        return Err("La URL de descarga está vacía.".to_string());
    }

    if lua_target.trim().is_empty() {
        return Err("La ruta config/lua está vacía.".to_string());
    }

    if depotcache_target.trim().is_empty() {
        return Err("La ruta depotcache está vacía.".to_string());
    }

    emit_installer_progress(
        &app_handle,
        &job_id,
        "checking",
        5,
        0,
        0,
        "Verificando descarga",
    );

    let downloaded_file = download_utils::download_file_to_temp(
        &download_url,
        headers,
        temp_folder,
        &app_handle,
        &job_id,
    )
    .await?;

    emit_installer_progress(
        &app_handle,
        &job_id,
        "extracting",
        70,
        downloaded_file.bytes_read,
        downloaded_file.total_bytes,
        "Extrayendo paquete",
    );

    let extracted_folder = archive_utils::extract_zip(&downloaded_file.path)?;

    emit_installer_progress(
        &app_handle,
        &job_id,
        "installing",
        85,
        downloaded_file.bytes_read,
        downloaded_file.total_bytes,
        "Instalando archivos",
    );

    let counts = install_utils::install_extracted_package(
        &extracted_folder,
        &lua_target,
        &depotcache_target,
        create_backups,
    )?;

    emit_installer_progress(
        &app_handle,
        &job_id,
        "done",
        100,
        downloaded_file.bytes_read,
        downloaded_file.total_bytes,
        "Instalación completada",
    );

    Ok(InstallResult {
        lua_installed: counts.lua_installed,
        manifests_installed: counts.manifests_installed,
        backups_created: counts.backups_created,
        bytes_read: downloaded_file.bytes_read,
        total_bytes: downloaded_file.total_bytes,
        zip_path: downloaded_file.path.to_string_lossy().to_string(),
        message: format!(
            "Instalación completada: {} LUA(s), {} manifest(s), {} backup(s)",
            counts.lua_installed,
            counts.manifests_installed,
            counts.backups_created
        ),
    })
}