use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

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

    let shutdown = self.shutdown.clone();
    let stats_path = appcache_stats_path.clone();
    let debounce = Duration::from_millis(800);
    let poll_interval = Duration::from_millis(200);

    std::thread::spawn(move || {
      let mut pending: HashMap<(u32, String), (PathBuf, Instant, u64, u64)> = HashMap::new();

      loop {
        if shutdown.load(Ordering::Relaxed) {
          break;
        }

        match rx.recv_timeout(poll_interval) {
          Ok(Ok(event)) => {
            for path in &event.paths {
              if let Some(info) = extract_info(path, &stats_path) {
                let trace_id = next_trace_id();
                pending.insert(
                  (info.appid, info.source.clone()),
                  (path.clone(), Instant::now(), info.modified_at, info.size),
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

            pending.retain(|key, (path, ts, modified, size)| {
              if now.saturating_duration_since(*ts) >= debounce {
                emit.push((key.0, key.1.clone(), path.clone(), *modified, *size));
                false
              } else {
                true
              }
            });

            for (appid, source, path, modified_at, size) in emit {
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
}

fn extract_info(path: &Path, stats_path: &Path) -> Option<FileInfo> {
  let parent = path.parent()?;
  let raw_path = path.to_string_lossy().to_string();
  let fname = path.file_name()?.to_string_lossy().to_string();

  // Only handle appcache/stats files (UserGameStats_*.bin)
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
          });
        }
      }
    }
    eprintln!(
      "[ACH][WATCHER] rawPath={} fileName={} extractedAppId=null source=unknown",
      raw_path, fname
    );
    return None;
  }

  eprintln!(
    "[ACH][WATCHER] rawPath={} fileName={} extractedAppId=null source=unknown (unrecognized parent)",
    raw_path, fname
  );
  None
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
