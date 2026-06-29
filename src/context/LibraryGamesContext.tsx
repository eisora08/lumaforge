import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { LibraryGame } from "../types/libraryGame";
import type { AppSettings } from "../types/settings";
import type { SteamAppMetadata } from "../types/gameMetadata";
import { resolveLibraryGames } from "../services/libraryGameResolver";
import { loadCachedGames, isCacheExpired } from "../services/gameDetectionCache";
import { loadMetadataCache } from "../services/gameMetadataResolver";
import { loadLibraryAppInfo, updateLibraryAppInfo } from "../services/libraryLocalCacheService";
import type { LibraryAppInfoMap } from "../services/tauri";
import {
  loadSteamStats,
  mergeSteamStatsIntoGames,
  mergeLocalStatsIntoGames,
  setAchievementsSupportedFlag,
} from "../services/gameStatsService";
import { useSettings } from "./SettingsContext";
import {
  waitForBootSnapshot,
} from "../services/appBootCoordinator";
import {
  seedResolvedMediaCacheFromSnapshot,
} from "../services/gameCacheService";
import {
  scheduleSnapshotWrite,
} from "../services/startupSnapshotService";
import {
  scheduleBackgroundValidation,
} from "../services/backgroundValidator";

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

function resolveCachedMetadata(appId?: string): SteamAppMetadata | undefined {
  if (!appId) return undefined;
  const cache = loadMetadataCache();
  return cache[appId] ?? undefined;
}

function mapCachedToLibraryGame(g: any): LibraryGame {
  const meta = resolveCachedMetadata(g.appId);
  return {
    id: g.id,
    appId: g.appId,
    title: g.title,
    source: g.source,
    executablePath: g.executablePath,
    installDir: g.installDir,
    libraryPath: g.libraryPath,
    imageUrl: g.imageUrl || (meta ? (meta.header_image || meta.capsule_image || meta.capsule_image_v5 || undefined) : undefined),
    metadata: meta,
    isPlayable: g.isPlayable,
    isInstallable: !g.isInstalled && !!g.appId,
    steamInstalled: g.isInstalled && g.source === "steam",
    sizeOnDisk: g.sizeOnDisk,
    lastUpdated: g.lastUpdated,
    luaScripts: [],
    hasLua: false,
    isLuaActive: false,
    isLuaDisabled: false,
    hasLuaSource: false,
    sources: [],
  };
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

    const cached = loadCachedGames();
    if (cached) {
      const loaded = cached.games.map(mapCachedToLibraryGame);
      setGames(loaded);
      setWarnings(cached.warnings || []);
      setInitialLoading(false);

      // Do NOT run enrichWithStats or updateAppInfoFromGames on initial load.
      // Stats load lazily per game; appinfo is already in the snapshot/canonical cache.
      if (isCacheExpired(cached)) {
        setLoading(true);
        setTimeout(async () => {
          try {
            const result = await resolveLibraryGames(settings);
            setGames(result.games);
            setWarnings(result.warnings);
          } catch (error) {
            console.error("[LibraryGamesContext] scan error:", error);
          } finally {
            setLoading(false);
          }
        }, 500);
      }
    } else {
      setLoading(true);
      setTimeout(async () => {
        try {
          const result = await resolveLibraryGames(settings);
          setGames(result.games);
          setWarnings(result.warnings);
        } catch (error) {
          console.error("[LibraryGamesContext] scan error:", error);
        } finally {
          setLoading(false);
          setInitialLoading(false);
        }
      }, 50);
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

  // Debounced snapshot write when games and appinfo are available
  useEffect(() => {
    if (games.length === 0) return;
    if (Object.keys(appInfoMap).length === 0) return;
    scheduleSnapshotWrite(games, appInfoMap, null);
  }, [games, appInfoMap]);

  // Background media validation after UI is shown
  useEffect(() => {
    if (games.length === 0) return;
    scheduleBackgroundValidation(games, appInfoMap);
  }, [games, appInfoMap]);

  async function refresh() {
    setLoading(true);
    try {
      const result = await resolveLibraryGames(settings);
      const enriched = await enrichWithStats(result.games);
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
