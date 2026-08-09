import type { AppPage } from "../types/navigation";

/**
 * Navigation history stack — browser-like back/forward for LumaForge.
 * Resets on app restart (no localStorage persistence).
 */

let history: AppPage[] = ["home"];
let currentIndex = 0;
let listeners: Array<() => void> = [];

// Cached snapshot for useSyncExternalStore (must return stable reference)
let _cachedSnapshot = { canGoBack: false, canGoForward: false };

function notify() {
  // Rebuild snapshot only when values change
  const next = { canGoBack: currentIndex > 0, canGoForward: currentIndex < history.length - 1 };
  if (next.canGoBack !== _cachedSnapshot.canGoBack || next.canGoForward !== _cachedSnapshot.canGoForward) {
    _cachedSnapshot = next;
  }
  for (const fn of listeners) fn();
}

export function pushToHistory(page: AppPage) {
  // Truncate forward history when navigating to a new page
  if (currentIndex < history.length - 1) {
    history = history.slice(0, currentIndex + 1);
  }
  // Avoid duplicate consecutive entries
  if (history[history.length - 1] === page) {
    return;
  }
  history = [...history, page];
  currentIndex = history.length - 1;
  notify();
}

export function goBack(): AppPage | null {
  if (currentIndex <= 0) return null;
  currentIndex--;
  notify();
  return history[currentIndex];
}

export function goForward(): AppPage | null {
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

export function getCurrentIndex(): number {
  return currentIndex;
}

export function getHistoryLength(): number {
  return history.length;
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
