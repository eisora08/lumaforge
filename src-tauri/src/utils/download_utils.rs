use std::fs::File;
use std::io::Write;
use std::path::PathBuf;

pub fn download_file_to_temp(download_url: &str) -> Result<PathBuf, String> {
    let response = reqwest::blocking::get(download_url)
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

    let temp_dir = tempfile::tempdir()
        .map_err(|error| format!("Error creando carpeta temporal: {}", error))?;

    let temp_path = temp_dir.keep();
    let package_path = temp_path.join("package.zip");

    let mut file = File::create(&package_path)
        .map_err(|error| format!("Error creando archivo temporal: {}", error))?;

    file.write_all(&bytes)
        .map_err(|error| format!("Error guardando archivo temporal: {}", error))?;

    validate_zip_magic(&package_path)?;

    Ok(package_path)
}

fn validate_zip_magic(path: &PathBuf) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|error| format!("Error validando ZIP: {}", error))?;

    let is_zip = bytes.starts_with(&[0x50, 0x4B, 0x03, 0x04])
        || bytes.starts_with(&[0x50, 0x4B, 0x05, 0x06])
        || bytes.starts_with(&[0x50, 0x4B, 0x07, 0x08]);

    if !is_zip {
        return Err("El archivo descargado no parece ser un ZIP válido.".to_string());
    }

    Ok(())
}
