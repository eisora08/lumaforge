const LAUNCH_STATE_KEY = "lumaforge-launch-state-v1";

export type PersistedLaunchState = {
  gameId: string;
  appId?: string;
  title?: string;
  state: "launching" | "running" | "stopping" | "idle" | "error";
  pid?: number;
  source?: "steam" | "local";
  launchedAt?: number;
  updatedAt: number;
};

export type LaunchStateStore = Record<string, PersistedLaunchState>;

function getGameKey(game: { id?: string; appId?: string; executablePath?: string }): string {
  if (game.id) return game.id;
  if (game.appId) return `app-${game.appId}`;
  if (game.executablePath) return `path-${game.executablePath}`;
  return "unknown";
}

function readStore(): LaunchStateStore {
  try {
    const raw = localStorage.getItem(LAUNCH_STATE_KEY);
    if (raw) return JSON.parse(raw) as LaunchStateStore;
  } catch {
    // ignore parse errors
  }
  return {};
}

function writeStore(store: LaunchStateStore): void {
  try {
    localStorage.setItem(LAUNCH_STATE_KEY, JSON.stringify(store));
  } catch {
    // ignore write errors
  }
}

export function saveLaunchState(
  game: { id?: string; appId?: string; executablePath?: string; title?: string; source?: string },
  state: PersistedLaunchState["state"],
  opts?: { pid?: number; launchedAt?: number }
): void {
  const key = getGameKey(game);
  const store = readStore();
  store[key] = {
    gameId: game.id || key,
    appId: game.appId,
    title: game.title,
    state,
    pid: opts?.pid,
    source: game.source as "steam" | "local" | undefined,
    launchedAt: opts?.launchedAt,
    updatedAt: Date.now(),
  };
  writeStore(store);
  console.debug("[LaunchState] persist", { gameId: game.id, state, pid: opts?.pid, source: game.source });
}

export function loadLaunchState(game: { id?: string; appId?: string; executablePath?: string }): PersistedLaunchState | null {
  const key = getGameKey(game);
  const store = readStore();
  const record = store[key];
  if (!record) return null;
  console.debug("[LaunchState] hydrate", { gameId: game.id, savedRecord: record });
  return record;
}

export function clearLaunchState(game: { id?: string; appId?: string; executablePath?: string }): void {
  const key = getGameKey(game);
  const store = readStore();
  delete store[key];
  writeStore(store);
  console.debug("[LaunchState] clear", { gameId: game.id });
}

export function clearAllLaunchStates(): void {
  try {
    localStorage.removeItem(LAUNCH_STATE_KEY);
  } catch {
    // ignore
  }
}
