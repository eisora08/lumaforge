import {
  getPlayQueue as getPlayQueueBackend,
  addToPlayQueue as addToPlayQueueBackend,
  removeFromPlayQueue as removeFromPlayQueueBackend,
  reorderPlayQueue as reorderPlayQueueBackend,
  clearPlayQueue as clearPlayQueueBackend,
} from "./tauri";
import type { PlayQueueEntry } from "./tauri";
import { subscribeDataChanges } from "./dataChangeBus";

// ---------------------------------------------------------------------------
// Play Next queue — service layer with localStorage + Tauri persistence.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "lumaforge-play-queue-v1";
const MAX_QUEUE_SIZE = 50;

// In-memory cache
let cachedQueue: PlayQueueEntry[] = [];
let loadPromise: Promise<PlayQueueEntry[]> | null = null;

// Listeners
type QueueListener = () => void;
const _listeners = new Set<QueueListener>();

function notifyListeners(): void {
  for (const fn of _listeners) {
    try { fn(); } catch {}
  }
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function loadFromLocalStorage(): PlayQueueEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e: unknown): e is PlayQueueEntry =>
        typeof e === "object" &&
        e !== null &&
        "gameId" in e &&
        "position" in e &&
        "addedAt" in e
    );
  } catch {
    return [];
  }
}

function saveToLocalStorage(queue: PlayQueueEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function loadPlayQueue(forceRefresh = false): Promise<PlayQueueEntry[]> {
  if (cachedQueue.length > 0 && !forceRefresh) return cachedQueue;
  if (loadPromise && !forceRefresh) return loadPromise;

  loadPromise = getPlayQueueBackend().then((entries) => {
    cachedQueue = entries;
    saveToLocalStorage(entries);
    loadPromise = null;
    return entries;
  }).catch(() => {
    // Fallback to localStorage
    const local = loadFromLocalStorage();
    cachedQueue = local;
    loadPromise = null;
    return local;
  });

  return loadPromise;
}

export function getCachedPlayQueue(): PlayQueueEntry[] {
  return cachedQueue;
}

export function isInPlayQueue(gameId: string): boolean {
  return cachedQueue.some((e) => e.gameId === gameId);
}

export async function addToPlayQueue(gameId: string): Promise<boolean> {
  if (cachedQueue.length >= MAX_QUEUE_SIZE) return false;
  if (isInPlayQueue(gameId)) return false;

  const entry = await addToPlayQueueBackend(gameId);
  if (!entry) return false;

  cachedQueue = [...cachedQueue, entry].sort((a, b) => a.position - b.position);
  saveToLocalStorage(cachedQueue);
  notifyListeners();
  return true;
}

export async function removeFromPlayQueue(gameId: string): Promise<boolean> {
  if (!isInPlayQueue(gameId)) return false;

  await removeFromPlayQueueBackend(gameId);
  cachedQueue = cachedQueue.filter((e) => e.gameId !== gameId);
  saveToLocalStorage(cachedQueue);
  notifyListeners();
  return true;
}

export async function togglePlayQueue(gameId: string): Promise<boolean> {
  if (isInPlayQueue(gameId)) {
    await removeFromPlayQueue(gameId);
    return false;
  } else {
    return await addToPlayQueue(gameId);
  }
}

export async function reorderPlayQueue(gameIds: string[]): Promise<void> {
  await reorderPlayQueueBackend(gameIds);
  // Rebuild cache with new order
  cachedQueue = gameIds
    .map((id, i) => {
      const existing = cachedQueue.find((e) => e.gameId === id);
      return {
        gameId: id,
        position: i,
        addedAt: existing?.addedAt ?? Math.floor(Date.now() / 1000),
      };
    });
  saveToLocalStorage(cachedQueue);
  notifyListeners();
}

export async function clearPlayQueue(): Promise<void> {
  await clearPlayQueueBackend();
  cachedQueue = [];
  saveToLocalStorage(cachedQueue);
  notifyListeners();
}

// ---------------------------------------------------------------------------
// Subscribe / unsubscribe
// ---------------------------------------------------------------------------

export function subscribePlayQueue(fn: QueueListener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

// ---------------------------------------------------------------------------
// Listen for backend changes (e.g. from another process or restore)
// ---------------------------------------------------------------------------

let _dataChangeUnsub: (() => void) | null = null;

export function initPlayQueueDataChangeListener(): void {
  if (_dataChangeUnsub) return;
  _dataChangeUnsub = subscribeDataChanges((type) => {
    if (type === "play-queue-changed") {
      loadPlayQueue(true).then(() => notifyListeners()).catch(() => {});
    }
  });
}

export function destroyPlayQueueDataChangeListener(): void {
  _dataChangeUnsub?.();
  _dataChangeUnsub = null;
}
