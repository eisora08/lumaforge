use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::utils::image_utils;

const DEBUG_PROVIDER_MEDIA: bool = false;

// ---------------------------------------------------------------------------
// Provider-aware media file operations.
// Path convention: games/<provider>/<providerGameId>/media/<role>.<ext>
// No existing Steam commands are modified. All validation + sanitization
// is self-contained — no shell execution, no arbitrary destination writes.
// ---------------------------------------------------------------------------

const VALID_ROLES: &[&str] = &["cover", "landscape", "background", "logo", "icon"];
const VALID_PROVIDERS: &[&str] = &[
    "steam", "manual", "epic", "emulator", "gog", "battle_net", "ubisoft", "ea", "amazon",
];
const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024; // 50 MB
const DOWNLOAD_TIMEOUT_SECS: u64 = 30;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/// Sanitize a provider ID — matches `providerMediaPaths.ts` logic.
fn sanitize_provider(raw: &str) -> Result<String, String> {
    if raw.is_empty() {
        return Err("Provider ID cannot be empty".into());
    }
    let safe: String = raw
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '_' { c } else { '_' })
        .collect();
    let safe = safe.trim_matches('_');
    if safe.is_empty() {
        return Err(format!("Invalid provider ID: {}", raw));
    }
    Ok(safe.to_string())
}

/// Sanitize a provider game ID — matches `providerMediaPaths.ts` logic.
fn sanitize_provider_game_id(raw: &str) -> Result<String, String> {
    if raw.is_empty() {
        return Err("Provider game ID cannot be empty".into());
    }
    // Block path traversal
    if raw.contains("..") || raw.contains('/') || raw.contains('\\') {
        return Err(format!("Invalid provider game ID (path traversal): {}", raw));
    }
    // Strip provider prefix if present (e.g. "emulator:uuid" -> "uuid", "manual:uuid" -> "uuid")
    let stripped = if let Some(rest) = raw.strip_prefix("emulator:") {
        rest
    } else if let Some(rest) = raw.strip_prefix("manual:") {
        rest
    } else {
        raw
    };
    let safe: String = stripped
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let safe = safe.trim_matches('_');
    if safe.is_empty() {
        return Err(format!("Invalid provider game ID: {}", raw));
    }
    Ok(safe.to_string())
}

/// Validate a media role name.
fn validate_role(role: &str) -> Result<(), String> {
    if VALID_ROLES.contains(&role) {
        Ok(())
    } else {
        Err(format!(
            "Invalid media role: {}. Must be one of: {:?}",
            role, VALID_ROLES
        ))
    }
}

/// Get the media directory for a provider+game: games/<provider>/<id>/media/
fn get_provider_media_dir(
    app_handle: &AppHandle,
    provider: &str,
    provider_game_id: &str,
) -> Result<PathBuf, String> {
    let safe_provider = sanitize_provider(provider)?;
    let safe_id = sanitize_provider_game_id(provider_game_id)?;

    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let media_dir = app_dir
        .join("games")
        .join(&safe_provider)
        .join(&safe_id)
        .join("media");

    fs::create_dir_all(&media_dir)
        .map_err(|e| format!("Failed to create media directory: {}", e))?;

    Ok(media_dir)
}

/// Infer file extension from a path's extension, with role-based defaults.
fn infer_extension(source_path: &str, role: &str) -> String {
    let path = std::path::Path::new(source_path);
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let ext_lower = ext.to_lowercase();
        match ext_lower.as_str() {
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" => return ext_lower,
            _ => {}
        }
    }
    // Default extension per role
    match role {
        "logo" | "icon" => "png".to_string(),
        _ => "jpg".to_string(),
    }
}

/// Infer file extension from a Content-Type header.
fn extension_from_content_type(ct: &str, role: &str) -> String {
    if ct.contains("png") {
        "png".to_string()
    } else if ct.contains("jpeg") || ct.contains("jpg") {
        "jpg".to_string()
    } else if ct.contains("gif") {
        "gif".to_string()
    } else if ct.contains("webp") {
        "webp".to_string()
    } else if ct.contains("bmp") {
        "bmp".to_string()
    } else {
        // Default per role
        match role {
            "logo" | "icon" => "png".to_string(),
            _ => "jpg".to_string(),
        }
    }
}

/// Build the relative path string returned to the caller.
fn relative_media_path(
    provider: &str,
    provider_game_id: &str,
    role: &str,
    ext: &str,
) -> Result<String, String> {
    let safe_provider = sanitize_provider(provider)?;
    let safe_id = sanitize_provider_game_id(provider_game_id)?;
    Ok(format!(
        "games/{}/{}/media/{}.{}",
        safe_provider, safe_id, role, ext
    ))
}

// ---------------------------------------------------------------------------
// Command 1: save_provider_media_from_path
// Copy a local file into the provider media directory.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_provider_media_from_path(
    app_handle: AppHandle,
    provider: String,
    provider_game_id: String,
    role: String,
    source_path: String,
) -> Result<String, String> {
    validate_role(&role)?;
    if !VALID_PROVIDERS.contains(&provider.as_str()) {
        // Allow unknown providers (future-proof) but validate structure
        sanitize_provider(&provider)?;
    }

    let inferred_ext = infer_extension(&source_path, &role);
    // Every source format is normalized to the role's canonical extension.
    // Non-alpha roles (cover/landscape/background) → .jpg, alpha roles
    // (logo/icon) → .png, so provider media never stores .webp/.png for
    // non-transparent roles regardless of the source.
    let ext = role_default_extension(&role);
    let needs_reencode = inferred_ext != ext;
    let media_dir = get_provider_media_dir(&app_handle, &provider, &provider_game_id)?;
    let filename = format!("{}.{}", role, ext);
    let dest_path = media_dir.join(&filename);

    // Delete any existing files with the same role but different extension
    if let Ok(entries) = fs::read_dir(&media_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if stem == role && path != dest_path {
                    if fs::remove_file(&path).is_ok() {
                        if DEBUG_PROVIDER_MEDIA {
                            println!(
                                "[PROVIDER_MEDIA][CLEANUP_OLD] provider={} game={} role={} deleted={:?}",
                                provider, provider_game_id, role, path
                            );
                        }
                    }
                }
            }
        }
    }

    // Validate source path is readable and within size limit
    let meta = fs::metadata(&source_path)
        .map_err(|e| format!("Cannot read source file: {}", e))?;
    if meta.len() > MAX_FILE_SIZE {
        return Err(format!(
            "Source file too large ({} bytes, max {})",
            meta.len(),
            MAX_FILE_SIZE
        ));
    }

    // Non-canonical source bytes (webp, png, gif, bmp, jpeg, ...) are
    // re-encoded to .jpg/.png so downstream reads use the proven extensions
    // (instant refresh works for jpg/png).
    if needs_reencode {
        let bytes = fs::read(&source_path)
            .map_err(|e| format!("Cannot read source file: {}", e))?;
        image_utils::process_and_save_image(&bytes, &dest_path, &role)?;
    } else {
        // Atomic write: copy to temp, then rename
        let tmp_path = dest_path.with_extension(format!("{}.tmp", ext));
        fs::copy(&source_path, &tmp_path)
            .map_err(|e| format!("Failed to copy source file: {}", e))?;

        // Remove existing final file before rename (Windows requires this)
        if dest_path.exists() {
            let _ = fs::remove_file(&dest_path);
        }
        fs::rename(&tmp_path, &dest_path)
            .map_err(|e| format!("Failed to finalize media file: {}", e))?;
    }

    let rel = relative_media_path(&provider, &provider_game_id, &role, &ext)?;
    if DEBUG_PROVIDER_MEDIA {
        println!(
            "[PROVIDER_MEDIA][SAVED] provider={} game={} role={} path={}",
            provider, provider_game_id, role, rel
        );
    }
    Ok(rel)
}

// ---------------------------------------------------------------------------
// Command 2: download_provider_media_from_url
// Download a URL into the provider media directory.
// Uses reqwest blocking client with the same safety limits as safe_download_image.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn download_provider_media_from_url(
    app_handle: AppHandle,
    provider: String,
    provider_game_id: String,
    role: String,
    url: String,
    force: bool,
) -> Result<String, String> {
    validate_role(&role)?;
    if !VALID_PROVIDERS.contains(&provider.as_str()) {
        sanitize_provider(&provider)?;
    }

    // Validate URL scheme
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(format!("Invalid URL scheme (must be http/https): {}", url));
    }

    let media_dir = get_provider_media_dir(&app_handle, &provider, &provider_game_id)?;

    if force {
        // Force mode: delete existing files for this role before downloading
        if let Ok(entries) = fs::read_dir(&media_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if stem == role {
                        if fs::remove_file(&path).is_ok() {
                            if DEBUG_PROVIDER_MEDIA {
                                println!(
                                    "[PROVIDER_MEDIA][FORCE_DELETE] provider={} game={} role={} path={:?}",
                                    provider, provider_game_id, role, path
                                );
                            }
                        }
                    }
                }
            }
        }
    } else {
        // Disk-existence check: skip download if file already exists on disk.
        // Checks all common extensions since we don't know the content-type yet.
        for candidate_ext in &["png", "jpg", "jpeg", "webp", "gif", "bmp"] {
            let candidate_filename = format!("{}.{}", role, candidate_ext);
            if media_dir.join(&candidate_filename).exists() {
                let rel = relative_media_path(&provider, &provider_game_id, &role, candidate_ext)?;
                return Ok(rel);
            }
        }
    }

    // Download with timeout and size limits
    let referer = extract_url_origin(&url);
    let mut default_headers = reqwest::header::HeaderMap::new();
    if let Ok(val) = reqwest::header::HeaderValue::from_str(&referer) {
        default_headers.insert(reqwest::header::REFERER, val);
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
        .connect_timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("LumaForge/0.2.0")
        .default_headers(default_headers)
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

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

    // Check content-type for extension inference
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    if bytes.len() as u64 > MAX_FILE_SIZE {
        return Err(format!(
            "Downloaded file too large ({} bytes, max {})",
            bytes.len(),
            MAX_FILE_SIZE
        ));
    }

    let inferred_ext = if content_type.is_empty() {
        infer_extension(&url, &role)
    } else {
        extension_from_content_type(&content_type, &role)
    };
    // Every source format is normalized to the role's canonical extension.
    // Non-alpha roles (cover/landscape/background) → .jpg, alpha roles
    // (logo/icon) → .png, so provider media never stores .webp/.png for
    // non-transparent roles regardless of the source.
    let ext = role_default_extension(&role);

    let filename = format!("{}.{}", role, ext);
    let dest_path = media_dir.join(&filename);

    let needs_reencode = inferred_ext != ext;
    if needs_reencode {
        // Non-canonical source bytes (webp, png, gif, bmp, jpeg, ...) are
        // re-encoded to .jpg/.png so downstream reads use the proven
        // extensions (instant refresh works for jpg/png).
        image_utils::process_and_save_image(bytes.as_ref(), &dest_path, &role)?;
    } else {
        // Already the canonical extension — atomic write: temp file then rename
        let tmp_path = dest_path.with_extension(format!("{}.tmp", ext));
        tokio::fs::write(&tmp_path, &bytes)
            .await
            .map_err(|e| format!("Failed to write downloaded file: {}", e))?;

        if let Ok(()) = tokio::fs::metadata(&dest_path).await.map(|_| ()) {
            let _ = tokio::fs::remove_file(&dest_path).await;
        }
        tokio::fs::rename(&tmp_path, &dest_path)
            .await
            .map_err(|e| format!("Failed to finalize downloaded file: {}", e))?;
    }

    let rel = relative_media_path(&provider, &provider_game_id, &role, &ext)?;
    if DEBUG_PROVIDER_MEDIA {
        println!(
            "[PROVIDER_MEDIA][DOWNLOADED] provider={} game={} role={} path={} bytes={}",
            provider,
            provider_game_id,
            role,
            rel,
            bytes.len()
        );
    }
    Ok(rel)
}

// ---------------------------------------------------------------------------
// Command 3: delete_provider_media_file
// Delete media files for a role (any extension) in the provider media dir.
// Succeeds silently if no file exists.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn delete_provider_media_file(
    app_handle: AppHandle,
    provider: String,
    provider_game_id: String,
    role: String,
) -> Result<(), String> {
    validate_role(&role)?;
    if !VALID_PROVIDERS.contains(&provider.as_str()) {
        sanitize_provider(&provider)?;
    }

    let media_dir = get_provider_media_dir(&app_handle, &provider, &provider_game_id)?;

    let mut deleted = false;
    if let Ok(entries) = fs::read_dir(&media_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if stem == role {
                    if fs::remove_file(&path).is_ok() {
                        if DEBUG_PROVIDER_MEDIA {
                            println!(
                                "[PROVIDER_MEDIA][DELETED] provider={} game={} role={} path={:?}",
                                provider, provider_game_id, role, path
                            );
                        }
                        deleted = true;
                    }
                }
            }
        }
    }

    if !deleted {
        if DEBUG_PROVIDER_MEDIA {
            println!(
                "[PROVIDER_MEDIA][DELETE_SKIP] provider={} game={} role={} reason=not-found",
                provider, provider_game_id, role
            );
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Command 4: save_provider_media_from_base64
// Save a base64-encoded image into the provider media directory.
// Parallels save_game_media_file but for any provider.
// ---------------------------------------------------------------------------

/// Map role to default extension (matches TS ROLE_DEFAULT_EXTENSIONS).
fn role_default_extension(role: &str) -> String {
    match role {
        "logo" | "icon" => "png".to_string(),
        _ => "jpg".to_string(),
    }
}

#[tauri::command]
pub fn save_provider_media_from_base64(
    app_handle: AppHandle,
    provider: String,
    provider_game_id: String,
    role: String,
    content_base64: String,
    ext: String,
) -> Result<String, String> {
    validate_role(&role)?;
    if !VALID_PROVIDERS.contains(&provider.as_str()) {
        sanitize_provider(&provider)?;
    }

    // Validate extension
    let raw_ext = ext.to_lowercase();
    // Every source format is normalized to the role's canonical extension.
    // Non-alpha roles (cover/landscape/background) → .jpg, alpha roles
    // (logo/icon) → .png, so provider media never stores .webp/.png for
    // non-transparent roles regardless of the source.
    let safe_ext = role_default_extension(&role);
    let needs_reencode = raw_ext != safe_ext;

    // Decode base64
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(&content_base64)
        .map_err(|e| format!("Invalid base64 data: {}", e))?;

    if decoded.len() as u64 > MAX_FILE_SIZE {
        return Err(format!(
            "Decoded image too large ({} bytes, max {})",
            decoded.len(),
            MAX_FILE_SIZE
        ));
    }

    let media_dir = get_provider_media_dir(&app_handle, &provider, &provider_game_id)?;
    let filename = format!("{}.{}", role, safe_ext);
    let dest_path = media_dir.join(&filename);

    // Delete any existing files with the same role but different extension
    if let Ok(entries) = fs::read_dir(&media_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if stem == role && path != dest_path {
                    if fs::remove_file(&path).is_ok() {
                        if DEBUG_PROVIDER_MEDIA {
                            println!(
                                "[PROVIDER_MEDIA][CLEANUP_OLD] provider={} game={} role={} deleted={:?}",
                                provider, provider_game_id, role, path
                            );
                        }
                    }
                }
            }
        }
    }

    // Non-canonical source bytes (webp, png, gif, bmp, jpeg, ...) are
    // re-encoded to .jpg/.png so downstream reads use the proven extensions
    // (instant refresh works for jpg/png).
    if needs_reencode {
        image_utils::process_and_save_image(&decoded, &dest_path, &role)?;
    } else {
        // Atomic write: temp file then rename
        let tmp_path = dest_path.with_extension(format!("{}.tmp", safe_ext));
        fs::write(&tmp_path, &decoded)
            .map_err(|e| format!("Failed to write media file: {}", e))?;

        if dest_path.exists() {
            let _ = fs::remove_file(&dest_path);
        }
        fs::rename(&tmp_path, &dest_path)
            .map_err(|e| format!("Failed to finalize media file: {}", e))?;
    }

    let rel = relative_media_path(&provider, &provider_game_id, &role, &safe_ext)?;
    if DEBUG_PROVIDER_MEDIA {
        println!(
            "[PROVIDER_MEDIA][SAVED_BASE64] provider={} game={} role={} path={} bytes={}",
            provider, provider_game_id, role, rel, decoded.len()
        );
    }
    Ok(rel)
}

// ---------------------------------------------------------------------------
// Command 5: open_provider_media_folder
// Open the provider media directory in the system file explorer.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn open_provider_media_folder(
    app_handle: AppHandle,
    provider: String,
    provider_game_id: String,
) -> Result<(), String> {
    let media_dir = get_provider_media_dir(&app_handle, &provider, &provider_game_id)?;
    open::that(&media_dir).map_err(|e| format!("Failed to open provider media folder: {}", e))
}

// ---------------------------------------------------------------------------
// Command 6: list_provider_media_files
// List all media files in a provider+game media directory.
// Returns filename, role, extension, relative path, size, and modification time.
// Read-only — no writes or deletes.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct ProviderMediaFileEntry {
    pub filename: String,
    pub role: String,
    pub extension: String,
    pub relative_path: String,
    pub size_bytes: u64,
    pub modified_at: Option<u64>,
}

#[tauri::command]
pub fn list_provider_media_files(
    app_handle: AppHandle,
    provider: String,
    provider_game_id: String,
) -> Result<Vec<ProviderMediaFileEntry>, String> {
    let safe_provider = sanitize_provider(&provider)?;
    let safe_id = sanitize_provider_game_id(&provider_game_id)?;

    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let media_dir = app_dir
        .join("games")
        .join(&safe_provider)
        .join(&safe_id)
        .join("media");

    let mut results: Vec<ProviderMediaFileEntry> = Vec::new();

    if !media_dir.exists() {
        return Ok(results);
    }

    if let Ok(entries) = fs::read_dir(&media_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let filename = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };

            // Skip temp files
            if filename.ends_with(".tmp") {
                continue;
            }

            let dot_idx = filename.rfind('.');
            let (role, extension) = if let Some(idx) = dot_idx {
                let stem = &filename[..idx];
                let ext = &filename[idx + 1..];
                (stem.to_string(), ext.to_lowercase())
            } else {
                (filename.clone(), String::new())
            };

            // Only include files with recognized image extensions or no extension
            if !extension.is_empty()
                && extension != "png"
                && extension != "jpg"
                && extension != "jpeg"
                && extension != "webp"
                && extension != "gif"
                && extension != "bmp"
            {
                continue;
            }

            let relative_path = format!(
                "games/{}/{}/media/{}",
                safe_provider, safe_id, filename
            );

            let size_bytes = path.metadata().map(|m| m.len()).unwrap_or(0);

            let modified_at = path
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());

            results.push(ProviderMediaFileEntry {
                filename,
                role,
                extension,
                relative_path,
                size_bytes,
                modified_at,
            });
        }
    }

    if DEBUG_PROVIDER_MEDIA {
        println!(
            "[PROVIDER_MEDIA][LIST] provider={} game={} files={}",
            safe_provider, safe_id, results.len()
        );
    }
    Ok(results)
}

// ---------------------------------------------------------------------------
// Helper: extract origin (scheme + host) from a URL for Referer header
// ---------------------------------------------------------------------------

fn extract_url_origin(url: &str) -> String {
    if let Some(scheme_end) = url.find("://") {
        let after_scheme = &url[scheme_end + 3..];
        if let Some(host_end) = after_scheme.find('/') {
            return format!("{}://{}", &url[..scheme_end], &after_scheme[..host_end]);
        }
        return format!("{}://{}", &url[..scheme_end], after_scheme);
    }
    String::new()
}
