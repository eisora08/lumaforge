import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { LibraryGame } from "../types/libraryGame";
import type { AppSettings } from "../types/settings";
import type { SteamAppMetadata } from "../types/gameMetadata";
import { resolveLibraryGames } from "../services/libraryGameResolver";
import { loadCachedGames, isCacheExpired } from "../services/gameDetectionCache";
import { loadMetadataCache } from "../services/gameMetadataResolver";
import { useSettings } from "./SettingsContext";

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<LibraryGame | null>(null);
  const initDone = useRef(false);

  async function load(settings: AppSettings) {
    const cached = loadCachedGames();
    if (cached) {
      setGames(cached.games.map(mapCachedToLibraryGame));
      setWarnings(cached.warnings || []);
      setInitialLoading(false);
      if (isCacheExpired(cached)) {
        setLoading(true);
        try {
          const result = await resolveLibraryGames(settings);
          setGames(result.games);
          setWarnings(result.warnings);
        } catch (error) {
          console.error("[LibraryGamesContext] scan error:", error);
        } finally {
          setLoading(false);
        }
      }
    } else {
      setLoading(true);
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
    }
  }

  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    load(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const result = await resolveLibraryGames(settings);
      setGames(result.games);
      setWarnings(result.warnings);
    } catch (error) {
      console.error("[LibraryGamesContext] refresh error:", error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <LibraryGamesContext.Provider value={{ games, warnings, loading, initialLoading, selectedId, setSelectedId, selectedGame, setSelectedGame, refresh }}>
      {children}
    </LibraryGamesContext.Provider>
  );
}
