import { useEffect, useMemo, useCallback, useState } from "react";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { readSteamOwnedCache } from "../../services/tauri";
import { deriveGameOwnershipBadgeState, type GameOwnershipBadgeState } from "./gameSearchOwnership";

function normalizeAppId(appId: string | number | null | undefined): string | undefined {
  if (appId == null) return undefined;
  const str = String(appId).trim();
  return str.length > 0 ? str : undefined;
}

export interface GameOwnershipLookupResult {
  ownedLoaded: boolean;
  ownedError: unknown;
  ownedAppIds: Set<string>;
  steamInstalledAppIds: Set<string>;
  luaActiveAppIds: Set<string>;

  isOwned: (appId: string | number | null | undefined) => boolean;
  isSteamInstalled: (appId: string | number | null | undefined) => boolean;
  isLuaActive: (appId: string | number | null | undefined) => boolean;

  getBadgeState: (appId: string | number | null | undefined) => GameOwnershipBadgeState;

  refreshOwned: () => Promise<void>;
}

export function useGameOwnershipLookup(): GameOwnershipLookupResult {
  const { games } = useLibraryGames();

  const [ownedLoaded, setOwnedLoaded] = useState(false);
  const [ownedError, setOwnedError] = useState<unknown>(null);
  const [ownedAppIds, setOwnedAppIds] = useState<Set<string>>(new Set());

  const refreshOwned = useCallback(async () => {
    try {
      const owned = await readSteamOwnedCache();
      setOwnedAppIds(new Set(owned.map((g) => String(g.appid))));
      setOwnedError(null);
      setOwnedLoaded(true);
    } catch (err) {
      setOwnedError(err);
      setOwnedLoaded(true);
    }
  }, []);

  useEffect(() => {
    refreshOwned();
  }, [refreshOwned]);

  const steamInstalledAppIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) {
      if (g.appId && g.steamInstalled) {
        set.add(g.appId);
      }
    }
    return set;
  }, [games]);

  const luaActiveAppIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) {
      if (g.appId && g.isLuaActive) {
        set.add(g.appId);
      }
    }
    return set;
  }, [games]);

  const isOwned = useCallback(
    (appId: string | number | null | undefined): boolean => {
      const key = normalizeAppId(appId);
      return key ? ownedAppIds.has(key) : false;
    },
    [ownedAppIds],
  );

  const isSteamInstalled = useCallback(
    (appId: string | number | null | undefined): boolean => {
      const key = normalizeAppId(appId);
      return key ? steamInstalledAppIds.has(key) : false;
    },
    [steamInstalledAppIds],
  );

  const isLuaActive = useCallback(
    (appId: string | number | null | undefined): boolean => {
      const key = normalizeAppId(appId);
      return key ? luaActiveAppIds.has(key) : false;
    },
    [luaActiveAppIds],
  );

  const getBadgeState = useCallback(
    (appId: string | number | null | undefined): GameOwnershipBadgeState => {
      const key = normalizeAppId(appId);
      if (!key) {
        return { owned: false, installed: false, luaActive: false, inLibrary: false, badges: [] };
      }
      return deriveGameOwnershipBadgeState(
        ownedAppIds.has(key),
        steamInstalledAppIds.has(key),
        luaActiveAppIds.has(key),
      );
    },
    [ownedAppIds, steamInstalledAppIds, luaActiveAppIds],
  );

  return useMemo(
    () => ({
      ownedLoaded,
      ownedError,
      ownedAppIds,
      steamInstalledAppIds,
      luaActiveAppIds,
      isOwned,
      isSteamInstalled,
      isLuaActive,
      getBadgeState,
      refreshOwned,
    }),
    [
      ownedLoaded,
      ownedError,
      ownedAppIds,
      steamInstalledAppIds,
      luaActiveAppIds,
      isOwned,
      isSteamInstalled,
      isLuaActive,
      getBadgeState,
      refreshOwned,
    ],
  );
}
