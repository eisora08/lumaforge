import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// ── State ──────────────────────────────────────────────────────────
let _updateAvailable = false;
let _updateVersion: string | null = null;
let _currentVersion: string | null = null;
let _updateBody: string | null = null;
let _updateDate: string | null = null;
let _downloading = false;
let _downloadProgress = 0;
let _downloaded = false;
let _error: string | null = null;
let _checking = false;
let _updateRef: Update | null = null;

// ── Snapshot ───────────────────────────────────────────────────────
type AppUpdateSnapshot = {
  updateAvailable: boolean;
  updateVersion: string | null;
  currentVersion: string | null;
  updateBody: string | null;
  updateDate: string | null;
  downloading: boolean;
  downloadProgress: number;
  downloaded: boolean;
  error: string | null;
  checking: boolean;
};

let _snapshot: AppUpdateSnapshot = {
  updateAvailable: _updateAvailable,
  updateVersion: _updateVersion,
  currentVersion: _currentVersion,
  updateBody: _updateBody,
  updateDate: _updateDate,
  downloading: _downloading,
  downloadProgress: _downloadProgress,
  downloaded: _downloaded,
  error: _error,
  checking: _checking,
};

// ── Listeners ──────────────────────────────────────────────────────
const _listeners = new Set<() => void>();

function emit() {
  _snapshot = {
    updateAvailable: _updateAvailable,
    updateVersion: _updateVersion,
    currentVersion: _currentVersion,
    updateBody: _updateBody,
    updateDate: _updateDate,
    downloading: _downloading,
    downloadProgress: _downloadProgress,
    downloaded: _downloaded,
    error: _error,
    checking: _checking,
  };
  _listeners.forEach((cb) => cb());
}

// ── Subscribe / snapshot (useSyncExternalStore contract) ────────────
export function subscribeAppUpdate(cb: () => void): () => void {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

export function getAppUpdateSnapshot(): AppUpdateSnapshot {
  return _snapshot;
}

// ── Check for update ───────────────────────────────────────────────
export async function checkForUpdate(silent = true): Promise<void> {
  if (_checking) return;
  _checking = true;
  _error = null;
  emit();

  try {
    const update = await check({ timeout: 15000 });

    if (update) {
      _updateAvailable = true;
      _updateVersion = update.version;
      _currentVersion = update.currentVersion;
      _updateBody = update.body ?? null;
      _updateDate = update.date ?? null;
      _updateRef = update;
      console.log(`[UPDATE] Available: ${update.currentVersion} → ${update.version}`);
    } else {
      _updateAvailable = false;
      _updateVersion = null;
      _updateBody = null;
      _updateDate = null;
      _updateRef = null;
      if (!silent) {
        console.log("[UPDATE] App is up to date");
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    _error = msg;
    if (!silent) {
      console.warn("[UPDATE] Check failed:", msg);
    } else {
      console.log("[UPDATE] Silent check failed (network?):", msg);
    }
  } finally {
    _checking = false;
    emit();
  }
}

// ── Download and install ───────────────────────────────────────────
export async function downloadAndInstallUpdate(): Promise<void> {
  if (!_updateRef || _downloading) return;

  _downloading = true;
  _downloadProgress = 0;
  _error = null;
  emit();

  try {
    await _updateRef.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === "Started") {
        const total = event.data.contentLength;
        if (total) {
          console.log(`[UPDATE] Download started: ${(total / 1024 / 1024).toFixed(1)} MB`);
        }
      } else if (event.event === "Progress") {
        // We don't know total, just track bytes
        _downloadProgress = Math.min(99, _downloadProgress + 1);
        emit();
      } else if (event.event === "Finished") {
        console.log("[UPDATE] Download finished, installing…");
      }
    });

    _downloaded = true;
    _downloadProgress = 100;
    emit();

    // Give UI a moment to show "installed" state, then relaunch
    console.log("[UPDATE] Installed — relaunching…");
    await new Promise((r) => setTimeout(r, 600));
    await relaunch();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    _error = msg;
    _downloading = false;
    _downloadProgress = 0;
    console.error("[UPDATE] Download/install failed:", msg);
    emit();
  }
}

// ── Dismiss ────────────────────────────────────────────────────────
export function dismissUpdate() {
  _updateAvailable = false;
  _updateVersion = null;
  _updateBody = null;
  _updateDate = null;
  _updateRef = null;
  _downloading = false;
  _downloadProgress = 0;
  _downloaded = false;
  _error = null;
  emit();
}
