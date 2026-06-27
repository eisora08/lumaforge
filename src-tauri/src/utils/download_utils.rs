use std::collections::HashMap;
use std::fs;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn download_file_to_temp(
    download_url: &str,
    headers: Option<HashMap<String, String>>,
    temp_folder: Option<String>,
) -> Result<PathBuf, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("LumaForge/0.1.0")
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("Error creando cliente HTTP: {}", error))?;

    let mut request = client.get(download_url);

    if let Some(headers) = headers {
        for (key, value) in headers {
            request = request.header(key.as_str(), value.as_str());
        }
    }

    let response = request
        .send()
        .map_err(|error| format!("Error descargando archivo: {}", error))?;

    if !response.status().is_success() {
        let status = response.status();

        let message = match status.as_u16() {
            401 => "El provider rechazó la descarga. Verifica la API key o permisos.",
            403 => "El provider bloqueó la descarga. Puede faltar autorización.",
            404 => "El paquete no está disponible en este provider.",
            429 => "El provider alcanzó el límite de peticiones. Intenta más tarde.",
            500 => "El provider tuvo un error interno.",
            502 => "El provider está temporalmente caído o respondió con Bad Gateway.",
            503 => "El provider no está disponible temporalmente.",
            504 => "El provider tardó demasiado en responder.",
            _ => "La descarga falló desde el provider.",
        };

        return Err(format!("{} Status: {}", message, status));
    }

    let bytes = response
        .bytes()
        .map_err(|error| format!("Error leyendo respuesta: {}", error))?;

    let target_dir = resolve_temp_folder(temp_folder)?;
    fs::create_dir_all(&target_dir)
        .map_err(|error| format!("Error creando carpeta temporal configurada: {}", error))?;

    let package_path = target_dir.join(create_unique_zip_name());

    let mut file = File::create(&package_path)
        .map_err(|error| format!("Error creando archivo temporal: {}", error))?;

    file.write_all(&bytes)
        .map_err(|error| format!("Error guardando archivo temporal: {}", error))?;

    validate_zip_magic(&package_path)?;

    Ok(package_path)
}

fn resolve_temp_folder(temp_folder: Option<String>) -> Result<PathBuf, String> {
    if let Some(folder) = temp_folder {
        let trimmed = folder.trim();

        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    let temp_dir = tempfile::tempdir()
        .map_err(|error| format!("Error creando carpeta temporal: {}", error))?;

    Ok(temp_dir.keep())
}

fn create_unique_zip_name() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    format!("lumaforge-package-{}.zip", millis)
}

fn validate_zip_magic(path: &PathBuf) -> Result<(), String> {
    let bytes = std::fs::read(path)
        .map_err(|error| format!("Error validando ZIP: {}", error))?;

    let is_zip = bytes.starts_with(&[0x50, 0x4B, 0x03, 0x04])
        || bytes.starts_with(&[0x50, 0x4B, 0x05, 0x06])
        || bytes.starts_with(&[0x50, 0x4B, 0x07, 0x08]);

    if !is_zip {
        return Err("El archivo descargado no parece ser un ZIP válido.".to_string());
    }

    Ok(())
}