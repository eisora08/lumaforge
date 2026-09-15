use std::collections::HashMap;
use std::path::Path;

use regex::Regex;
use tauri::AppHandle;
use tauri::Manager;

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

    // Backup manifests to LumaForge backup dir
    if let Some(app_id) = extract_app_id_from_url(&download_url) {
        backup_extracted_manifests(&extracted_folder, &app_handle, app_id);
    }

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

// ---------------------------------------------------------------------------
// Manifest backup helpers
// ---------------------------------------------------------------------------

/// Extract appId from download URL.
/// HubCap: https://hubcapmanifest.com/api/v1/manifest/480 → Some(480)
/// Ryuu: https://generator.ryuu.lol/api/download/480 → Some(480)
fn extract_app_id_from_url(url: &str) -> Option<u64> {
    let re = Regex::new(r"/(\d+)(?:\?|$|#)").ok()?;
    let caps = re.captures(url)?;
    caps.get(1)?.as_str().parse().ok()
}

/// Copy all .manifest files from extracted folder to LumaForge backup dir.
fn backup_extracted_manifests(
    extracted_folder: &Path,
    app_handle: &AppHandle,
    app_id: u64,
) {
    let Ok(app_data) = app_handle.path().app_data_dir() else {
        return;
    };
    let backup_dir = app_data.join("manifest-backup").join(app_id.to_string());
    let _ = std::fs::create_dir_all(&backup_dir);

    for entry in walkdir::WalkDir::new(extracted_folder)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if path.is_file()
            && path
                .extension()
                .and_then(|e| e.to_str())
                == Some("manifest")
        {
            if let Some(name) = path.file_name() {
                let _ = std::fs::copy(path, backup_dir.join(name));
            }
        }
    }
}