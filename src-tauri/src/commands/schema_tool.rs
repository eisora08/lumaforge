use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::models::steam_appcache_achievements::{AchievementsAppSchemaEntry, AppAchievementCacheEntry, AppAchievementSummary, AppAchievementCache, AppAchievementPercentagesEntry};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCHEMA_PARSE_DIRNAME: &str = "schema_parse";
const SCHEMA_PARSE_ARCHIVE_NAME: &str = "schema_parse.zip";
const SCHEMA_PARSE_STATE_FILENAME: &str = ".seed-state.json";
const TOOL_TIMEOUT_SECS: u64 = 60;

// Mutable entries preserved across re-extractions (matching reference)
const MUTABLE_NAMES: &[&str] = &[
    "my_login.txt",
    "refresh_tokens.json",
    "top_owners_ids.txt",
    "_OUTPUT",
];

// ---------------------------------------------------------------------------
// Module-level extraction state
// ---------------------------------------------------------------------------

static EXTRACTION_STATE: Mutex<Option<ExtractionState>> = Mutex::new(None);

struct ExtractionState {
    runtime_dir: PathBuf,
    exe_path: PathBuf,
    extracted_hash: String,
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

fn get_schema_tool_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    Ok(app_data.join("tools").join(SCHEMA_PARSE_DIRNAME))
}

fn get_resource_zip(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource dir: {}", e))?;

    // Try 1: production path (resource_dir/tools/)
    let zip1 = resource_dir.join("tools").join(SCHEMA_PARSE_ARCHIVE_NAME);
    if zip1.is_file() {
        return Ok(zip1);
    }

    // Try 2: dev mode (resource_dir/resources/tools/)
    let zip2 = resource_dir.join("resources").join("tools").join(SCHEMA_PARSE_ARCHIVE_NAME);
    if zip2.is_file() {
        return Ok(zip2);
    }

    // Try 3: source directory fallback (for npm run tauri dev)
    let src_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let zip3 = src_dir.join("resources").join("tools").join(SCHEMA_PARSE_ARCHIVE_NAME);
    if zip3.is_file() {
        return Ok(zip3);
    }

    Err(format!(
        "Schema parse ZIP not found. Tried:\n  {}\n  {}\n  {}",
        zip1.display(),
        zip2.display(),
        zip3.display(),
    ))
}

fn compute_file_hash(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| format!("Failed to read for hash: {}", e))?;
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    Ok(format!("{:016x}", hasher.finish()))
}

// ---------------------------------------------------------------------------
// ZIP extraction
// ---------------------------------------------------------------------------

fn extract_zip_powershell(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let zip_str = zip_path.to_string_lossy().replace('\'', "''");
    let dest_str = dest_dir.to_string_lossy().replace('\'', "''");

    let command = format!(
        "$archive = '{}'; $dest = '{}'; \
         New-Item -ItemType Directory -Path $dest -Force | Out-Null; \
         Expand-Archive -LiteralPath $archive -DestinationPath $dest -Force",
        zip_str, dest_str,
    );

    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &command,
        ])
        .output()
        .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("PowerShell extraction failed: {}", stderr));
    }
    Ok(())
}

fn preserve_mutable_entries(runtime_dir: &Path, preserve_dir: &Path) {
    let _ = fs::remove_dir_all(preserve_dir);
    let _ = fs::create_dir_all(preserve_dir);
    for name in MUTABLE_NAMES {
        let src = runtime_dir.join(name);
        if src.is_dir() {
            let _ = copy_dir_recursive(&src, &preserve_dir.join(name));
        } else if src.is_file() {
            let _ = fs::copy(&src, preserve_dir.join(name));
        }
    }
}

fn restore_mutable_entries(preserve_dir: &Path, runtime_dir: &Path) {
    if !preserve_dir.exists() {
        return;
    }
    for name in MUTABLE_NAMES {
        let src = preserve_dir.join(name);
        if src.is_dir() {
            let _ = copy_dir_recursive(&src, &runtime_dir.join(name));
        } else if src.is_file() {
            let _ = fs::copy(&src, runtime_dir.join(name));
        }
    }
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("mkdir failed: {}", e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("readdir failed: {}", e))? {
        let entry = entry.map_err(|e| format!("entry read failed: {}", e))?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            copy_dir_recursive(&src_path, &dest_path)?;
        } else {
            fs::copy(&src_path, &dest_path).map_err(|e| format!("copy failed: {}", e))?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Ensure tool is extracted and ready
// ---------------------------------------------------------------------------

fn ensure_tool_ready(app_handle: &AppHandle) -> Result<PathBuf, String> {
    // Check cache
    {
        let state = EXTRACTION_STATE.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        if let Some(ref s) = *state {
            if s.exe_path.is_file() {
                return Ok(s.exe_path.clone());
            }
        }
    }

    let zip_path = get_resource_zip(app_handle)?;
    let runtime_dir = get_schema_tool_dir(app_handle)?;
    let exe_path = runtime_dir.join("generate_emu_config.exe");
    let state_path = runtime_dir.join(SCHEMA_PARSE_STATE_FILENAME);

    let zip_hash = compute_file_hash(&zip_path)?;

    // Check if already extracted with same hash
    if exe_path.is_file() {
        if let Ok(state_json) = fs::read_to_string(&state_path) {
            if state_json.contains(&zip_hash) {
                // Already extracted with same version
                let mut state = EXTRACTION_STATE.lock().map_err(|e| format!("Lock: {}", e))?;
                *state = Some(ExtractionState {
                    runtime_dir,
                    exe_path: exe_path.clone(),
                    extracted_hash: zip_hash,
                });
                return Ok(exe_path);
            }
        }
    }

    // Need extraction
    eprintln!("[SchemaTool] Extracting schema_parse.zip to {}", runtime_dir.display());

    // Preserve mutable entries
    let preserve_dir = runtime_dir.parent()
        .unwrap_or(&runtime_dir)
        .join(format!("{}.preserve", SCHEMA_PARSE_DIRNAME));
    if runtime_dir.exists() {
        preserve_mutable_entries(&runtime_dir, &preserve_dir);
        let _ = fs::remove_dir_all(&runtime_dir);
    }

    // Extract
    extract_zip_powershell(&zip_path, &runtime_dir)?;

    // Restore mutable entries
    restore_mutable_entries(&preserve_dir, &runtime_dir);
    let _ = fs::remove_dir_all(&preserve_dir);

    // Verify exe exists
    if !exe_path.is_file() {
        return Err(format!(
            "generate_emu_config.exe not found after extraction: {}",
            exe_path.display()
        ));
    }

    // Write state
    let _ = fs::write(&state_path, format!("{{\"archiveHash\":\"{}\"}}", zip_hash));

    // Cache
    {
        let mut state = EXTRACTION_STATE.lock().map_err(|e| format!("Lock: {}", e))?;
        *state = Some(ExtractionState {
            runtime_dir,
            exe_path: exe_path.clone(),
            extracted_hash: zip_hash,
        });
    }

    eprintln!("[SchemaTool] Extraction complete: {}", exe_path.display());
    Ok(exe_path)
}

// ---------------------------------------------------------------------------
// Run generate_emu_config.exe
// ---------------------------------------------------------------------------

fn run_generate_emu_config(exe_path: &Path, app_id: u32) -> Result<PathBuf, String> {
    let output_root = exe_path.parent()
        .ok_or("Cannot determine exe parent")?
        .join("_OUTPUT");

    // Clean previous output for this app
    let app_output = output_root.join(app_id.to_string());
    if app_output.exists() {
        let _ = fs::remove_dir_all(&app_output);
    }

    // Default credentials (matching reference: steam-schema-parse.js)
    // The exe expects these env vars; without them it prompts on stdin and fails
    const DEFAULT_USERNAME: &str = "goldie_0003";
    const DEFAULT_PASSWORD: &str = "BabaYaga0003";

    eprintln!(
        "[SchemaTool] Running generate_emu_config.exe for app_id={} cwd={}",
        app_id,
        exe_path.parent().unwrap().display(),
    );

    let output = std::process::Command::new(exe_path)
        .arg(app_id.to_string())
        .current_dir(exe_path.parent().unwrap())
        .env("GSE_CFG_USERNAME", DEFAULT_USERNAME)
        .env("GSE_CFG_PASSWORD", DEFAULT_PASSWORD)
        // Pipe empty stdin so exe doesn't hang on interactive prompt
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run generate_emu_config.exe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "generate_emu_config.exe failed (exit {}): {} {}",
            output.status.code().unwrap_or(-1),
            stdout.chars().take(500).collect::<String>(),
            stderr.chars().take(500).collect::<String>(),
        ));
    }

    // Check for output
    let achievements_path = app_output
        .join("steam_settings")
        .join("achievements.json");

    if !achievements_path.is_file() {
        return Err(format!(
            "achievements.json not found at {}",
            achievements_path.display()
        ));
    }

    eprintln!("[SchemaTool] generate_emu_config.exe succeeded: {}", achievements_path.display());

    Ok(achievements_path)
}

// ---------------------------------------------------------------------------
// Parse tool output into LumaForge format
// ---------------------------------------------------------------------------

fn parse_tool_output(achievements_path: &Path, app_id: u32) -> Result<Vec<AppAchievementCacheEntry>, String> {
    let raw_json = fs::read_to_string(achievements_path)
        .map_err(|e| format!("Failed to read achievements.json: {}", e))?;

    let raw_entries: Vec<AchievementsAppSchemaEntry> = serde_json::from_str(&raw_json)
        .map_err(|e| format!("Failed to parse achievements.json: {}", e))?;

    let mut entries = Vec::new();

    for entry in raw_entries {
        let api_name = entry.name.clone();
        let name = resolve_localized_name(&entry);
        let description = resolve_localized_description(&entry);

        // Normalize icon URLs (same logic as read_achievements_app_schema_folder)
        let icon_url = entry.icon.as_ref().filter(|p| !p.is_empty()).cloned();
        let icon_gray_url = entry.icon_gray.as_ref().filter(|p| !p.is_empty()).cloned();

        entries.push(AppAchievementCacheEntry {
            id: api_name.clone(),
            api_name,
            name,
            description,
            icon_url,
            icon_gray_url,
            unlocked: false,
            unlock_time: None,
            rarity_percent: None,
            stat_id: entry.stat_id,
            bit: entry.bit,
            progress_stat_id: entry.progress_stat_id,
            progress_min: entry.progress_min,
            progress_max: entry.progress_max,
        });
    }

    eprintln!(
        "[SchemaTool] Parsed {} entries from tool output for app {}",
        entries.len(),
        app_id
    );

    Ok(entries)
}

fn resolve_localized_name(entry: &AchievementsAppSchemaEntry) -> String {
    match &entry.display_name {
        Some(crate::models::steam_appcache_achievements::LocaleValue::String(s)) => s.clone(),
        Some(crate::models::steam_appcache_achievements::LocaleValue::Map(map)) => {
            map.get("english")
                .or_else(|| map.values().next())
                .cloned()
                .unwrap_or_else(|| entry.name.clone())
        }
        None => entry.name.clone(),
    }
}

fn resolve_localized_description(entry: &AchievementsAppSchemaEntry) -> Option<String> {
    match &entry.description {
        Some(crate::models::steam_appcache_achievements::LocaleValue::String(s)) => {
            if s.is_empty() { None } else { Some(s.clone()) }
        }
        Some(crate::models::steam_appcache_achievements::LocaleValue::Map(map)) => {
            map.get("english")
                .or_else(|| map.values().next())
                .cloned()
                .filter(|s| !s.is_empty())
        }
        None => None,
    }
}

// ---------------------------------------------------------------------------
// Copy images from tool output to achievement cache dir
// ---------------------------------------------------------------------------

fn copy_tool_images(app_handle: &AppHandle, app_id: u32) -> Result<u32, String> {
    let runtime_dir = get_schema_tool_dir(app_handle)?;
    let source_img_dir = runtime_dir
        .join("_OUTPUT")
        .join(app_id.to_string())
        .join("steam_settings")
        .join("img");

    if !source_img_dir.is_dir() {
        return Ok(0);
    }

    let cache_dir = get_achievement_cache_dir(app_handle, app_id)?;
    let dest_img_dir = cache_dir.join("img");
    fs::create_dir_all(&dest_img_dir).map_err(|e| format!("Failed to create img dir: {}", e))?;

    let mut count = 0u32;
    for entry in fs::read_dir(&source_img_dir).map_err(|e| format!("read img dir: {}", e))? {
        let entry = entry.map_err(|e| format!("read entry: {}", e))?;
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            let src = entry.path();
            let dest = dest_img_dir.join(entry.file_name());
            if !dest.exists() {
                if fs::copy(&src, &dest).is_ok() {
                    count += 1;
                }
            }
        }
    }

    Ok(count)
}

fn get_achievement_cache_dir(app_handle: &AppHandle, app_id: u32) -> Result<PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {}", e))?;
    // Return path WITHOUT creating directory — only create when writing files
    // Default: steam-official (Steam library games)
    Ok(app_data.join("achievements").join("schema").join("steam-official").join(app_id.to_string()))
}

// ---------------------------------------------------------------------------
// Tauri command: generate_schema_via_tool
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn generate_schema_via_tool(
    app_handle: AppHandle,
    app_id: u32,
    steam_path: Option<String>,
) -> Result<SchemaToolResult, String> {
    eprintln!("[SchemaTool] === generate_schema_via_tool app_id={} ===", app_id);

    // 1. Ensure tool is extracted
    let exe_path = ensure_tool_ready(&app_handle)?;

    // 2. Run generate_emu_config.exe
    let achievements_path = run_generate_emu_config(&exe_path, app_id)?;

    // 3. Parse output
    let entries = parse_tool_output(&achievements_path, app_id)?;
    let entry_count = entries.len() as u32;

    // 4. Copy images to achievement cache
    let images_copied = copy_tool_images(&app_handle, app_id)?;

    // 5. Build percentages (empty — tool doesn't provide them)
    let achievement_percentages: Vec<AppAchievementPercentagesEntry> = vec![];

    // 6. Build summary
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let summary = AppAchievementSummary {
        app_id: app_id.to_string(),
        total: entry_count,
        unlocked: 0,
        percent: 0.0,
        progress_available: false, // Will be set when binary stats are matched
        source: "schema-tool".to_string(),
        updated_at: now,
        cache_version: Some(7),
    };

    // 7. Write to achievement cache dir
    let cache = AppAchievementCache {
        achievements: entries,
        achievement_percentages,
        summary,
    };

    let cache_dir = get_achievement_cache_dir(&app_handle, app_id)?;
    fs::create_dir_all(&cache_dir).map_err(|e| format!("create cache dir: {}", e))?;
    let cache_path = cache_dir.join("achievements.json");
    let cache_json = serde_json::to_string_pretty(&cache)
        .map_err(|e| format!("serialize cache: {}", e))?;
    fs::write(&cache_path, cache_json).map_err(|e| format!("write cache: {}", e))?;

    eprintln!(
        "[SchemaTool] Success: {} entries, {} images copied, cache written to {}",
        entry_count,
        images_copied,
        cache_path.display(),
    );

    Ok(SchemaToolResult {
        entries_count: entry_count,
        images_copied,
        source: "schema-tool".to_string(),
        error: None,
    })
}

// ---------------------------------------------------------------------------
// Tauri command: get_schema_tool_status
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_schema_tool_status(app_handle: AppHandle) -> Result<SchemaToolStatus, String> {
    let exe_path = ensure_tool_ready(&app_handle)?;
    let output_dir = exe_path.parent()
        .unwrap_or(&exe_path)
        .join("_OUTPUT");

    Ok(SchemaToolStatus {
        available: exe_path.is_file(),
        exe_path: exe_path.to_string_lossy().to_string(),
        output_dir: output_dir.to_string_lossy().to_string(),
    })
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SchemaToolResult {
    pub entries_count: u32,
    pub images_copied: u32,
    pub source: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SchemaToolStatus {
    pub available: bool,
    pub exe_path: String,
    pub output_dir: String,
}
