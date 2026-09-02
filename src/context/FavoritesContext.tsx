import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "lumaforge-favorites-v1";

type FavoritesState = {
  favoriteIds: Set<string>;
  isFavorite: (appId: string) => boolean;
  toggleFavorite: (appId: string) => void;
  /** Force re-read from localStorage after an external restore writes new data. */
  reloadFavorites: () => void;
};

const FavoritesContext = createContext<FavoritesState | null>(null);

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set<string>(arr);
  } catch {
    return new Set();
  }
}

function saveFavorites(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // non-critical
  }
}

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(loadFavorites);

  useEffect(() => {
    saveFavorites(favoriteIds);
  }, [favoriteIds]);

  const isFavorite = useCallback(
    (appId: string) => favoriteIds.has(appId),
    [favoriteIds],
  );

  const toggleFavorite = useCallback((appId: string) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      const newState = !next.has(appId);
      if (newState) {
        next.add(appId);
      } else {
        next.delete(appId);
      }

      // Persist to games_v2 DB
      (async () => {
        try {
          const { upsertGameV2, getGameV2 } = await import("../services/tauri");
          // Try common ID patterns: steam-{appId}, lua-{appId}, or the key itself
          const candidates = [
            `steam-${appId}`,
            `lua-${appId}`,
            appId,
          ];
          for (const id of candidates) {
            const existing = await getGameV2(id);
            if (existing) {
              await upsertGameV2({ ...existing, isFavorite: newState, updatedAt: Date.now() });
              console.log(`[Favorites] persisted isFavorite=${newState} for ${id}`);
              break;
            }
          }
        } catch (err) {
          console.warn("[Favorites] failed to persist to games_v2:", err);
        }
      })();

      return next;
    });
  }, []);

  const reloadFavorites = useCallback(() => {
    setFavoriteIds(loadFavorites());
  }, []);

  // Listen for external restore writes and reload
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.key === STORAGE_KEY) reloadFavorites();
    };
    window.addEventListener("lumaforge-data-changed", handler);
    return () => window.removeEventListener("lumaforge-data-changed", handler);
  }, [reloadFavorites]);

  const ctxValue = useMemo(() => ({ favoriteIds, isFavorite, toggleFavorite, reloadFavorites }), [favoriteIds, reloadFavorites]);

  return (
    <FavoritesContext.Provider value={ctxValue}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites(): FavoritesState {
  const ctx = useContext(FavoritesContext);
  if (!ctx) {
    throw new Error("useFavorites must be used within FavoritesProvider");
  }
  return ctx;
}
