use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::utils::image_utils;

// ---------------------------------------------------------------------------
// Media cache profile — simplified to landscape + cover only
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MediaCacheProfile {
    /// Only landscape (smallest footprint)
    #[serde(rename = "minimal")]
    Minimal,
    /// landscape + cover (recommended)
    #[serde(rename = "playnite-balanced")]
    PlayniteBalanced,
    /// Same as balanced — no extra roles
    #[serde(rename = "full")]
    Full,
}

impl Default for MediaCacheProfile {
    fn default() -> Self {
        MediaCacheProfile::PlayniteBalanced
    }
}

impl MediaCacheProfile {
    /// Returns the set of media roles that should be kept for this profile.
    pub fn library_roles(&self) -> Vec<&'static str> {
        match self {
            MediaCacheProfile::Minimal => vec!["landscape"],
            MediaCacheProfile::PlayniteBalanced => vec!["landscape", "cover"],
            MediaCacheProfile::Full => vec!["landscape", "cover"],
        }
    }
}

// ---------------------------------------------------------------------------
// Media cache stats
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaCacheStats {
    pub total_bytes: u64,
    pub game_count: usize,
    pub largest_games: Vec<GameMediaSize>,
    pub by_type: MediaSizeByType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameMediaSize {
    pub app_id: String,
    pub title: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MediaSizeByType {
    pub landscape_bytes: u64,
    pub cover_bytes: u64,
    pub old_media_bytes: u64,
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

fn get_games_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let games_dir = app_dir.join("games").join("steam");
    Ok(games_dir)
}

// ---------------------------------------------------------------------------
// Hash helpers for dedup
// ---------------------------------------------------------------------------

/// Compute SHA-256 hash of byte slice.
pub fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Compute SHA-256 hash of a file.
pub fn hash_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    Ok(hash_bytes(&bytes))
}

// ---------------------------------------------------------------------------
// get_media_cache_stats
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_media_cache_stats(app_handle: AppHandle) -> Result<MediaCacheStats, String> {
    let games_dir = get_games_dir(&app_handle)?;
    if !games_dir.exists() {
        return Ok(MediaCacheStats {
            total_bytes: 0,
            game_count: 0,
            largest_games: Vec::new(),
            by_type: MediaSizeByType::default(),
        });
    }

    let mut total_bytes: u64 = 0;
    let mut game_count: usize = 0;
    let mut game_sizes: Vec<GameMediaSize> = Vec::new();
    let mut by_type = MediaSizeByType::default();

    if let Ok(entries) = fs::read_dir(&games_dir) {
        for entry in entries.flatten() {
            let game_dir = entry.path();
            if !game_dir.is_dir() {
                continue;
            }

            let app_id = game_dir
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            // Read appinfo for title
            let appinfo_path = game_dir.join("appinfo.json");
            let title = if appinfo_path.exists() {
                if let Ok(content) = fs::read_to_string(&appinfo_path) {
                    if let Ok(info) =
                        serde_json::from_str::<serde_json::Value>(&content)
                    {
                        info.get("name")
                            .and_then(|n| n.as_str())
                            .unwrap_or("")
                            .to_string()
                    } else {
                        String::new()
                    }
                } else {
                    String::new()
                }
            } else {
                String::new()
            };

            let media_dir = game_dir.join("media");
            if !media_dir.exists() {
                continue;
            }

            let mut game_bytes: u64 = 0;

            if let Ok(media_entries) = fs::read_dir(&media_dir) {
                for media_entry in media_entries.flatten() {
                    let file_path = media_entry.path();
                    if !file_path.is_file() {
                        continue;
                    }
                    let file_name = file_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string();
                    let len = file_path.metadata().map(|m| m.len()).unwrap_or(0);
                    total_bytes += len;
                    game_bytes += len;

                    // Categorize by simplified roles
                    if file_name == "landscape.jpg" {
                        by_type.landscape_bytes += len;
                    } else if file_name == "cover.jpg" {
                        by_type.cover_bytes += len;
                    } else {
                        // Any other file (old format, store-*, library-*, etc.)
                        by_type.old_media_bytes += len;
                    }
                }
            }

            game_count += 1;
            game_sizes.push(GameMediaSize {
                app_id,
                title,
                bytes: game_bytes,
            });
        }
    }

    // Sort largest first
    game_sizes.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    let largest_games: Vec<GameMediaSize> = game_sizes.into_iter().take(20).collect();

    Ok(MediaCacheStats {
        total_bytes,
        game_count,
        largest_games,
        by_type,
    })
}

// ---------------------------------------------------------------------------
// compact_media_cache
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn compact_media_cache(
    app_handle: AppHandle,
    profile: Option<MediaCacheProfile>,
) -> Result<MediaCacheStats, String> {
    let profile = profile.unwrap_or_default();
    let games_dir = get_games_dir(&app_handle)?;
    if !games_dir.exists() {
        return get_media_cache_stats(app_handle);
    }

    let keep_roles = profile.library_roles();

    if let Ok(entries) = fs::read_dir(&games_dir) {
        for entry in entries.flatten() {
            let game_dir = entry.path();
            if !game_dir.is_dir() {
                continue;
            }
            let media_dir = game_dir.join("media");
            if !media_dir.exists() {
                continue;
            }

            // Collect files to remove
            let mut to_remove: Vec<PathBuf> = Vec::new();

            if let Ok(media_entries) = fs::read_dir(&media_dir) {
                for me in media_entries.flatten() {
                    let file_path = me.path();
                    if !file_path.is_file() {
                        continue;
                    }
                    let file_name = file_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string();

                    // Skip hidden files (hash index, etc.)
                    if file_name.starts_with('.') {
                        continue;
                    }

                    let role = media_role_from_filename(&file_name);

                    // Also remove legacy library-* filenames (library-grid.jpg, library-hero.jpg, etc.)
                    if file_name.starts_with("library-") {
                        to_remove.push(file_path);
                        continue;
                    }

                    if let Some(r) = role {
                        if !keep_roles.contains(&r) {
                            to_remove.push(file_path);
                        }
                    }
                }
            }

            // Remove files not needed by profile
            for path in &to_remove {
                let _ = fs::remove_file(path);
            }

            // Remove stale hash index (will be rebuilt on next download)
            let hash_index = media_dir.join(".hash_index.json");
            if hash_index.exists() {
                let _ = fs::remove_file(&hash_index);
            }

            // Dedup: for remaining files, check if any have identical hashes
            dedup_media_dir(&media_dir);

            // Remove empty media dir
            if media_dir.exists() {
                let is_empty = fs::read_dir(&media_dir)
                    .map(|mut d| d.next().is_none())
                    .unwrap_or(true);
                if is_empty {
                    let _ = fs::remove_dir(&media_dir);
                }
            }
        }
    }

    get_media_cache_stats(app_handle)
}

/// Deduplicate files in a media directory: if two files have the same hash,
/// keep only the first one (alphabetically) and remove the rest.
fn dedup_media_dir(dir: &Path) {
    let mut hash_to_file: HashMap<String, PathBuf> = HashMap::new();

    if let Ok(entries) = fs::read_dir(dir) {
        let mut files: Vec<PathBuf> = entries
            .flatten()
            .filter(|e| e.path().is_file())
            .map(|e| e.path())
            .collect();
        files.sort(); // deterministic

        for path in files {
            if let Ok(h) = hash_file(&path) {
                if let Some(existing) = hash_to_file.get(&h) {
                    // Same hash — remove duplicate
                    if existing != &path {
                        let _ = fs::remove_file(&path);
                    }
                } else {
                    hash_to_file.insert(h, path);
                }
            }
        }
    }
}

fn media_role_from_filename(name: &str) -> Option<&'static str> {
    if name == "landscape.jpg" {
        Some("landscape")
    } else if name == "cover.jpg" {
        Some("cover")
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Process and save with dedup — used by safe_download_image
// ---------------------------------------------------------------------------

/// Download bytes, process (resize/compress), deduplicate, and save.
/// Uses a `.hash_index.json` file per media directory to track original content hashes
/// before processing. This ensures that identical source images (even after processing)
/// are stored only once.
/// Returns the path of the saved file.
pub fn process_and_save_with_dedup(
    bytes: &[u8],
    dest_path: &Path,
    media_type: &str,
) -> Result<String, String> {
    let parent = dest_path.parent().unwrap();

    // 1. Compute hash of incoming (original) bytes
    let content_hash = hash_bytes(bytes);

    // 2. Load (or create) hash index for this directory
    let index_path = parent.join(".hash_index.json");
    let mut index: HashMap<String, String> = if index_path.exists() {
        fs::read_to_string(&index_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        HashMap::new()
    };

    // 3. Check if this hash already exists in the index
    if let Some(existing_filename) = index.get(&content_hash) {
        let existing_path = parent.join(existing_filename);
        if existing_path.exists() {
            // Same original content — reuse existing processed file
            return Ok(existing_path.to_string_lossy().to_string());
        }
    }

    // 4. Process and save
    image_utils::process_and_save_image(bytes, dest_path, media_type)?;

    // 5. Update hash index
    if let Some(filename) = dest_path.file_name().and_then(|n| n.to_str()) {
        index.insert(content_hash, filename.to_string());
        if let Ok(json) = serde_json::to_string(&index) {
            let _ = fs::write(&index_path, &json);
        }
    }

    Ok(dest_path.to_string_lossy().to_string())
}
