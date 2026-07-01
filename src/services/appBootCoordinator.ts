import { loadStartupSnapshot } from "./startupSnapshotService";
import type { StartupSnapshot } from "./startupSnapshotService";
import { invoke } from "@tauri-apps/api/core";

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

const MAX_SPLASH_TIMEOUT_MS = 8_000;

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
let _splashClosed = false;

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

function logBoot(msg: string): void {
  console.log(`[Boot] ${msg}`);
}

async function closeSplashscreenAndShowMainOnce(): Promise<void> {
  if (_splashClosed) return;
  _splashClosed = true;

  logBoot("showing main window");

  try {
    await invoke("close_splashscreen_and_show_main");
    logBoot("splash closed");
  } catch (err) {
    console.warn("[Boot] close splash command failed:", String(err));
  }
}

function track(taskId: BootTaskId, fn: () => Promise<void>): Promise<void> {
  const start = performance.now();
  const log = (status: BootLogEntry["status"], error?: string) => {
    _bootLog.push({ taskId, status, error, elapsedMs: Math.round(performance.now() - start) });
  };

  log("started");
  return fn()
    .then(() => {
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
      void err;
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

  logBoot("start");
  _bootStatus = "booting";
  _bootProgress = 0;
  _bootError = null;
  _bootLog = [];
  _splashClosed = false;

  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error("Boot timeout")), MAX_SPLASH_TIMEOUT_MS);
  });

  _bootPromise = (async () => {
    try {
      await Promise.race([
        (async () => {
          await track("load-settings", async () => {
            logBoot("load settings start");
            await Promise.resolve();
            logBoot("load settings end");
          });

          await track("load-startup-snapshot", async () => {
            logBoot("load snapshot start");
            try {
              _snapshotLoaded = await loadStartupSnapshot();
              if (_snapshotLoaded) {
                const gameCount = _snapshotLoaded.library.games.length;
                const sidebarCount = _snapshotLoaded.sidebar.items.length;
                logBoot(`snapshot hydrated from file — games: ${gameCount}, sidebar items: ${sidebarCount}`);
              }
            } catch {
              _snapshotLoaded = null;
            }
            logBoot("load snapshot end");
          });

          await track("hydrate-snapshot-media", async () => {
            // Skipped — SQLite library_cache is the primary source.
            // No media validation needed at boot; resolution is lazy per-game.
            logBoot("snapshot hydration skipped (trusting SQLite cache)");
          });

          if (_snapshotResolve) _snapshotResolve();

          await track("load-library-cache", async () => {
            return new Promise((resolve) => setTimeout(resolve, 50));
          });

          await track("load-appinfo-index", async () => {
            return Promise.resolve();
          });

          await track("hydrate-sessions", async () => {
            return new Promise((resolve) => setTimeout(resolve, 30));
          });

          await track("init-store-cache", async () => {
            return Promise.resolve();
          });

          await track("init-image-caches", async () => {
            return Promise.resolve();
          });

          await track("confirm-mounted", async () => {
            return Promise.resolve();
          });

          logBoot("route shell ready");
          _bootStatus = "ready";
          _bootProgress = 100;
          notify();
        })(),
        timeoutPromise,
      ]);
    } catch (err) {
      const isTimeout = (err as Error).message === "Boot timeout";
      if (isTimeout) {
        logBoot("timeout reached, showing main anyway");
      } else {
        console.warn("[Boot] error:", (err as Error).message);
      }
      _bootStatus = isTimeout ? "timeout" : "error";
      _bootError = (err as Error).message ?? "Boot failed";
      _bootProgress = 80;
      notify();

      if (_snapshotResolve) _snapshotResolve();
    } finally {
      if (_snapshotResolve) _snapshotResolve();
      await closeSplashscreenAndShowMainOnce();
    }
  })();

  return _bootPromise;
}

export function scheduleAfterMain(fn: () => void, delayMs: number = 3000): void {
  const run = () => {
    setTimeout(fn, delayMs);
  };

  if (_bootStatus === "ready" || _bootStatus === "timeout") {
    run();
  } else {
    const unsub = subscribe(() => {
      if (_bootStatus === "ready" || _bootStatus === "timeout") {
        unsub();
        run();
      }
    });
  }
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
  _splashClosed = false;
  notify();
}
