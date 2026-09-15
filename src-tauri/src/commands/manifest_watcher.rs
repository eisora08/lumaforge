use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::Manager;

const BACKUP_DIR_NAME: &str = "manifest-backup";
const DEBOUNCE_MS: u64 = 500;

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

pub struct ManifestWatcher {
    inner: Option<RecommendedWatcher>,
    shutdown: Arc<AtomicBool>,
}

impl ManifestWatcher {
    pub fn new() -> Self {
        Self {
            inner: None,
            shutdown: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn start(&mut self, app_handle: tauri::AppHandle) -> Result<(), String> {
        self.stop();
        self.shutdown.store(false, Ordering::Relaxed);

        let (tx, rx) = mpsc::channel();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                let _ = tx.send(res);
            },
            Config::default().with_poll_interval(Duration::from_secs(2)),
        )
        .map_err(|e| format!("Failed to create manifest watcher: {e}"))?;

        // Detect Steam depotcache path
        let steam_paths = crate::utils::path_utils::detect_steam_paths()
            .ok_or("Steam installation not found for manifest watcher")?;
        let depotcache = PathBuf::from(&steam_paths.depotcache_path);

        if !depotcache.exists() {
            return Err(format!(
                "Depotcache directory does not exist: {}",
                depotcache.display()
            ));
        }

        watcher
            .watch(&depotcache, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch depotcache: {e}"))?;

        let backup_root = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Cannot get app data dir: {e}"))?
            .join(BACKUP_DIR_NAME);

        let shutdown = self.shutdown.clone();
        let depotcache_clone = depotcache.clone();

        std::thread::spawn(move || {
            let mut last_event = std::time::Instant::now();
            let debounce = Duration::from_millis(DEBOUNCE_MS);

            loop {
                if shutdown.load(Ordering::Relaxed) {
                    break;
                }

                match rx.recv_timeout(Duration::from_secs(1)) {
                    Ok(Ok(event)) => {
                        if !event.kind.is_remove() {
                            continue;
                        }
                        // Debounce rapid-fire events
                        if last_event.elapsed() < debounce {
                            continue;
                        }
                        last_event = std::time::Instant::now();

                        for path in &event.paths {
                            let filename = match path.file_name() {
                                Some(f) => f.to_string_lossy().to_string(),
                                None => continue,
                            };
                            if !filename.ends_with(".manifest") {
                                continue;
                            }
                            restore_manifest(&depotcache_clone, &backup_root, &filename);
                        }
                    }
                    Ok(Err(_)) | Err(mpsc::RecvTimeoutError::Timeout) => {
                        // Timeout or error — just loop
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        break;
                    }
                }
            }
        });

        self.inner = Some(watcher);
        Ok(())
    }

    pub fn stop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        if let Some(watcher) = self.inner.take() {
            drop(watcher);
        }
    }

    pub fn is_running(&self) -> bool {
        self.inner.is_some() && !self.shutdown.load(Ordering::Relaxed)
    }
}

/// Restore a single manifest from backup to depotcache.
fn restore_manifest(depotcache: &Path, backup_root: &Path, filename: &str) {
    let dest = depotcache.join(filename);
    if dest.exists() {
        return; // Already there
    }

    // Scan all app dirs in backup for this filename
    let Ok(entries) = std::fs::read_dir(backup_root) else {
        return;
    };

    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let backup_file = entry.path().join(filename);
        if backup_file.exists() {
            let _ = std::fs::copy(&backup_file, &dest);
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri state + commands
// ---------------------------------------------------------------------------

pub struct ManifestWatcherState(pub Mutex<ManifestWatcher>);

#[tauri::command]
pub fn start_manifest_watcher(app_handle: tauri::AppHandle) -> Result<String, String> {
    let state = app_handle.state::<ManifestWatcherState>();
    let mut watcher = state.0.lock().map_err(|e| format!("Lock: {e}"))?;
    watcher.start(app_handle.clone())?;
    Ok("Manifest watcher started".to_string())
}

#[tauri::command]
pub fn stop_manifest_watcher(app_handle: tauri::AppHandle) -> Result<String, String> {
    let state = app_handle.state::<ManifestWatcherState>();
    let mut watcher = state.0.lock().map_err(|e| format!("Lock: {e}"))?;
    watcher.stop();
    Ok("Manifest watcher stopped".to_string())
}

#[tauri::command]
pub fn get_manifest_watcher_status(app_handle: tauri::AppHandle) -> Result<bool, String> {
    let state = app_handle.state::<ManifestWatcherState>();
    let watcher = state.0.lock().map_err(|e| format!("Lock: {e}"))?;
    Ok(watcher.is_running())
}
