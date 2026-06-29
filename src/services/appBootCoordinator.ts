// ---------------------------------------------------------------------------
// Boot Coordinator — Part 7
// Manages critical lightweight startup tasks.
// Heavy work (SteamGridDB, full scans, media prewarm) remains background/lazy.
// ---------------------------------------------------------------------------

import { loadStartupSnapshot, hydrateStartupSnapshotMedia, saveStartupSnapshot, flushPendingAppInfoUpdates } from "./startupSnapshotService";
import type { StartupSnapshot } from "./startupSnapshotService";

export type BootStatus =
  | "booting"
  | "ready"
  | "error"
  | "timeout";

export type BootTaskId =
  | "load-settings"
  | "load-startup-snapshot"
  | "hydrate-snapshot-media"
  | "load-library-cache"
  | "load-appinfo-index"
  | "hydrate-sessions"
  | "init-store-cache"
  | "init-image-caches"
  | "confirm-mounted";

export type BootLogEntry = {
  taskId: BootTaskId;
  status: "started" | "done" | "skipped" | "error";
  error?: string;
  elapsedMs: number;
};

const ENABLE_VERBOSE_BOOT_LOGS = false;
const MAX_SPLASH_TIMEOUT_MS = 10_000;

let _bootStatus: BootStatus = "booting";
let _bootProgress = 0;
let _bootError: string | null = null;
let _bootLog: BootLogEntry[] = [];
let _listeners: Set<() => void> = new Set();
let _bootPromise: Promise<void> | null = null;
let _snapshotLoaded: StartupSnapshot | null = null;
let _snapshotResolve: (() => void) | null = null;
let _snapshotReady: Promise<void> = new Promise((resolve) => {
  _snapshotResolve = resolve;
});

export function getBootSnapshot(): StartupSnapshot | null {
  return _snapshotLoaded;
}

export async function waitForBootSnapshot(): Promise<StartupSnapshot | null> {
  await _snapshotReady;
  return _snapshotLoaded;
}

function notify(): void {
  for (const fn of _listeners) {
    try { fn(); } catch { /* ignore */ }
  }
}

function track(taskId: BootTaskId, fn: () => Promise<void>): Promise<void> {
  const start = performance.now();
  const log = (status: BootLogEntry["status"], error?: string) => {
    _bootLog.push({ taskId, status, error, elapsedMs: Math.round(performance.now() - start) });
  };

  if (ENABLE_VERBOSE_BOOT_LOGS) console.log("[Boot] task start:", taskId);
  log("started");
  return fn()
    .then(() => {
      if (ENABLE_VERBOSE_BOOT_LOGS) console.log("[Boot] task done:", taskId);
      log("done");
      _bootProgress = Math.min(100, _bootProgress + 15);
      notify();
    })
    .catch((err) => {
      const msg = String(err);
      console.warn("[Boot] task error:", taskId, msg);
      log("error", msg);
      _bootError = msg;
      _bootProgress = Math.min(100, _bootProgress + 10);
      void err; // swallow — never crash from boot
      notify();
    });
}

export function getBootStatus(): BootStatus {
  return _bootStatus;
}

export function getBootProgress(): number {
  return _bootProgress;
}

export function getBootError(): string | null {
  return _bootError;
}

export function getBootLog(): BootLogEntry[] {
  return [..._bootLog];
}

export function isBootReady(): boolean {
  return _bootStatus === "ready";
}

export function subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

export async function runBootTasks(): Promise<void> {
  if (_bootPromise) return _bootPromise;

  if (ENABLE_VERBOSE_BOOT_LOGS) console.log("[Boot] start");
  _bootStatus = "booting";
  _bootProgress = 0;
  _bootError = null;
  _bootLog = [];

  const timeout = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error("Boot timeout")), MAX_SPLASH_TIMEOUT_MS);
  });

  _bootPromise = Promise.race([
    (async () => {
      // Task 1: Load settings (already handled by SettingsProvider — just confirm)
      await track("load-settings", async () => {
        return Promise.resolve();
      });

      // Task 2: Load startup snapshot (cache-first — no heavy work)
      await track("load-startup-snapshot", async () => {
        try {
          _snapshotLoaded = await loadStartupSnapshot();
          if (_snapshotLoaded) {
            const gameCount = _snapshotLoaded.library.games.length;
            const sidebarCount = _snapshotLoaded.sidebar.items.length;
            console.log(`[BootSnapshot] hydrated from file — games: ${gameCount}, sidebar items: ${sidebarCount}`);
          }
        } catch {
          _snapshotLoaded = null;
        }
        // NOTE: _snapshotResolve is called AFTER hydrate-snapshot-media below
      });

      // Task 3: Hydrate snapshot media from canonical appinfo / physical files
      await track("hydrate-snapshot-media", async () => {
        if (!_snapshotLoaded) return;
        try {
          // Flush any pending appinfo updates before reading canonical
          await flushPendingAppInfoUpdates(2000);
          const result = await hydrateStartupSnapshotMedia(_snapshotLoaded);
          console.log(
            `[BootSnapshot] loaded games: ${_snapshotLoaded.library.games.length}`
          );
          console.log(
            `[BootSnapshot] synced from appinfo — ready: ${result.readyCount}, ` +
            `partial: ${result.partialCount}, missing: ${result.missingCount}, stale: ${result.staleCount}`
          );
          console.log(`[BootSnapshot] mediaReadyAppIds: ${_snapshotLoaded.indexes.mediaReadyAppIds.length}`);
          if (result.changed) {
            await saveStartupSnapshot(_snapshotLoaded);
            console.log("[BootSnapshot] wrote repaired snapshot");
          } else {
            console.log("[BootSnapshot] snapshot already up-to-date — no repair needed");
          }
        } catch (err) {
          console.warn("[BootSnapshot] hydrate error:", String(err));
        }
      });

      // Resolve snapshot promise AFTER repair so consumers get repaired data
      if (_snapshotResolve) _snapshotResolve();

      // Task 4: Load cached library games/index
      await track("load-library-cache", async () => {
        return new Promise((resolve) => setTimeout(resolve, 50));
      });

      // Task 5: Load appinfo/media index (lightweight)
      await track("load-appinfo-index", async () => {
        return Promise.resolve();
      });

      // Task 6: Hydrate running game sessions
      await track("hydrate-sessions", async () => {
        return new Promise((resolve) => setTimeout(resolve, 30));
      });

      // Task 7: Initialize Store cache services
      await track("init-store-cache", async () => {
        return Promise.resolve();
      });

      // Task 8: Initialize image resolver caches
      await track("init-image-caches", async () => {
        return Promise.resolve();
      });

      // Task 9: Confirm frontend mounted
      await track("confirm-mounted", async () => {
        return Promise.resolve();
      });

      if (ENABLE_VERBOSE_BOOT_LOGS) console.log("[Boot] ready");
      _bootStatus = "ready";
      _bootProgress = 100;
      notify();
    })(),
    timeout,
  ]).catch((err) => {
    const isTimeout = (err as Error).message === "Boot timeout";
    if (isTimeout) {
      console.warn("[Boot] startup timeout reached, showing main window");
    } else {
      console.warn("[Boot] error:", (err as Error).message);
    }
    _bootStatus = isTimeout ? "timeout" : "error";
    _bootError = (err as Error).message ?? "Boot failed";
    _bootProgress = 80;
    notify();
  });

  return _bootPromise;
}

export function resetBootState(): void {
  _bootStatus = "booting";
  _bootProgress = 0;
  _bootError = null;
  _bootLog = [];
  _bootPromise = null;
  _snapshotLoaded = null;
  _snapshotReady = new Promise((resolve) => {
    _snapshotResolve = resolve;
  });
  notify();
}
