import type { AppPage } from "../types/navigation";

export type HistoryEntry = { page: AppPage; tag?: string };

/**
 * Navigation history stack — browser-like back/forward for LumaForge.
 * Supports tagged entries for Store sub-views (tabs, sections, search, detail).
 * Resets on app restart (no localStorage persistence).
 */

let history: HistoryEntry[] = [{ page: "home" }];
let currentIndex = 0;
let listeners: Array<() => void> = [];

// Cached snapshot for useSyncExternalStore (must return stable reference)
let _cachedSnapshot = { canGoBack: false, canGoForward: false };

function notify() {
  const next = { canGoBack: currentIndex > 0, canGoForward: currentIndex < history.length - 1 };
  if (next.canGoBack !== _cachedSnapshot.canGoBack || next.canGoForward !== _cachedSnapshot.canGoForward) {
    _cachedSnapshot = next;
  }
  for (const fn of listeners) fn();
}

export function pushToHistory(page: AppPage, tag?: string) {
  if (currentIndex < history.length - 1) {
    history = history.slice(0, currentIndex + 1);
  }
  const last = history[history.length - 1];
  if (last.page === page && last.tag === tag) {
    return;
  }
  history = [...history, { page, tag }];
  currentIndex = history.length - 1;
  notify();
}

export function goBack(): HistoryEntry | null {
  if (currentIndex <= 0) return null;
  currentIndex--;
  notify();
  return history[currentIndex];
}

export function goForward(): HistoryEntry | null {
  if (currentIndex >= history.length - 1) return null;
  currentIndex++;
  notify();
  return history[currentIndex];
}

export function canGoBack(): boolean {
  return currentIndex > 0;
}

export function canGoForward(): boolean {
  return currentIndex < history.length - 1;
}

export function subscribeHistory(fn: () => void): () => void {
  listeners = [...listeners, fn];
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export function getHistorySnapshot() {
  return _cachedSnapshot;
}
