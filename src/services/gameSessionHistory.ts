import type { GameActivityItem } from "../types/gameActivity";

// ─── Types ──────────────────────────────────────────────────────────────

export type SessionExitReason = "normal" | "stopped" | "crashed" | "unknown";

export type GameSessionRecord = {
  id: string;
  appId: string;
  title: string;
  source: GameActivityItem["source"];
  startedAt: number;   // Date.now() ms
  endedAt: number;     // Date.now() ms
  durationMs: number;  // endedAt - startedAt
  durationMinutes: number;
  exitReason?: SessionExitReason;
  createdAt: number;   // Date.now() ms
};

type SessionHistoryStore = {
  version: number;
  sessions: GameSessionRecord[];
};

// ─── Storage ────────────────────────────────────────────────────────────

const STORAGE_KEY = "lumaforge-session-history-v1";
const MAX_SESSIONS = 500;

// ─── Persistence ────────────────────────────────────────────────────────

function loadStore(): SessionHistoryStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SessionHistoryStore;
      if (Array.isArray(parsed.sessions)) return parsed;
    }
  } catch {
    // corrupt storage
  }
  return { version: 1, sessions: [] };
}

function saveStore(store: SessionHistoryStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage full */
  }
}

// ─── Subscription ───────────────────────────────────────────────────────

type SessionHistoryListener = () => void;
const _listeners = new Set<SessionHistoryListener>();

export function subscribeSessionHistory(fn: SessionHistoryListener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

function notifyListeners(): void {
  _listeners.forEach(fn => fn());
}

// ─── Public API ─────────────────────────────────────────────────────────

export function loadSessions(): GameSessionRecord[] {
  return loadStore().sessions;
}

export function getSessionsForGame(appId: string): GameSessionRecord[] {
  return loadStore().sessions.filter(s => s.appId === appId);
}

export function getAllSessions(): GameSessionRecord[] {
  return loadStore().sessions;
}

export function getSessionCount(): number {
  return loadStore().sessions.length;
}

export function addSession(record: GameSessionRecord): boolean {
  const store = loadStore();

  // Dedup by stable id
  if (store.sessions.some(s => s.id === record.id)) return false;

  // Enforce duration threshold (> 0)
  if (record.durationMs <= 0) return false;

  store.sessions.push(record);

  // Cap at MAX_SESSIONS (keep newest)
  if (store.sessions.length > MAX_SESSIONS) {
    store.sessions = store.sessions.slice(-MAX_SESSIONS);
  }

  saveStore(store);
  notifyListeners();
  return true;
}

export function buildSessionId(appId: string, startedAt: number, endedAt: number): string {
  return `${appId}:${startedAt}:${endedAt}`;
}

/**
 * Create a session record from session start/end data.
 * Returns null if duration is invalid (< MIN_DURATION_MS).
 */
export function createSessionRecord(params: {
  appId: string;
  title: string;
  source: GameActivityItem["source"];
  startedAt: number;  // Date.now() ms
  endedAt: number;    // Date.now() ms
  exitReason?: SessionExitReason;
}): GameSessionRecord | null {
  const durationMs = params.endedAt - params.startedAt;
  if (durationMs <= 0) return null;

  return {
    id: buildSessionId(params.appId, params.startedAt, params.endedAt),
    appId: params.appId,
    title: params.title,
    source: params.source,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    durationMs,
    durationMinutes: Math.round(durationMs / 60000),
    exitReason: params.exitReason,
    createdAt: Date.now(),
  };
}

export function clearSessions(): void {
  saveStore({ version: 1, sessions: [] });
  notifyListeners();
}

// Listen for external restore writes and reload session history from localStorage
if (typeof window !== "undefined") {
  window.addEventListener("lumaforge-data-changed", (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.key === STORAGE_KEY) {
      notifyListeners();
    }
  });
}
