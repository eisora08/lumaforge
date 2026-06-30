import { invoke } from "@tauri-apps/api/core";

export type PlaytimeEntry = {
  gameKey: string;
  appId: string | null;
  provider: string;
  title: string;
  externalPlaytimeSeconds: number;
  externalSource: string | null;
  externalImportedAt: number | null;
  localPlaytimeSeconds: number;
  totalPlaytimeSeconds: number;
  lastPlayedAt: number | null;
  lastSessionSeconds: number | null;
  sessions: PlaytimeSession[];
};

export type PlaytimeSession = {
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  durationSeconds: number | null;
  exitReason: string | null;
};

export type PlaytimeStore = {
  version: number;
  updatedAt: number;
  games: Record<string, PlaytimeEntry>;
};

export type ActivePlaySession = {
  sessionId: string;
  startedAt: number;
  gameKey: string;
};

export type PlaySessionStart = {
  gameKey: string;
  appId?: string;
  provider: string;
  title: string;
  startedAt: number;
};

export type PlaySessionEnd = {
  sessionId: string;
  gameKey: string;
  endedAt: number;
  exitReason: "stopped" | "process-exited" | "crashed" | "unknown";
};

export type ExternalPlaytimeImport = {
  gameKey: string;
  appId?: string;
  provider: string;
  title?: string;
  externalPlaytimeSeconds: number;
  externalSource: "steam" | "epic" | "gog" | "manual" | "unknown";
};

let cachedStore: PlaytimeStore | null = null;
let loadPromise: Promise<PlaytimeStore> | null = null;

async function readStore(): Promise<PlaytimeStore> {
  try {
    return await invoke<PlaytimeStore>("read_playtime_store");
  } catch {
    return { version: 1, updatedAt: Date.now(), games: {} };
  }
}

export async function loadPlaytimeStore(forceRefresh = false): Promise<PlaytimeStore> {
  if (cachedStore && !forceRefresh) return cachedStore;
  if (loadPromise && !forceRefresh) return loadPromise;
  loadPromise = readStore().then((store) => {
    cachedStore = store;
    loadPromise = null;
    return store;
  });
  return loadPromise;
}

export function getCachedPlaytimeStore(): PlaytimeStore | null {
  return cachedStore;
}

export function getPlaytimeEntry(gameKey: string): PlaytimeEntry | null {
  if (!cachedStore) return null;
  return cachedStore.games[gameKey] ?? null;
}

export async function importExternalPlaytime(input: ExternalPlaytimeImport): Promise<PlaytimeEntry> {
  const entry = await invoke<PlaytimeEntry>("import_external_playtime", { input });
  if (cachedStore) {
    cachedStore.games[input.gameKey] = entry;
    cachedStore.updatedAt = Date.now();
  }
  return entry;
}

export async function startPlaySession(input: PlaySessionStart): Promise<ActivePlaySession> {
  const result = await invoke<ActivePlaySession>("record_play_session_start", { input });
  // Refresh cache
  await loadPlaytimeStore(true);
  return result;
}

export async function endPlaySession(input: PlaySessionEnd): Promise<PlaytimeEntry> {
  const entry = await invoke<PlaytimeEntry>("record_play_session_end", { input });
  if (cachedStore) {
    cachedStore.games[input.gameKey] = entry;
    cachedStore.updatedAt = Date.now();
  }
  return entry;
}

export function formatPlaytime(seconds: number): string {
  if (seconds <= 0) return "Not tracked";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) {
    if (secs === 0) return `${minutes}m`;
    return `${minutes}m ${secs}s`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  if (hours >= 10) return `${hours}.${Math.round(mins / 6)}h`;
  return `${hours}h ${mins}m`;
}

export function formatPlaytimeMinutes(minutes: number): string {
  if (minutes <= 0) return "Not tracked";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  if (h >= 10) return `${h}.${Math.round(m / 6)}h`;
  return `${h}h ${m}m`;
}

let snapshotImportDone = false;

export async function importSnapshotPlaytime(
  snapshotGames: Array<{ appId: string; playtime: number | null }>,
): Promise<void> {
  if (snapshotImportDone) return;
  snapshotImportDone = true;

  await loadPlaytimeStore();

  for (const game of snapshotGames) {
    if (!game.appId || !game.playtime || game.playtime <= 0) continue;
    const existing = cachedStore?.games[`app-${game.appId}`];
    if (existing?.externalPlaytimeSeconds && existing.externalPlaytimeSeconds >= game.playtime * 60) continue;
    try {
      await importExternalPlaytime({
        gameKey: `app-${game.appId}`,
        appId: game.appId,
        provider: "steam",
        title: "",
        externalPlaytimeSeconds: game.playtime * 60,
        externalSource: "steam",
      });
    } catch {
      // non-critical
    }
  }
}
