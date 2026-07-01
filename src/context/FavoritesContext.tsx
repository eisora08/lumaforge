import { createContext, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "lumaforge-favorites-v1";

type FavoritesState = {
  favoriteIds: Set<string>;
  isFavorite: (appId: string) => boolean;
  toggleFavorite: (appId: string) => void;
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
      if (next.has(appId)) {
        next.delete(appId);
      } else {
        next.add(appId);
      }
      return next;
    });
  }, []);

  return (
    <FavoritesContext.Provider value={{ favoriteIds, isFavorite, toggleFavorite }}>
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
