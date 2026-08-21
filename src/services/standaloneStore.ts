/**
 * Standalone Store
 *
 * Persists which games have Standalone Mode activated.
 * Uses localStorage (same pattern as FavoritesContext).
 */

const STORAGE_KEY = "lumaforge-standalone-appids";

let _cache: Set<string> | null = null;

export function loadStandaloneIds(): Set<string> {
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        _cache = new Set(arr.map(String));
        return _cache;
      }
    }
  } catch { /* corrupted — start fresh */ }
  _cache = new Set();
  return _cache;
}

function saveStandaloneIds(ids: Set<string>): void {
  _cache = ids;
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  window.dispatchEvent(new CustomEvent("lumaforge-data-changed", { detail: { key: STORAGE_KEY } }));
}

export function isStandalone(appId: string): boolean {
  return loadStandaloneIds().has(appId);
}

export function setStandalone(appId: string, value: boolean): void {
  const ids = loadStandaloneIds();
  if (value) {
    ids.add(appId);
  } else {
    ids.delete(appId);
  }
  saveStandaloneIds(ids);
}

export function getStandaloneSnapshot(): string[] {
  return [...loadStandaloneIds()];
}
