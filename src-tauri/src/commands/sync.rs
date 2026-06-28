use std::fs;
use std::io::Read;
use std::path::PathBuf;

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use crate::models::sync_index::{SyncCheckResult, SyncIndex, SyncIndexItem};

fn get_index_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo obtener el directorio de datos: {}", e))?;

    fs::create_dir_all(&app_dir)
        .map_err(|e| format!("No se pudo crear el directorio de datos: {}", e))?;

    Ok(app_dir.join("lumaforge_sync_index.json"))
}

#[tauri::command]
pub fn compute_file_hash(file_path: String) -> Result<String, String> {
    let path = PathBuf::from(&file_path);

    if !path.exists() {
        return Err("El archivo no existe.".to_string());
    }

    let mut file =
        fs::File::open(&path).map_err(|e| format!("No se pudo abrir el archivo: {}", e))?;

    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];

    loop {
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|e| format!("Error leyendo archivo: {}", e))?;

        if bytes_read == 0 {
            break;
        }

        hasher.update(&buffer[..bytes_read]);
    }

    let hash = format!("{:x}", hasher.finalize());
    Ok(hash)
}

#[tauri::command]
pub fn read_sync_index(app_handle: AppHandle) -> Result<SyncIndex, String> {
    let path = get_index_path(&app_handle)?;

    if !path.exists() {
        return Ok(SyncIndex {
            version: 1,
            items: std::collections::HashMap::new(),
        });
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("No se pudo leer el índice: {}", e))?;

    let index: SyncIndex =
        serde_json::from_str(&content).map_err(|e| format!("Error parseando el índice: {}", e))?;

    Ok(index)
}

#[tauri::command]
pub fn write_sync_index(app_handle: AppHandle, index: SyncIndex) -> Result<(), String> {
    let path = get_index_path(&app_handle)?;

    let content =
        serde_json::to_string_pretty(&index).map_err(|e| format!("Error serializando: {}", e))?;

    fs::write(&path, &content).map_err(|e| format!("No se pudo escribir el índice: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn check_package_update(
    app_handle: AppHandle,
    app_id: String,
    source_key: String,
) -> Result<SyncCheckResult, String> {
    let index = read_sync_index(app_handle)?;
    let item_key = format!("{}:{}", app_id, source_key);

    match index.items.get(&item_key) {
        Some(item) => {
            let is_outdated = item.status == "update-available";
            Ok(SyncCheckResult {
                app_id,
                status: item.status.clone(),
                has_update: is_outdated,
                message: if is_outdated {
                    "Una actualización está disponible.".to_string()
                } else {
                    "El paquete está actualizado.".to_string()
                },
            })
        }
        None => Ok(SyncCheckResult {
            app_id,
            status: "not-synced".to_string(),
            has_update: false,
            message: "Este paquete no está en el índice de sincronización.".to_string(),
        }),
    }
}

#[tauri::command]
pub fn mark_sync_index_item(
    app_handle: AppHandle,
    item: SyncIndexItem,
) -> Result<(), String> {
    let app_handle_clone = app_handle.clone();
    let mut index = read_sync_index(app_handle)?;
    let item_key = format!("{}:{}", item.app_id, item.source_key);
    index.items.insert(item_key, item);
    write_sync_index(app_handle_clone, index)
}
