use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::steam_achievements::resolve_steam_root;

// Disable verbose watcher event logs by default
const DEBUG_ACH_WATCHER: bool = true;

static TRACE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_trace_id() -> String {
  let ts = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis() as u64;
  let counter = TRACE_COUNTER.fetch_add(1, Ordering::Relaxed);
  format!("{:x}{:04x}", ts & 0xFFFFFF, counter & 0xFFFF)
}

#[derive(Debug, Clone, Serialize)]
pub struct AchievementFileChangedPayload {
  pub appid: u32,
  pub source: String,
  pub path: String,
  pub modified_at: u64,
  pub size: u64,
  pub trace_id: String,
  pub save_path: Option<String>,
}

pub struct AchievementWatcher {
  inner: Option<RecommendedWatcher>,
  shutdown: Arc<AtomicBool>,
}

impl AchievementWatcher {
  pub fn new() -> Self {
    Self {
      inner: None,
      shutdown: Arc::new(AtomicBool::new(false)),
    }
  }

  pub fn start(
    &mut self,
    app_handle: AppHandle,
    librarycache_path: PathBuf,
    appcache_stats_path: PathBuf,
  ) -> Result<(), String> {
    self.stop();
    // Reset the shutdown flag so the new thread doesn't see the previous
    // stop()'s true and exit immediately.  (This was the root cause of the
    // watcher dying instantly on every restart.)
    self.shutdown.store(false, Ordering::Relaxed);

    let (tx, rx) = mpsc::channel();

    let mut watcher = RecommendedWatcher::new(
      move |res: Result<Event, notify::Error>| {
        let _ = tx.send(res);
      },
      Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    if appcache_stats_path.is_dir() {
      watcher
        .watch(&appcache_stats_path, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch appcache stats: {}", e))?;
      eprintln!(
        "[ACH][WATCHER] watching appcacheStats={}",
        appcache_stats_path.display()
      );
    } else {
      eprintln!(
        "[ACH][WATCHER] appcache stats path not found: {}",
        appcache_stats_path.display()
      );
    }

    // Also watch librarycache for real-time achievement updates
    if librarycache_path.is_dir() {
      watcher
        .watch(&librarycache_path, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch librarycache: {}", e))?;
      eprintln!(
        "[ACH][WATCHER] watching librarycache={}",
        librarycache_path.display()
      );
    } else {
      eprintln!(
        "[ACH][WATCHER] librarycache path not found: {}",
        librarycache_path.display()
      );
    }

    // Watch crack save directories (RUNE, CODEX, GSE, OnlineFix, Goldberg, etc.)
    let crack_bases = resolve_crack_save_bases();
    let mut crack_dirs_watched = 0;
    for base in &crack_bases {
      // Watch each <appId> subdirectory that has achievement data
      if let Ok(entries) = std::fs::read_dir(base) {
        for entry in entries.flatten() {
          let p = entry.path();
          if p.is_dir() && (p.join("achievements.ini").exists() || p.join("achievements.json").exists()) {
            if let Err(e) = watcher.watch(&p, RecursiveMode::NonRecursive) {
              eprintln!("[ACH][WATCHER] failed to watch crack dir {}: {}", p.display(), e);
            } else {
              crack_dirs_watched += 1;
              if DEBUG_ACH_WATCHER {
                eprintln!("[ACH][WATCHER] watching crackSaveDir={}", p.display());
              }
            }
          }
        }
      }
    }
    eprintln!(
      "[ACH][WATCHER] watching crackSaveBases={} crackDirs={}",
      crack_bases.len(),
      crack_dirs_watched
    );

    // Schema generation happens on-demand when GameDetails opens (via resolver).
    // Watcher only watches for achievements.ini changes.

    let shutdown = self.shutdown.clone();
    let stats_path = appcache_stats_path.clone();
    let libcache_path = librarycache_path;
    let debounce = Duration::from_millis(200);
    let poll_interval = Duration::from_millis(200);

    std::thread::spawn(move || {
      let mut pending: HashMap<(u32, String), (PathBuf, Instant, u64, u64, Option<String>)> = HashMap::new();

      loop {
        if shutdown.load(Ordering::Relaxed) {
          break;
        }

        match rx.recv_timeout(poll_interval) {
          Ok(Ok(event)) => {
            for path in &event.paths {
              if let Some(info) = extract_info(path, &stats_path, &libcache_path) {
                let trace_id = next_trace_id();
                pending.insert(
                  (info.appid, info.source.clone()),
                  (path.clone(), Instant::now(), info.modified_at, info.size, info.save_path),
                );
                if DEBUG_ACH_WATCHER {
                  eprintln!(
                    "[ACH][WATCHER][{}] rust event path={}",
                    trace_id,
                    path.display()
                  );
                  eprintln!(
                    "[ACH][WATCHER][{}] parsed appid={} source={}",
                    trace_id, info.appid, info.source
                  );
                }
              }
            }
          }
          Ok(Err(e)) => {
            eprintln!("[ACH][WATCHER] notify error: {:?}", e);
          }
          Err(RecvTimeoutError::Timeout) => {
            let now = Instant::now();
            let mut emit = Vec::new();

            pending.retain(|key, (path, ts, modified, size, save_path)| {
              if now.saturating_duration_since(*ts) >= debounce {
                emit.push((key.0, key.1.clone(), path.clone(), *modified, *size, save_path.clone()));
                false
              } else {
                true
              }
            });

            for (appid, source, path, modified_at, size, save_path) in emit {
              let trace_id = next_trace_id();
                if DEBUG_ACH_WATCHER {
                  eprintln!(
                    "[ACH][WATCHER][{}] changed appid={} source={} path={}",
                    trace_id,
                    appid,
                    source,
                    path.display()
                  );
                  eprintln!(
                    "[ACH][WATCHER][{}] emitted frontend event",
                    trace_id
                  );
                }
              let payload = AchievementFileChangedPayload {
                appid,
                source,
                path: path.to_string_lossy().to_string(),
                modified_at,
                size,
                trace_id,
                save_path,
              };
              let _ = app_handle.emit("achievement-progress-file-changed", &payload);
            }
          }
          Err(RecvTimeoutError::Disconnected) => {
            eprintln!("[ACH][WATCHER] channel disconnected, stopping");
            break;
          }
        }
      }
      eprintln!("[ACH][WATCHER] stopped");
    });

    self.inner = Some(watcher);
    eprintln!("[ACH][WATCHER] starting");
    Ok(())
  }

  pub fn stop(&mut self) {
    if self.inner.is_some() {
      self.shutdown.store(true, Ordering::Relaxed);
      self.inner = None;
    }
  }

  pub fn is_running(&self) -> bool {
    self.inner.is_some()
  }
}

impl Drop for AchievementWatcher {
  fn drop(&mut self) {
    self.stop();
  }
}

struct FileInfo {
  appid: u32,
  source: String,
  modified_at: u64,
  size: u64,
  save_path: Option<String>,
}

// Known crack save base directories: (env_key, segments_after_env)
// e.g. ("PUBLIC", ["Documents","Steam","RUNE"]) → %PUBLIC%\Documents\Steam\RUNE
const CRACK_SAVE_BASES: &[(&str, &[&str])] = &[
  ("PUBLIC", &["Documents", "Steam", "RUNE"]),
  ("PUBLIC", &["Documents", "Steam", "CODEX"]),
  ("PUBLIC", &["Documents", "OnlineFix"]),
  ("PUBLIC", &["Documents", "EMPRESS"]),
  ("APPDATA", &["GSE Saves"]),
  ("APPDATA", &["Goldberg SteamEmu Saves"]),
  ("APPDATA", &["Goldberg UplayEmu Saves"]),
  ("APPDATA", &["Goldberg SocialClub Emu Saves"]),
  ("APPDATA", &["Steam", "CODEX"]),
  ("APPDATA", &["SmartSteamEmu"]),
];

/// Resolve known crack save base paths from environment variables.
fn resolve_crack_save_bases() -> Vec<PathBuf> {
  let mut bases = Vec::new();
  for (env_key, segments) in CRACK_SAVE_BASES {
    if let Ok(env_val) = std::env::var(env_key) {
      let mut p = PathBuf::from(env_val);
      for seg in segments.iter() {
        p.push(seg);
      }
      if p.is_dir() {
        bases.push(p);
      }
    }
  }
  bases
}

/// Given a file path, check if it's achievements.ini inside a crack save dir.
/// Returns Some((appid, save_dir)) if so.
fn crack_ini_from_path(path: &Path) -> Option<(u32, PathBuf)> {
  let fname = path.file_name()?.to_string_lossy();
  if fname != "achievements.ini" {
    return None;
  }
  crack_save_dir_from_path(path)
}

/// Given a file path, check if it's achievements.json inside a crack save dir.
/// Returns Some((appid, save_dir)) if so.
fn crack_json_from_path(path: &Path) -> Option<(u32, PathBuf)> {
  let fname = path.file_name()?.to_string_lossy();
  if fname != "achievements.json" {
    return None;
  }
  crack_save_dir_from_path(path)
}

/// Shared helper: extract (appid, save_dir) from a crack achievement file path.
/// Validates that the parent directory name is a numeric appId and that
/// the grandparent is a known crack save base.
fn crack_save_dir_from_path(path: &Path) -> Option<(u32, PathBuf)> {
  let save_dir = path.parent()?;
  let appid_str = save_dir.file_name()?.to_string_lossy();
  let appid = appid_str.parse::<u32>().ok()?;
  let parent_of_save = save_dir.parent()?;
  let bases = resolve_crack_save_bases();
  for base in &bases {
    if parent_of_save == base.as_path() {
      return Some((appid, save_dir.to_path_buf()));
    }
  }
  None
}

fn extract_info(path: &Path, stats_path: &Path, libcache_path: &Path) -> Option<FileInfo> {
  let parent = path.parent()?;
  let raw_path = path.to_string_lossy().to_string();
  let fname = path.file_name()?.to_string_lossy().to_string();

  // Handle appcache/stats files (UserGameStats_*.bin)
  if parent == stats_path {
    if fname.starts_with("UserGameStats_") && fname.ends_with(".bin") {
      let without_ext = fname.trim_end_matches(".bin");
      let parts: Vec<&str> = without_ext.split('_').collect();
      if parts.len() >= 3 {
        if let Ok(appid) = parts[parts.len() - 1].parse::<u32>() {
          eprintln!(
            "[ACH][WATCHER] rawPath={} fileName={} extractedAppId={} source=usergamestats",
            raw_path, fname, appid
          );
          let meta = std::fs::metadata(path).ok()?;
          let modified = meta
            .modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()
            .map(|d| d.as_secs())
            .unwrap_or(0);
          return Some(FileInfo {
            appid,
            source: "usergamestats".to_string(),
            modified_at: modified,
            size: meta.len(),
            save_path: None,
          });
        }
      }
    }
  }

  // Handle librarycache files (<appid>.json)
  if parent == libcache_path {
    // Special case: achievement_progress.json is a global progress index (not per-game)
    if fname == "achievement_progress.json" {
      eprintln!(
        "[ACH][WATCHER] rawPath={} fileName={} extractedAppId=0 source=achievement-progress",
        raw_path, fname
      );
      let meta = std::fs::metadata(path).ok()?;
      let modified = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
        .unwrap_or(0);
      return Some(FileInfo {
        appid: 0,
        source: "achievement-progress".to_string(),
        modified_at: modified,
        size: meta.len(),
        save_path: None,
      });
    }
    if fname.ends_with(".json") && !fname.starts_with("achievement_progress") {
      if let Ok(appid) = fname.trim_end_matches(".json").parse::<u32>() {
        eprintln!(
          "[ACH][WATCHER] rawPath={} fileName={} extractedAppId={} source=librarycache",
          raw_path, fname, appid
        );
        let meta = std::fs::metadata(path).ok()?;
        let modified = meta
          .modified()
          .ok()?
          .duration_since(std::time::UNIX_EPOCH)
          .ok()
          .map(|d| d.as_secs())
          .unwrap_or(0);
        return Some(FileInfo {
          appid,
          source: "librarycache".to_string(),
          modified_at: modified,
          size: meta.len(),
          save_path: None,
        });
      }
    }
  }

  // Handle crack save achievements.ini
  if let Some((appid, save_dir)) = crack_ini_from_path(path) {
    eprintln!(
      "[ACH][WATCHER] rawPath={} fileName={} extractedAppId={} source=crack-ini savePath={}",
      raw_path, fname, appid, save_dir.display()
    );
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta
      .modified()
      .ok()?
      .duration_since(std::time::UNIX_EPOCH)
      .ok()
      .map(|d| d.as_secs())
      .unwrap_or(0);
    return Some(FileInfo {
      appid,
      source: "crack-ini".to_string(),
      modified_at: modified,
      size: meta.len(),
      save_path: Some(save_dir.to_string_lossy().to_string()),
    });
  }

  // Handle crack save achievements.json (GSE / Goldberg newer format)
  if let Some((appid, save_dir)) = crack_json_from_path(path) {
    eprintln!(
      "[ACH][WATCHER] rawPath={} fileName={} extractedAppId={} source=crack-json savePath={}",
      raw_path, fname, appid, save_dir.display()
    );
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta
      .modified()
      .ok()?
      .duration_since(std::time::UNIX_EPOCH)
      .ok()
      .map(|d| d.as_secs())
      .unwrap_or(0);
    return Some(FileInfo {
      appid,
      source: "crack-json".to_string(),
      modified_at: modified,
      size: meta.len(),
      save_path: Some(save_dir.to_string_lossy().to_string()),
    });
  }

  eprintln!(
    "[ACH][WATCHER] rawPath={} fileName={} extractedAppId=null source=unknown (unrecognized parent)",
    raw_path, fname
  );
  None
}

// ---------------------------------------------------------------------------
// Auto-generate achievement schemas for cracked games
// ---------------------------------------------------------------------------

/// Collect all <appId> subdirectories from crack save base directories that have achievement data.
fn collect_crack_app_ids(bases: &[PathBuf]) -> Vec<(u32, PathBuf)> {
  let mut result = Vec::new();
  for base in bases {
    if let Ok(entries) = std::fs::read_dir(base) {
      for entry in entries.flatten() {
        if entry.path().is_dir() {
          if let Some(name) = entry.file_name().to_str() {
            if let Ok(appid) = name.parse::<u32>() {
              // Only include dirs that have actual achievement data
              let p = entry.path();
              if p.join("achievements.ini").exists() || p.join("achievements.json").exists() {
                result.push((appid, p));
              }
            }
          }
        }
      }
    }
  }
  result
}

// ---------------------------------------------------------------------------
// Tauri State
// ---------------------------------------------------------------------------

pub struct AchievementWatcherState(pub Mutex<AchievementWatcher>);

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn start_achievement_watcher(
  app_handle: AppHandle,
  state: tauri::State<'_, AchievementWatcherState>,
  steam_path: Option<String>,
  steam_account_id: String,
) -> Result<(), String> {
  let steam_root = resolve_steam_root(steam_path.as_deref())?;

  let librarycache_path = steam_root
    .join("userdata")
    .join(&steam_account_id)
    .join("config")
    .join("librarycache");

  let appcache_stats_path = steam_root.join("appcache").join("stats");

  eprintln!("[ACH][WATCHER] starting watcher");
  if DEBUG_ACH_WATCHER {
    eprintln!("[ACH][WATCHER] steamRoot={}", steam_root.display());
    eprintln!("[ACH][WATCHER] accountId={}", steam_account_id);
    eprintln!(
      "[ACH][WATCHER] watchingLibrarycache={}",
      librarycache_path.display()
    );
    eprintln!(
      "[ACH][WATCHER] watchingAppcacheStats={}",
      appcache_stats_path.display()
    );
  }

  if !librarycache_path.exists() {
    eprintln!(
      "[ACH][WATCHER] MISSING path={}",
      librarycache_path.display()
    );
  }
  if !appcache_stats_path.exists() {
    eprintln!(
      "[ACH][WATCHER] MISSING path={}",
      appcache_stats_path.display()
    );
  }

  let mut watcher = state
    .0
    .lock()
    .map_err(|e| format!("Failed to lock watcher state: {}", e))?;

  watcher.start(app_handle, librarycache_path, appcache_stats_path)
}

#[tauri::command]
pub fn list_librarycache_appids(
  steam_path: Option<String>,
  steam_account_id: String,
) -> Result<Vec<u32>, String> {
  let steam_root = resolve_steam_root(steam_path.as_deref())?;
  let librarycache_path = steam_root
    .join("userdata")
    .join(&steam_account_id)
    .join("config")
    .join("librarycache");

  if !librarycache_path.is_dir() {
    return Ok(Vec::new());
  }

  let mut appids = Vec::new();

  if let Ok(entries) = std::fs::read_dir(&librarycache_path) {
    for entry in entries.flatten() {
      let path = entry.path();
      if path.extension().and_then(|e| e.to_str()) == Some("json") {
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
          if let Ok(appid) = stem.parse::<u32>() {
            appids.push(appid);
          }
        }
      }
    }
  }

  appids.sort();
  eprintln!(
    "[ACH][WATCHER] list_librarycache_appids count={}",
    appids.len()
  );
  Ok(appids)
}

#[tauri::command]
pub fn stop_achievement_watcher(
  state: tauri::State<'_, AchievementWatcherState>,
) -> Result<(), String> {
  let mut watcher = state
    .0
    .lock()
    .map_err(|e| format!("Failed to lock watcher state: {}", e))?;

  watcher.stop();
  Ok(())
}

#[tauri::command]
pub fn get_achievement_watcher_status(
  state: tauri::State<'_, AchievementWatcherState>,
) -> Result<bool, String> {
  let watcher = state
    .0
    .lock()
    .map_err(|e| format!("Failed to lock watcher state: {}", e))?;

  Ok(watcher.is_running())
}
