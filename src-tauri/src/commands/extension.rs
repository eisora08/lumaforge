use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionFileStatus {
    pub exists: bool,
    pub size: Option<u64>,
    pub modified_at: Option<u64>,
}

fn extension_log(msg: impl std::fmt::Display) {
    eprintln!("[extension] {}", msg);
}

#[tauri::command]
pub fn extension_file_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[tauri::command]
pub fn extension_file_status(path: String) -> Result<ExtensionFileStatus, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(ExtensionFileStatus {
            exists: false,
            size: None,
            modified_at: None,
        });
    }
    let meta = fs::metadata(p).map_err(|e| format!("Failed to read file metadata: {}", e))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    Ok(ExtensionFileStatus {
        exists: true,
        size: Some(meta.len()),
        modified_at: modified,
    })
}

#[tauri::command]
pub fn extension_rename_file(from: String, to: String) -> Result<(), String> {
    let from_path = Path::new(&from);
    let to_path = Path::new(&to);

    if !from_path.exists() {
        return Err(format!(
            "Source file does not exist: {}",
            from
        ));
    }

    if to_path.exists() {
        extension_log(format!(
            "WARNING: destination already exists, removing before rename: {}",
            to
        ));
        if to_path.is_dir() {
            fs::remove_dir_all(to_path)
                .map_err(|e| format!("Failed to remove existing destination directory: {}", e))?;
        } else {
            fs::remove_file(to_path)
                .map_err(|e| format!("Failed to remove existing destination file: {}", e))?;
        }
    }

    if let Some(parent) = to_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
    }

    fs::rename(from_path, to_path)
        .map_err(|e| format!("Rename failed: {} -> {}: {}", from, to, e))?;

    extension_log(format!("renamed: {} -> {}", from, to));
    Ok(())
}

#[tauri::command]
pub fn extension_batch_rename(renames: Vec<(String, String)>) -> Result<Vec<String>, String> {
    let mut completed: Vec<(String, String)> = Vec::new();

    for (from, to) in &renames {
        let from_path = Path::new(from);
        let to_path = Path::new(to);

        if !from_path.exists() {
            for (prev_from, prev_to) in completed.iter().rev() {
                let _ = fs::rename(prev_to, prev_from);
            }
            return Err(format!(
                "Source file does not exist: {}. Rolled back {} successful renames.",
                from,
                completed.len()
            ));
        }

        if let Some(parent) = to_path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)
                    .map_err(|e| {
                        for (prev_from, prev_to) in completed.iter().rev() {
                            let _ = fs::rename(prev_to, prev_from);
                        }
                        format!("Failed to create parent dir: {}", e)
                    })?;
            }
        }

        fs::rename(from_path, to_path).map_err(|_e| {
            for (prev_from, prev_to) in completed.iter().rev() {
                let _ = fs::rename(prev_to, prev_from);
            }
            format!(
                "Rename failed: {} -> {}. Rolled back {} successful renames.",
                from,
                to,
                completed.len()
            )
        })?;

        completed.push((from.clone(), to.clone()));
    }

    Ok(completed.into_iter().map(|(f, _)| f).collect())
}

#[tauri::command]
pub fn extension_get_dll_version(
    steam_root: String,
    file_name: String,
) -> Result<Option<String>, String> {
    let path = Path::new(&steam_root).join(&file_name);
    if !path.exists() {
        return Ok(None);
    }

    match windows_version_from_file(&path) {
        Ok(Some(v)) => Ok(Some(v)),
        Ok(None) => Ok(None),
        Err(e) => {
            extension_log(format!(
                "version detection failed for {}: {}",
                file_name, e
            ));
            Ok(None)
        }
    }
}

fn read_u16_le(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([data[offset], data[offset + 1]])
}

fn read_u32_le(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ])
}

fn windows_version_from_file(path: &Path) -> Result<Option<String>, String> {
    let data = fs::read(path).map_err(|e| format!("Failed to read file: {}", e))?;

    if data.len() < 92 {
        return Ok(None);
    }

    let pe_offset = read_u32_le(&data, 60) as usize;
    if pe_offset + 24 >= data.len() {
        return Ok(None);
    }

    let opt_header_offset = pe_offset + 24;
    let magic = read_u16_le(&data, opt_header_offset);

    let resource_offset;
    let resource_size;

    if magic == 0x20b {
        if opt_header_offset + 112 + 16 + 16 >= data.len() {
            return Ok(None);
        }
        resource_offset = read_u32_le(&data, opt_header_offset + 96) as usize;
        resource_size = read_u32_le(&data, opt_header_offset + 100) as usize;
    } else {
        if opt_header_offset + 96 + 16 >= data.len() {
            return Ok(None);
        }
        resource_offset = read_u32_le(&data, opt_header_offset + 80) as usize;
        resource_size = read_u32_le(&data, opt_header_offset + 84) as usize;
    }

    if resource_offset + 16 > data.len() || resource_size < 16 {
        return Ok(None);
    }

    let number_of_named = read_u16_le(&data, resource_offset) as usize;
    let number_of_ids = read_u16_le(&data, resource_offset + 2) as usize;

    let entries_start = resource_offset + 16;
    let total_entries = number_of_named + number_of_ids;

    for i in 0..total_entries {
        let entry_offset = entries_start + i * 8;
        if entry_offset + 8 > data.len() {
            break;
        }
        let id = read_u32_le(&data, entry_offset);
        let data_or_subdir = read_u32_le(&data, entry_offset + 4);

        if id == 16 {
            let subdir_offset = resource_offset + (data_or_subdir & 0x7FFFFFFF) as usize;
            if subdir_offset + 16 > data.len() {
                break;
            }
            let sub_named = read_u16_le(&data, subdir_offset) as usize;
            let sub_ids = read_u16_le(&data, subdir_offset + 2) as usize;
            let sub_entries = subdir_offset + 16;

            for j in 0..sub_ids {
                let se_off = sub_entries + (sub_named + j) * 8;
                if se_off + 8 > data.len() {
                    break;
                }
                let sub_data = read_u32_le(&data, se_off + 4);
                let data_offset = resource_offset + (sub_data & 0x7FFFFFFF) as usize;
                if data_offset + 8 > data.len() {
                    break;
                }
                let ver_offset = read_u32_le(&data, data_offset) as usize;
                let ver_size = read_u32_le(&data, data_offset + 4) as usize;

                let abs_offset = resource_offset + ver_offset;
                if abs_offset + ver_size > data.len() || ver_size < 48 {
                    continue;
                }

                let v_ms = read_u32_le(&data, abs_offset + 8);
                let v_ls = read_u32_le(&data, abs_offset + 12);

                let major = v_ms >> 16;
                let minor = v_ms & 0xFFFF;
                let build = v_ls >> 16;
                let patch = v_ls & 0xFFFF;

                if major == 0 && minor == 0 && build == 0 && patch == 0 {
                    continue;
                }

                return Ok(Some(format!("{}.{}.{}.{}", major, minor, build, patch)));
            }
        }
    }

    Ok(None)
}

#[tauri::command]
pub fn extension_create_dir(path: String) -> Result<bool, String> {
    let p = Path::new(&path);
    if p.exists() {
        return Ok(false);
    }
    fs::create_dir_all(p).map_err(|e| format!("Failed to create directory {}: {}", path, e))?;
    extension_log(format!("created dir: {}", path));
    Ok(true)
}

#[tauri::command]
pub fn extension_remove_file(path: String) -> Result<bool, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(false);
    }
    fs::remove_file(p).map_err(|e| format!("Failed to remove file {}: {}", path, e))?;
    extension_log(format!("removed: {}", path));
    Ok(true)
}

#[tauri::command]
pub fn extension_list_directory(path: String) -> Result<Vec<String>, String> {
    let dir = Path::new(&path);
    if !dir.exists() || !dir.is_dir() {
        return Ok(vec![]);
    }
    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))?;
    let mut names = Vec::new();
    for entry in entries.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            names.push(name.to_string());
        }
    }
    Ok(names)
}

#[tauri::command]
pub async fn extension_download_file(
    url: String,
    target_path: String,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("LumaForge-ExtensionManager/1.0")
        .timeout(std::time::Duration::from_secs(120))
        .connect_timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("HTTP client creation failed: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let target = Path::new(&target_path);
    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create target directory: {}", e))?;
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    tokio::fs::write(target, &bytes)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;

    extension_log(format!("downloaded: {} -> {}", url, target_path));
    Ok(())
}

#[tauri::command]
pub fn extension_copy_file(from: String, to: String) -> Result<(), String> {
    let from_path = Path::new(&from);
    let to_path = Path::new(&to);

    if !from_path.exists() {
        return Err(format!("Source file does not exist: {}", from));
    }

    if let Some(parent) = to_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
    }

    fs::copy(from_path, to_path)
        .map_err(|e| format!("Copy failed: {} -> {}: {}", from, to, e))?;

    extension_log(format!("copied: {} -> {}", from, to));
    Ok(())
}

#[tauri::command]
pub fn extension_extract_zip(
    zip_path: String,
    target_dir: String,
    expected_files: Vec<String>,
) -> Result<Vec<String>, String> {
    let zip_file = fs::File::open(&zip_path)
        .map_err(|e| format!("Failed to open zip: {}", e))?;

    let mut archive = zip::ZipArchive::new(zip_file)
        .map_err(|e| format!("Failed to read zip archive: {}", e))?;

    let target = Path::new(&target_dir);
    fs::create_dir_all(target)
        .map_err(|e| format!("Failed to create extract directory: {}", e))?;

    let mut extracted = Vec::new();
    let expected_lower: Vec<String> = expected_files
        .iter()
        .map(|f| f.to_lowercase())
        .collect();

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;

        let entry_name = entry.name().to_string();
        let entry_lower = entry_name.to_lowercase();

        let matches = expected_lower.iter().any(|expected| {
            entry_lower == *expected
                || entry_lower.ends_with(&format!("/{}", expected))
                || entry_lower
                    .split('/')
                    .last()
                    .map(|n| n == expected.as_str())
                    .unwrap_or(false)
        });

        if !matches {
            continue;
        }

        let file_name = entry_name
            .split('/')
            .last()
            .unwrap_or(&entry_name);

        let out_path = target.join(file_name);

        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent: {}", e))?;
            }
            let mut out_file = fs::File::create(&out_path)
                .map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
            extracted.push(file_name.to_string());
        }
    }

    Ok(extracted)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionProcessResult {
    pub success: bool,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[tauri::command]
pub fn extension_run_process(
    exe_path: String,
    args: Vec<String>,
) -> Result<ExtensionProcessResult, String> {
    use std::process::Command;

    let exe = Path::new(&exe_path);
    if !exe.exists() {
        return Err(format!("Executable not found: {}", exe_path));
    }

    let output = Command::new(&exe_path)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run process: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    extension_log(format!(
        "run_process: {} {} => exit_code={}",
        exe_path,
        args.join(" "),
        exit_code
    ));

    Ok(ExtensionProcessResult {
        success: output.status.success(),
        exit_code,
        stdout,
        stderr,
    })
}

#[tauri::command]
pub fn extension_fetch_url_as_text(url: String) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("LumaForge-ExtensionManager/1.0")
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("HTTP client creation failed: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP request failed with status: {}", response.status()));
    }

    let text = response
        .text()
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    extension_log(format!("fetch_url: {} => {} bytes", url, text.len()));
    Ok(text)
}

#[tauri::command]
pub fn extension_find_largest_exe(
    dir: String,
    exclude: Vec<String>,
) -> Result<Option<String>, String> {
    let dir_path = Path::new(&dir);
    if !dir_path.exists() || !dir_path.is_dir() {
        return Ok(None);
    }

    let exclude_lower: Vec<String> = exclude.iter().map(|s| s.to_lowercase()).collect();

    let entries = fs::read_dir(dir_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut largest: Option<(String, u64)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("exe") {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let name_lower = name.to_lowercase();
        if exclude_lower.contains(&name_lower) {
            continue;
        }
        if let Ok(meta) = path.metadata() {
            if meta.is_file() {
                let size = meta.len();
                if largest.as_ref().map_or(true, |(_, s)| size > *s) {
                    largest = Some((name, size));
                }
            }
        }
    }

    Ok(largest.map(|(name, _)| name))
}

#[tauri::command]
pub fn extension_extract_zip_all(
    zip_path: String,
    target_dir: String,
) -> Result<Vec<String>, String> {
    let zip_file =
        fs::File::open(&zip_path).map_err(|e| format!("Failed to open zip: {}", e))?;

    let mut archive = zip::ZipArchive::new(zip_file)
        .map_err(|e| format!("Failed to read zip archive: {}", e))?;

    let target = Path::new(&target_dir);
    fs::create_dir_all(target)
        .map_err(|e| format!("Failed to create extract directory: {}", e))?;

    let mut extracted = Vec::new();

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;

        let entry_name = entry.name().to_string();
        let file_name = entry_name.split('/').last().unwrap_or(&entry_name);

        if file_name.is_empty() || entry_name.ends_with('/') {
            if entry.is_dir() {
                let dir_path = target.join(&entry_name);
                let _ = fs::create_dir_all(&dir_path);
            }
            continue;
        }

        let out_path = target.join(file_name);

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent: {}", e))?;
        }

        let mut out_file =
            fs::File::create(&out_path).map_err(|e| format!("Failed to create file: {}", e))?;

        std::io::copy(&mut entry, &mut out_file)
            .map_err(|e| format!("Failed to extract file: {}", e))?;

        extracted.push(file_name.to_string());
    }

    extension_log(format!("extract_zip_all: {} => {} files", zip_path, extracted.len()));
    Ok(extracted)
}

#[tauri::command]
pub fn extension_write_text_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
    }
    fs::write(p, &content)
        .map_err(|e| format!("Failed to write file: {}", e))?;
    extension_log(format!("wrote text file: {}", path));
    Ok(())
}
