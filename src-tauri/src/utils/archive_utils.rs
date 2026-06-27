use std::fs;
use std::fs::File;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

pub fn extract_zip(zip_path: &Path) -> Result<PathBuf, String> {
    let file = File::open(zip_path)
        .map_err(|error| format!("Error abriendo ZIP: {}", error))?;

    let mut archive = ZipArchive::new(file)
        .map_err(|error| format!("Error leyendo ZIP: {}", error))?;

    let extract_dir = build_extract_dir(zip_path)?;

    fs::create_dir_all(&extract_dir)
        .map_err(|error| format!("Error creando carpeta de extracción: {}", error))?;

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("Error leyendo archivo del ZIP: {}", error))?;

        let enclosed_path = match file.enclosed_name() {
            Some(path) => path.to_owned(),
            None => continue,
        };

        let output_path = extract_dir.join(enclosed_path);

        if file.is_dir() {
            fs::create_dir_all(&output_path)
                .map_err(|error| format!("Error creando carpeta extraída: {}", error))?;
        } else {
            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Error creando carpeta padre: {}", error))?;
            }

            let mut output_file = File::create(&output_path)
                .map_err(|error| format!("Error creando archivo extraído: {}", error))?;

            std::io::copy(&mut file, &mut output_file)
                .map_err(|error| format!("Error extrayendo archivo: {}", error))?;
        }
    }

    Ok(extract_dir)
}

fn build_extract_dir(zip_path: &Path) -> Result<PathBuf, String> {
    let parent = zip_path
        .parent()
        .ok_or("No se pudo obtener la carpeta del ZIP")?;

    let file_stem = zip_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("package");

    Ok(parent.join(format!("{}-extracted", file_stem)))
}