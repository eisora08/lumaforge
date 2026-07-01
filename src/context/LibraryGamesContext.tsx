import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { LibraryGame } from "../types/libraryGame";
import type { AppSettings } from "../types/settings";
import { resolveLibraryGames } from "../services/libraryGameResolver";
import { loadCachedGames, isCacheExpired, saveCachedGames } from "../services/gameDetectionCache";
import { loadLibraryAppInfo, updateLibraryAppInfo } from "../services/libraryLocalCacheService";
import type { LibraryAppInfoMap } from "../services/tauri";
import {
  loadSteamStats,
  mergeSteamStatsIntoGames,
  mergeLocalStatsIntoGames,
  setAchievementsSupportedFlag,
} from "../services/gameStatsService";
import { importExternalPlaytime } from "../services/playtimeService";
import { useSettings } from "./SettingsContext";
import {
  waitForBootSnapshot,
  scheduleAfterMain,
} from "../services/appBootCoordinator";
import {
  seedResolvedMediaCacheFromSnapshot,
} from "../services/gameCacheService";
import {
  scheduleSnapshotWrite,
} from "../services/startupSnapshotService";


const SELECTED_GAME_KEY = "lumaforge-selected-library-game-v1";

const OLD_CACHE_KEYS = [
  "lumaforge-steam-app-metadata-cache-v3",
  "lumaforge-steam-review-summary-cache",
  "lumaforge-steam-store-search-cache",
  "lumaforge-steam-store-search-cache-v1",
  "lumaforge-steam-store-search-cache-v2",
];

function cleanupOldCacheKeys() {
  for (const key of OLD_CACHE_KEYS) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
}

cleanupOldCacheKeys();

function loadStoredSelectedId(): string | null {
  try {
    return localStorage.getItem(SELECTED_GAME_KEY);
  } catch {
    return null;
  }
}

function storeSelectedId(id: string | null) {
  try {
    if (id) {
      localStorage.setItem(SELECTED_GAME_KEY, id);
    } else {
      localStorage.removeItem(SELECTED_GAME_KEY);
    }
  } catch { /* ignore */ }
}

type LibraryGamesState = {
  games: LibraryGame[];
  warnings: string[];
  loading: boolean;
  initialLoading: boolean;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  selectedGame: LibraryGame | null;
  setSelectedGame: (game: LibraryGame | null) => void;
  refresh: () => Promise<void>;
  appInfoMap: LibraryAppInfoMap;
};

const LibraryGamesContext = createContext<LibraryGamesState | null>(null);

export function useLibraryGames(): LibraryGamesState {
  const ctx = useContext(LibraryGamesContext);
  if (!ctx) {
    throw new Error("useLibraryGames must be used within LibraryGamesProvider");
  }
  return ctx;
}

export function LibraryGamesProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const [games, setGames] = useState<LibraryGame[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [selectedId, setSelectedIdState] = useState<string | null>(loadStoredSelectedId);
  const [selectedGame, setSelectedGameState] = useState<LibraryGame | null>(null);
  const [appInfoMap, setAppInfoMap] = useState<LibraryAppInfoMap>({});
  const appInfoLoaded = useRef(false);
  const initDone = useRef(false);

  function setSelectedId(id: string | null) {
    setSelectedIdState(id);
    storeSelectedId(id);
  }

  function setSelectedGame(game: LibraryGame | null) {
    setSelectedGameState(game);
    setSelectedIdState(game?.id ?? null);
    storeSelectedId(game?.id ?? null);
  }

  useEffect(() => {
    if (games.length === 0 || !selectedId) return;
    const match = games.find((g) => g.id === selectedId);
    if (match) {
      if (selectedGame !== match) {
        setSelectedGameState(match);
      }
    } else {
      setSelectedIdState(null);
      storeSelectedId(null);
    }
  }, [games, selectedId, selectedGame]);

  async function enrichWithStats(games: LibraryGame[]): Promise<LibraryGame[]> {
    try {
      const appIds = games
        .map((g) => Number(g.appId))
        .filter((id): id is number => Number.isFinite(id));
      if (appIds.length > 0) {
        const steamStats = await loadSteamStats(
          settings.steamRoot || undefined,
          appIds,
        );
        mergeSteamStatsIntoGames(games, steamStats);

        // Batch-import Steam playtime — 10 per batch with delay to avoid burst
        const playtimeGames = games.filter((g) => {
          if (!g.appId) return false;
          const appIdNum = Number(g.appId);
          if (!Number.isFinite(appIdNum)) return false;
          const stat = steamStats.get(appIdNum);
          return stat?.playtimeMinutes != null && stat.playtimeMinutes > 0;
        });

        const BATCH_SIZE = 10;
        const BATCH_DELAY_MS = 200;
        for (let i = 0; i < playtimeGames.length; i += BATCH_SIZE) {
          const batch = playtimeGames.slice(i, i + BATCH_SIZE);
          await Promise.allSettled(
            batch.map((game) => {
              const gameKey = game.id || `app-${game.appId}`;
              return importExternalPlaytime({
                gameKey,
                appId: game.appId!,
                provider: "steam",
                title: game.title,
                externalPlaytimeSeconds: steamStats.get(Number(game.appId))!.playtimeMinutes! * 60,
                externalSource: "steam",
              });
            })
          );
          if (i + BATCH_SIZE < playtimeGames.length) {
            await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
          }
        }
      }
    } catch {
      // stats are non-critical
    }
    mergeLocalStatsIntoGames(games);
    setAchievementsSupportedFlag(games);
    return games;
  }

  async function updateAppInfoFromGames(games: LibraryGame[]) {
    const now = Math.floor(Date.now() / 1000);
    for (const game of games) {
      if (!game.appId) continue;
      const entry = appInfoMap[game.appId];
      // Only write if entry is missing or actually different
      if (entry && entry.name === game.title && entry.header_image === (game.imageUrl || null) && entry.updated_at && (now - entry.updated_at) < 86400) continue;
      await updateLibraryAppInfo(game.appId, {
        app_id: game.appId,
        name: game.title || null,
        header_image: game.imageUrl || null,
        cover_path: null,
        grid_path: null,
        hero_path: null,
        logo_path: null,
        icon_path: null,
        updated_at: now,
      }).catch(() => {});
    }
  }

  async function load(settings: AppSettings) {
    // Seed media session cache from snapshot if available
    const snapshot = await waitForBootSnapshot();
    if (snapshot) {
      seedResolvedMediaCacheFromSnapshot(snapshot.library.games);
    }

    // Load enriched games from SQLite cache (instant — no blocking)
    const cached = await loadCachedGames();
    if (cached && cached.games.length > 0) {
      setGames(cached.games);
      setWarnings(cached.warnings || []);
      setInitialLoading(false);
    } else {
      setInitialLoading(false);
    }

    // Schedule background Steam scan after main window is visible.
    // This is non-blocking — cached games show immediately with correct stats.
    const needsScan = !cached || isCacheExpired(cached);
    if (needsScan) {
      scheduleAfterMain(async () => {
        setLoading(true);
        try {
          const result = await resolveLibraryGames(settings);
          const enriched = await enrichWithStats(result.games);
          await saveCachedGames(enriched, result.warnings);
          setGames(enriched);
          setWarnings(result.warnings);
        } catch (error) {
          console.error("[LibraryGamesContext] scan error:", error);
        } finally {
          setLoading(false);
        }
      }, 3000);
    }
  }

  useEffect(() => {
    if (appInfoLoaded.current) return;
    appInfoLoaded.current = true;
    loadLibraryAppInfo().then(setAppInfoMap).catch(() => {});
  }, []);

  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    setTimeout(() => load(settings), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced snapshot write — deferred to 60s idle so boot remains zero-work
  useEffect(() => {
    if (games.length === 0) return;
    if (Object.keys(appInfoMap).length === 0) return;
    scheduleSnapshotWrite(games, appInfoMap, null, 60000);
  }, [games, appInfoMap]);

  async function refresh() {
    setLoading(true);
    try {
      const result = await resolveLibraryGames(settings);
      const enriched = await enrichWithStats(result.games);
      await saveCachedGames(enriched, result.warnings);
      setGames(enriched);
      setWarnings(result.warnings);
      await updateAppInfoFromGames(enriched).catch(() => {});
      // Snapshot write picked up by the debounced effect on games/appInfoMap change
    } catch (error) {
      console.error("[LibraryGamesContext] refresh error:", error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <LibraryGamesContext.Provider value={{ games, warnings, loading, initialLoading, selectedId, setSelectedId, selectedGame, setSelectedGame, refresh, appInfoMap }}>
      {children}
    </LibraryGamesContext.Provider>
  );
}
