import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { LibraryGame } from "../types/libraryGame";
import type { AppSettings } from "../types/settings";
import { resolveLibraryGames } from "../services/libraryGameResolver";
import { loadCachedGames, isCacheExpired, saveCachedGames } from "../services/gameDetectionCache";
import { loadLibraryAppInfo, updateLibraryAppInfo } from "../services/libraryLocalCacheService";
import type { LibraryAppInfoEntry, LibraryAppInfoMap } from "../services/tauri";
import {
  loadSteamStats,
  mergeSteamStatsIntoGames,
  mergeLocalStatsIntoGames,
  setAchievementsSupportedFlag,
} from "../services/gameStatsService";
import { importExternalPlaytime, getPlaytimeEntryByAppId, getPlaytimeEntryByGameKey, resolvePlaytimeKey } from "../services/playtimeService";
import { useSettings } from "./SettingsContext";
import {
  waitForBootSnapshot,
  scheduleAfterMain,
} from "../services/appBootCoordinator";
import {
  seedResolvedMediaCacheFromSnapshot,
  dedupeLibraryGames,
  reconcileManualFavoriteKeys,
} from "../services/gameCacheService";
import {
  scheduleSnapshotWrite,
} from "../services/startupSnapshotService";
import type { SnapshotGame } from "../services/startupSnapshotService";
import { isStandalone as isStandaloneById } from "../services/standaloneStore";
import {
  refreshSingleGameSteamStatus,
} from "../services/providerStatusReconciliation";
import { installTrackerService } from "../services/installTrackingService";
import { setInstalledAppIds } from "../services/providerStatusStore";
import {
  reportLibraryProgress,
} from "../services/libraryProgressService";
import type { LibraryLoadSource } from "../services/libraryProgressService";
import {
  countLibraryApplied,
  countLibrarySkipped,
  countLibraryReconciledDiff,
  countLibraryEmptyBlocked,
} from "../services/perfCounters";
import { loadManualGames, subscribeManualGames } from "../services/manualGameStore";
import { manualGameToLibraryGame } from "../services/manualGameLibraryMapper";
import { EPIC_LIBRARY_ENABLED, DEBUG_EPIC_LIBRARY } from "../services/epicFeatureFlag";
import { DEBRID_LIBRARY_ENABLED, DEBUG_DEBRID_LIBRARY } from "../features/debrid/debridFeatureFlag";
import { isIntegrationEnabled, isIntegrationScanOnStartup } from "../services/integrationSettingsService";
import { filterEnabledGames } from "../services/providerSurfaceFilter";
import {
  getAllEpicGames,
  subscribeEpicGames,
  refreshEpicGames,
  initOverrideSubscription,
} from "../services/epicGameStore";
import {
  getAllDebridGames,
  isDebridGameInLibrary,
  subscribeDebridGames,
  refreshDebridGames,
} from "../services/debridGameStore";
import { subscribeDataChanges } from "../services/dataChangeBus";

// â”€â”€ Library runtime state machine â”€â”€

export type LibraryRuntimeStatus =
  | "empty"
  | "snapshot"
  | "reconciling"
  | "ready"
  | "error";

export type LibrarySource =
  | "none"
  | "snapshot"
  | "cached"
  | "reconciled"
  | "manual-refresh";

// Stable fingerprint based on fields that matter to Library/Sidebar rendering
function computeLibraryFingerprint(games: LibraryGame[]): string {
  return games.slice(0, 200).map(g => {
    // Use provider-neutral identity key to avoid undefined: prefix for Epic/GOG entries
    const identityKey = g.appId || g.libraryId || g.id;
    return `${identityKey}:${g.title ?? ""}:${g.source}:${!!g.steamInstalled}:${!!g.isInstalled}:${!!g.isPlayable}:${!!g.isFavorite}:${!!g.hasLua}:${!!g.isLuaActive}:${(() => { try { return g.executablePath ?? g.installDir ?? g.libraryPath ?? ""; } catch { return ""; } })()}:${g.steamLastPlayedAt ?? ""}:${g.steamPlaytimeMinutes ?? ""}:${g.achievementTotal ?? ""}:${g.imageUrl ?? ""}`;
  }).join("|");
}

// Module-level fingerprint to skip scheduling full-rebuild snapshots when games haven't changed
let _lastGamesFingerprint = "";
function computeGamesFingerprint(games: LibraryGame[]): string {
  return games.slice(0, 200).map(g => {
    const identityKey = g.appId || g.libraryId || g.id;
    return `${identityKey}:${!!g.steamInstalled}:${!!g.isPlayable}:${!!g.isFavorite}:${g.steamLastPlayedAt ?? ""}:${g.steamPlaytimeMinutes ?? ""}:${g.achievementTotal ?? ""}`;
  }).join("|");
}

// One-shot boot diagnostic: report Debrid entries in `games` with their
// install state so a missing sidebar can be explained (see stable-object reuse).
let _debridSidebarDiagnosticLogged = false;
function logDebridSidebarDiagnostic(games: LibraryGame[]) {
  if (_debridSidebarDiagnosticLogged) return;
  const debrid = games.filter(g => g.source === "debrid");
  if (debrid.length === 0) {
    console.log("[DEBRID][SIDEBAR_DIAG] no debrid entries in games");
    _debridSidebarDiagnosticLogged = true;
    return;
  }
  console.log(
    `[DEBRID][SIDEBAR_DIAG] debrid=${debrid.length} installed=${debrid.filter(g => g.isInstalled === true).length} ` +
    `withInstallDir=${debrid.filter(g => !!g.installDir).length} ` +
    `entries=${debrid.map(g => `${g.id ?? g.appId}:inst=${g.isInstalled === true}:dir=${!!g.installDir}`).join("|")}`
  );
  _debridSidebarDiagnosticLogged = true;
}

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

// â”€â”€ Manual game helpers â”€â”€

const DEBUG_MANUAL_COVER = false;
const DEBUG_MANUAL_REMOVE = false;

function getManualLibraryGames(): LibraryGame[] {
  try {
    const games = loadManualGames().map(manualGameToLibraryGame);
    return games;
  } catch {
    return [];
  }
}

// â”€â”€ Epic game helpers â”€â”€

/** Sync read from the in-memory Epic store. Returns [] when feature is disabled. */
function getEpicLibraryGames(): LibraryGame[] {
  if (!EPIC_LIBRARY_ENABLED) return [];
  try {
    return getAllEpicGames();
  } catch {
    return [];
  }
}

/** Sync read from the in-memory Debrid store. Returns [] when feature is disabled.
 *  Returns games that the user has added to their library (downloaded + extracted,
 *  including needs-setup, not just fully-ready). */
function getDebridLibraryGames(): LibraryGame[] {
  if (!DEBRID_LIBRARY_ENABLED) return [];
  try {
    const all = getAllDebridGames();
    return all.filter((g) => {
      return isDebridGameInLibrary(g.providerGameId!);
    });
  } catch {
    return [];
  }
}

/** Self-heal the legacy appinfo index for Debrid games: a Debrid repack may
 *  carry a verbose catalog title (e.g. "Rail Route: Supporter Bundle v3.0.13
 *  + 4 DLCs/Bonuses") while the live context title is the clean canonical name
 *  ("Rail Route"). The sidebar title prefers the live `game.title` now, but
 *  this keeps `library/appinfo.json` in sync so the stale name is also healed
 *  on disk for any other consumer (and across restarts).
 *  Returns the map of entries that actually changed (to refresh React state). */
async function syncDebridTitlesToLegacyIndex(
  debridGames: LibraryGame[],
  currentMap: LibraryAppInfoMap,
): Promise<Record<string, LibraryAppInfoEntry>> {
  const changed: Record<string, LibraryAppInfoEntry> = {};
  for (const g of debridGames) {
    const appId = g.appId;
    const title = g.title;
    if (!appId || !title || title.startsWith("Steam App ")) continue;
    const existing = currentMap[appId];
    if (existing?.name === title) continue;
    const entry: LibraryAppInfoEntry = {
      app_id: appId,
      name: title,
      header_image: existing?.header_image ?? null,
      cover_path: existing?.cover_path ?? null,
      grid_path: existing?.grid_path ?? null,
      hero_path: existing?.hero_path ?? null,
      logo_path: existing?.logo_path ?? null,
      icon_path: existing?.icon_path ?? null,
      updated_at: Date.now(),
    };
    try {
      await updateLibraryAppInfo(appId, entry);
    } catch (err) {
      console.warn(`[LIBRARY_CONTEXT][DEBRID_TITLE_SYNC_FAIL] appid=${appId}`, err);
      continue;
    }
    changed[appId] = entry;
    console.log(`[LIBRARY_CONTEXT][DEBRID_TITLE_SYNC] appid=${appId} name="${title}"`);
  }
  return changed;
}

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
  refresh: (options?: { force?: boolean }) => Promise<void>;
  updateGame: (appId: string, updates: Partial<LibraryGame>) => void;
  checkGameProviderStatus: (appId: string, force?: boolean) => Promise<{ steamInstalled: boolean } | null>;
  appInfoMap: LibraryAppInfoMap;
  status: LibraryRuntimeStatus;
  librarySource: LibrarySource;
  libraryFingerprint: string | null;
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
  const [status, setStatus] = useState<LibraryRuntimeStatus>("empty");
  const [librarySource, setLibrarySource] = useState<LibrarySource>("none");
  const [libraryFingerprint, setLibraryFingerprintState] = useState<string | null>(null);
  const appInfoLoaded = useRef(false);
  const gamesRef = useRef<LibraryGame[]>([]);
  const _snapshotMediaUnsubRef = useRef<(() => void) | null>(null);
  const appInfoMapRef = useRef(appInfoMap);
  useEffect(() => { appInfoMapRef.current = appInfoMap; }, [appInfoMap]);
  const lastSettingsKey = useRef<string>("");
  const bootLoaded = useRef(false);
  const lastLogStatus = useRef<string>("");
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    gamesRef.current = games;
  }, [games]);


  // Sync installed appIds to providerStatusStore so update badges/counts
  // only appear for actually installed games (not orphaned Lua files).
  useEffect(() => {
    const installed = new Set<string>();
    for (const g of games) {
      if (g.appId && (g.steamInstalled || g.isInstalled)) {
        installed.add(g.appId);
      }
    }
    setInstalledAppIds(installed);
  }, [games]);

  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id);
    storeSelectedId(id);
  }, []);

  const setSelectedGame = useCallback((game: LibraryGame | null) => {
    if ((window as any).__DEBUG_META_TRACE) console.log(`[META_TRACE][CTX_SET] id=${game?.id} appId=${game?.appId} src=${game?.source} hasMeta=${!!game?.metadata}`);
    setSelectedGameState(game);
    setSelectedIdState(game?.id ?? null);
    storeSelectedId(game?.id ?? null);
  }, []);

  useEffect(() => {
    if (games.length === 0 || !selectedId) return;
    const match = games.find((g) => g.id === selectedId);
    if (match) {
      if (selectedGame !== match) {
        if ((window as any).__DEBUG_META_TRACE) console.log(`[META_TRACE][CTX_SYNC] selectedId=${selectedId} replacing selectedGame (old hasMeta=${!!selectedGame?.metadata} new hasMeta=${!!match?.metadata} sameRef=${selectedGame === match})`);
        setSelectedGameState(match);
      }
    } else {
      if ((window as any).__DEBUG_META_TRACE) console.log(`[META_TRACE][CTX_SYNC] selectedId=${selectedId} NOT FOUND in games, clearing`);
      setSelectedIdState(null);
      storeSelectedId(null);
    }
  }, [games, selectedId, selectedGame]);

  // Track whether we already have valid snapshot/reconciled games to skip fingerprint on first apply
  const hasInitialData = useRef(false);

  function logLibraryState(newStatus: LibraryRuntimeStatus, newSource: LibrarySource, gameCount: number): void {
    const key = `${newStatus}:${newSource}:${gameCount}`;
    if (key !== lastLogStatus.current) {
      lastLogStatus.current = key;
      console.log(`[LIBRARY_STATE] status=${newStatus} source=${newSource} games=${gameCount}`);
    }
  }

  function applyGamesSafely(
    nextGames: LibraryGame[],
    source: string,
    options?: { allowReplace?: boolean },
  ): void {
    const current = gamesRef.current;
    // Append manual games from manualGameStore, Epic games from epicGameStore,
    // and Debrid games from debridGameStore so they appear in the Library grid.
    // All three are never written to BootSnapshot, gameStore, SQLite, or appinfo.
    // dedupeLibraryGames now uses composite key "appId:source", so entries from
    // different providers with the same appId coexist as separate Library rows.
    // Manual games with an appId that already exists in the main list are duplicates — skip them
    const existingAppIds = new Set(nextGames.map(g => g.appId).filter(Boolean));
    const freshManual = getManualLibraryGames().filter(m => !m.appId || !existingAppIds.has(m.appId));
    const withManual = [...nextGames, ...freshManual, ...getEpicLibraryGames(), ...getDebridLibraryGames()];
    // Phase 2: Block empty replacement of valid data unless explicit
    if (withManual.length === 0 && current.length > 0 && !options?.allowReplace) {
      countLibraryEmptyBlocked();
      console.log(`[LIBRARY_CONTEXT][APPLY_GAMES_BLOCKED] reason=empty source=${source} current=${current.length}`);
      return;
    }
    // Phase 4: Block partial background scans
    if (
      source === "background-scan" &&
      withManual.length > 0 &&
      current.length > 0 &&
      withManual.length < current.length * 0.5
    ) {
      console.log(`[LIBRARY_CONTEXT][APPLY_GAMES_BLOCKED] reason=partial source=${source} current=${current.length} incoming=${withManual.length}`);
      return;
    }
    // Phase 4+8: Compute fingerprint of incoming games and skip if same as current
    // Manual-update always applies â€” user explicitly changed media/state in the dialog
    const incomingFp = computeLibraryFingerprint(withManual);
    const currentFp = current.length > 0 ? computeLibraryFingerprint(current) : null;
    if (currentFp !== null && incomingFp === currentFp && source !== "manual-update") {
      countLibrarySkipped();
      console.log(`[LIBRARY_CONTEXT][APPLY_GAMES_SKIP] reason=same-fingerprint source=${source} games=${current.length}`);
      // Still set status if not yet at "ready" (e.g., reconcile producing same data as snapshot)
      if (status !== "ready" && source === "cached") {
        setStatus("reconciling");
        setLibrarySource(source as LibrarySource);
        logLibraryState("reconciling", source as LibrarySource, current.length);
      }
      if (status !== "ready" && source === "reconciled-update") {
        setStatus("ready");
        setLibrarySource("reconciled");
        logLibraryState("ready", "reconciled", current.length);
      }
      return;
    }
    if (DEBUG_MANUAL_COVER && source === "manual-update") console.log(`[MANUAL_COVER][LIBRARY_MANUAL_UPDATE] fingerprintAfter=${incomingFp.substring(0, 80)}... skipped=false`);
    // Phase 9: Preserve object identity â€” reuse existing objects when appId/title/source match
    const currentById = new Map<string, LibraryGame>();
    for (const g of current) {
      if (g.appId) currentById.set(g.appId, g);
    }
    const merged = mergeGames(current, withManual, source);
    const deduped = dedupeLibraryGames(merged);
    if (DEBUG_MANUAL_REMOVE && source === "manual-update") {
      const prevManualCount = current.filter((g) => g.source === "manual").length;
      const freshManualCount = deduped.filter((g) => g.source === "manual").length;
      console.log(`[MANUAL_REMOVE][APPLY] prev=${current.length}(${prevManualCount} manual) â†’ merged=${deduped.length}(${freshManualCount} manual) fpChanged=${currentFp !== incomingFp}`);
    }

    // Phase 6: Merge Activity playtime into LibraryGame runtime objects
    for (const game of deduped) {
      // Use provider-aware resolvePlaytimeKey FIRST (handles debrid/manual/epic keys),
      // then fall back to appId-based lookup for Steam games
      const ptEntry = getPlaytimeEntryByGameKey(resolvePlaytimeKey(game))
        ?? (game.appId ? getPlaytimeEntryByAppId(game.appId) : null);
      if (ptEntry) {
        const totalMinutes = Math.round(ptEntry.totalPlaytimeSeconds / 60);
        if (totalMinutes > 0) {
          game.localPlaytimeMinutes = Math.max(game.localPlaytimeMinutes ?? 0, totalMinutes);
        }
        const sessionEnd = ptEntry.lastPlayedAt
          || (ptEntry.sessions.length > 0
            ? Math.max(...ptEntry.sessions.map(s => s.endedAt ?? s.startedAt))
            : null);
        if (sessionEnd) {
          // playtime store stores Unix SECONDS; localLastPlayedAt consumers expect MILLISECONDS
          game.localLastPlayedAt = Math.max(game.localLastPlayedAt ?? 0, sessionEnd * 1000);
        }
      }
    }

    // Reuse existing objects for unchanged games to minimize React re-render churn
    const stable: LibraryGame[] = [];
    let changedCount = 0;
    let addedCount = 0;
    for (const game of deduped) {
      if (game.appId && currentById.has(game.appId)) {
        const existing = currentById.get(game.appId)!;
        if (
          existing.title === game.title &&
          existing.source === game.source &&
          existing.steamInstalled === game.steamInstalled &&
          !!existing.isInstalled === !!game.isInstalled &&
          existing.installDir === game.installDir &&
          !!existing.isPlayable === !!game.isPlayable &&
          !!existing.isFavorite === !!game.isFavorite &&
          !!existing.isStandalone === !!game.isStandalone &&
          !!existing.hasLua === !!game.hasLua &&
          existing.luaScripts.length === game.luaScripts.length
        ) {
          stable.push(existing);
        } else {
          stable.push(game);
          changedCount++;
        }
      } else {
        stable.push(game);
        if (game.appId && !currentById.has(game.appId)) addedCount++;
      }
    }
    const removedCount = current.length - stable.length + addedCount;
    if (current.length > 0 && (addedCount > 0 || removedCount > 0 || changedCount > 0)) {
      countLibraryReconciledDiff();
      console.log(`[LIBRARY_CONTEXT][APPLY_GAMES_DIFF] source=${source} added=${addedCount} removed=${removedCount} changed=${changedCount} total=${stable.length}`);
    } else {
      console.log(`[LIBRARY_CONTEXT][APPLY_GAMES] source=${source} previous=${current.length} incoming=${withManual.length} merged=${merged.length} deduped=${deduped.length}`);
    }
    countLibraryApplied();
    const filtered = filterEnabledGames(stable);
    logDebridSidebarDiagnostic(filtered);
    const filteredFp = computeLibraryFingerprint(filtered);
    if (filteredFp !== (currentFp ?? computeLibraryFingerprint(gamesRef.current))) {
      setGames(filtered);
    } else {
      console.log(`[LIBRARY_CONTEXT][APPLY_GAMES_SKIP] reason=unchanged-filtered source=${source}`);
    }
    hasInitialData.current = true;

    // Phase 1: Update runtime status based on source
    if (source === "snapshot-fallback" || source === "snapshot") {
      setStatus("snapshot");
      setLibrarySource("snapshot");
      setLibraryFingerprintState(incomingFp);
      logLibraryState("snapshot", "snapshot", stable.length);
    } else if (source === "cached") {
      setStatus("reconciling");
      setLibrarySource("cached");
      setLibraryFingerprintState(incomingFp);
      logLibraryState("reconciling", "cached", stable.length);
    } else if (source === "reconciled-update" || source === "reconciled-fallback") {
      setStatus("ready");
      setLibrarySource("reconciled");
      setLibraryFingerprintState(incomingFp);
      logLibraryState("ready", "reconciled", stable.length);
    } else {
      setStatus("ready");
      setLibrarySource(source as LibrarySource);
      setLibraryFingerprintState(incomingFp);
      logLibraryState("ready", source as LibrarySource, stable.length);
    }
  }

  function mergeGames(current: LibraryGame[], incoming: LibraryGame[], source: string): LibraryGame[] {
    if (current.length === 0) return incoming;
    if (
      source === "cached" ||
      source === "reconciled-update" ||
      source === "snapshot-fallback" ||
      source === "reconciled-fallback"
    ) {
      const byAppId = new Map<string, LibraryGame>();
      for (const g of current) {
        if (g.appId) {
          byAppId.set(g.appId, g);
        }
        // Manual games (no appId) are NOT copied from current into byAppId.
        // They are always sourced from incoming â†’ getManualLibraryGames() (line 222),
        // which reads the latest manualGameStore. This prevents a removed manual
        // game from surviving the merge via a stale gamesRef.current.
      }
      for (const game of incoming) {
        if (game.appId) {
          const existing = byAppId.get(game.appId);
          if (existing) {
            // Game already present â€” propagate Lua state changes from incoming scan.
            // Skip for reconciled sources (reconciled-update/reconciled-fallback) because
            // SQLite doesn't track Lua state â€” incoming would have hasLua=false, luaScripts=[]
            // which would incorrectly clear valid Lua state from the in-memory games.
            const isReconciledSource = source === "reconciled-update" || source === "reconciled-fallback";
            if (!isReconciledSource && (existing.hasLua !== game.hasLua || existing.luaScripts.length !== game.luaScripts.length)) {
              console.log(`[LIBRARY][MERGE_LUA_DIFF] appid=${game.appId} source=${source} oldHasLua=${existing.hasLua} oldScripts=${existing.luaScripts.length} newHasLua=${game.hasLua} newScripts=${game.luaScripts.length}`);
              existing.luaScripts = game.luaScripts;
              existing.hasLua = game.hasLua;
              existing.isLuaActive = game.isLuaActive;
              existing.isLuaDisabled = game.isLuaDisabled;
              existing.hasLuaSource = game.hasLuaSource;
              // If game was Lua-only and lost its last script, remove it
              if (!game.hasLua && game.luaScripts.length === 0 && existing.source === "lua" && !existing.steamInstalled) {
                // Don't add to byAppId â€” game is effectively removed
                continue;
              }
            }
            // Propagate standalone flag from incoming — incoming reads from
            // standaloneStore (localStorage), existing may be from the detection
            // cache which doesn't persist this field.
            if (game.isStandalone && !existing.isStandalone) existing.isStandalone = true;
          } else {
            // New game not in current list
            byAppId.set(game.appId, game);
          }
        } else {
          // Manual (no appId): always replace with fresh version from store.
          // The store is the source of truth for manual game media/title/fields.
          const existingKey = [...byAppId.entries()].find(([, v]) => v.id === game.id)?.[0];
          if (existingKey) {
            byAppId.set(existingKey, game);
          } else {
            byAppId.set(`noappid-${game.id}`, game);
          }
        }
      }
      return [...byAppId.values()].sort((a, b) => a.title.localeCompare(b.title));
    }
    const deduped = dedupeLibraryGames(incoming);
    // Phase 10: Prevent owned merge from downgrading installed state
    const currentByAppId = new Map<string, LibraryGame>();
    for (const g of current) {
      if (g.appId && g.steamInstalled) currentByAppId.set(g.appId, g);
    }
    if (currentByAppId.size > 0) {
      for (const game of deduped) {
        if (game.appId && currentByAppId.has(game.appId) && !game.steamInstalled) {
          console.log(`[INSTALL_STATE] appid=${game.appId} downgradeBlocked oldInstalled=true incomingOwnedOnly=true`);
          game.steamInstalled = true;
          game.isInstallable = false;
        }
      }
    }
    // Phase 10.5: Preserve standalone flag from current games
    const currentMap = new Map<string, LibraryGame>();
    for (const g of current) {
      if (g.appId) currentMap.set(g.appId, g);
    }
    for (const game of deduped) {
      if (game.appId) {
        const existing = currentMap.get(game.appId);
        if (existing?.isStandalone) game.isStandalone = true;
        // Preserve user-set executable path — SQLite/scan never populates this
        if (existing?.executablePath && !game.executablePath) game.executablePath = existing.executablePath;
        if (existing?.installDir && !game.installDir) game.installDir = existing.installDir;
      }
    }
    return deduped;
  }

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
              // Always use app-{appId} as the playtime store key — matches what
              // snapshotToDisplayGame / getPlaytimeEntryByGameKey reads via resolvePlaytimeKey
              const gameKey = `app-${game.appId}`;
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
      const gameName = game.title && !game.title.startsWith("Steam App ") ? game.title : null;
      if (entry && entry.name === gameName && entry.header_image === (game.imageUrl || null) && entry.updated_at && (now - entry.updated_at) < 86400) continue;
      await updateLibraryAppInfo(game.appId, {
        app_id: game.appId,
        name: gameName,
        header_image: game.imageUrl || null,
        cover_path: entry?.cover_path ?? null,
        grid_path: entry?.grid_path ?? null,
        hero_path: entry?.hero_path ?? null,
        logo_path: entry?.logo_path ?? null,
        icon_path: entry?.icon_path ?? null,
        updated_at: now,
      }).catch((err) => console.warn(err));
      console.log(`[LIBRARY_CONTEXT][APPINFO_UPDATE_SAFE] appid=${game.appId} preserveMedia=true`);
    }
  }

  function snapshotGameToLibraryGame(sg: SnapshotGame): LibraryGame {
    const resolvedSource: LibraryGame["source"] =
      sg.source === "lua" ? "lua" :
      sg.source === "epic" ? "epic" :
      sg.source === "gog" ? "gog" :
      "steam";
    return {
      id: sg.appId,
      appId: (resolvedSource === "steam" || resolvedSource === "lua") ? sg.appId : undefined,
      title: sg.title || "",
      source: resolvedSource,
      isPlayable: sg.playable ?? false,
      isInstallable: !sg.playable,
      isInstalled: sg.installed ?? false,
      steamInstalled: sg.installed ?? false,
      isStandalone: isStandaloneById(sg.appId),
      hasLua: sg.source === "lua",
      isLuaActive: sg.source === "lua",
      isLuaDisabled: false,
      hasLuaSource: false,
      luaScripts: [],
      sources: [],
      // sg.lastPlayed is in SECONDS (snapshot builder); steamLastPlayedAt on LibraryGame is MS
      steamLastPlayedAt: sg.lastPlayed != null && sg.lastPlayed > 0 ? sg.lastPlayed * 1000 : undefined,
      steamPlaytimeMinutes: sg.playtime ?? undefined,
      achievementUnlocked: sg.achievementSummary?.unlocked,
      achievementTotal: sg.achievementSummary?.total,
      completionStatus: sg.completionStatus ?? undefined,
      backgroundPath: sg.media?.backgroundPath ?? undefined,
      landscapePath: sg.media?.landscapePath ?? undefined,
      coverPath: sg.media?.coverPath ?? undefined,
      logoPath: sg.media?.logoPath ?? undefined,
      iconPath: sg.media?.iconPath ?? undefined,
      installDir: sg.installPath ?? undefined,
      executablePath: sg.installPath ?? undefined,
    };
  }

  async function load(settings: AppSettings) {
    try {
      const snapshot = await waitForBootSnapshot();
      if (snapshot) {
        reportLibraryProgress({ phase: "hydrating-snapshot", source: "snapshot" });
        seedResolvedMediaCacheFromSnapshot(snapshot.library.games);
      }

      reportLibraryProgress({ phase: "reading-sqlite", source: "sqlite" });
      const cached = await loadCachedGames();
      const { getReconciledGames } = await import("../services/gameStore");
      let loadedGames: LibraryGame[] | null = null;
      let loadSource = "";

      if (cached && cached.games.length > 0) {
        loadedGames = cached.games;
        loadSource = "cached";

        const reconciled = getReconciledGames();
        if (reconciled.length > 0) {
          const reconciledById = new Map(reconciled.map((g) => [g.id, g]));
          const existingIds = new Set(loadedGames.map((g) => g.id));
          // appId-aware dedup: cached and reconciled may use different id prefixes
          // for the same game (lua-<appId> vs steam-<appId>). Skip a reconciled
          // entry whose appId already exists under any id so one row per appId is
          // guaranteed (matches mergeGames + console stableId dedup).
          const existingAppIds = new Set(
            loadedGames.map((g) => g.appId).filter((id): id is string => Boolean(id))
          );
          const cachedIdByAppId = new Map<string, string>();
          for (const g of loadedGames) {
            if (g.appId && !cachedIdByAppId.has(g.appId)) cachedIdByAppId.set(g.appId, g.id);
          }
          const added: LibraryGame[] = [];
          for (const [id, game] of reconciledById) {
            if (existingIds.has(id)) continue;
            if (game.appId && existingAppIds.has(game.appId)) {
              console.log(`[LIBRARY_CONTEXT][RECONCILE_SKIP] appid=${game.appId} existingId=${cachedIdByAppId.get(game.appId) ?? "unknown"} reconciledId=${id}`);
              continue;
            }
            added.push(game);
          }
          if (added.length > 0) {
            loadedGames = [...loadedGames, ...added].sort((a, b) =>
              a.title.localeCompare(b.title)
            );
            console.debug(`[GAME_STORE] gamesUpdated count=${loadedGames.length} source=config-lua-reconcile added=${added.length}`);
          }
        }

        // Hydrate isStandalone from localStorage — the SQLite cache serializes
        // LibraryGame objects without this runtime-only flag, so cached/reconciled
        // games lose standalone status across restarts until the next background
        // scan rebuilds via isStandaloneById().
        for (const game of loadedGames) {
          if (game.appId && isStandaloneById(game.appId)) {
            game.isStandalone = true;
          }
        }

        // Repair placeholder titles in cached games
        const { resolveCanonicalName } = await import("../services/gameCacheService");
        await Promise.allSettled(loadedGames.map(async (game) => {
          if (!game.appId) return;
          if (!game.title || game.title.startsWith("Steam App ")) {
            const realName = await resolveCanonicalName(game.appId);
            if (realName) {
              console.log(`[NAME][CACHE_REPAIR] appid=${game.appId} old=${game.title} new=${realName} source=canonical`);
              game.title = realName;
            }
          }
        }));
      } else {
        const reconciled = getReconciledGames();
        if (reconciled.length > 0) {
          loadedGames = reconciled;
          loadSource = "reconciled-fallback";
          console.log(`[LIBRARY_CONTEXT][HYDRATE] source=reconciled-fallback games=${reconciled.length}`);
        } else if (snapshot && snapshot.library.games.length > 0) {
          loadedGames = snapshot.library.games.map(snapshotGameToLibraryGame);
          loadSource = "snapshot-fallback";
          console.log(`[LIBRARY_CONTEXT][HYDRATE] source=snapshot-fallback games=${loadedGames.length}`);
        } else {
          console.log(`[LIBRARY_CONTEXT][HYDRATE] source=empty (sqlite empty, reconciled empty, snapshot empty)`);
          loadSource = "empty";
        }
      }

      if (loadedGames) {
        // Bridge snapshot media into loaded games so the hero/dashboard get a stable
        // frame-1 image path for Steam/Lua games even when they come from SQLite/reconciled
        // (those sources don't populate backgroundPath/landscapePath/coverPath).
        if (snapshot && snapshot.library.games.length > 0) {
          const snapshotMediaByAppId = new Map<string, SnapshotGame["media"]>();
          const snapshotCompletionByAppId = new Map<string, string | null>();
          for (const sg of snapshot.library.games) {
            if (sg.appId) snapshotMediaByAppId.set(sg.appId, sg.media);
            if (sg.appId) snapshotCompletionByAppId.set(sg.appId, sg.completionStatus ?? null);
          }
          let bridged = 0;
          for (const game of loadedGames) {
            if (!game.appId) continue;
            const sm = snapshotMediaByAppId.get(game.appId);
            if (!sm) continue;
            let changed = false;
            if (!game.backgroundPath && sm.backgroundPath) { game.backgroundPath = sm.backgroundPath; changed = true; }
            if (!game.landscapePath && sm.landscapePath) { game.landscapePath = sm.landscapePath; changed = true; }
            if (!game.coverPath && sm.coverPath) { game.coverPath = sm.coverPath; changed = true; }
            if (!game.logoPath && sm.logoPath) { game.logoPath = sm.logoPath; changed = true; }
            if (!game.iconPath && sm.iconPath) { game.iconPath = sm.iconPath; changed = true; }
            if (changed) bridged++;
            // Bridge completion status from snapshot for games from SQLite/reconciled
            if (!game.completionStatus) {
              const cs = snapshotCompletionByAppId.get(game.appId);
              if (cs) game.completionStatus = cs;
            }
          }
          if (bridged > 0) {
            console.log(`[LIBRARY_CONTEXT][SNAPSHOT_MEDIA_BRIDGE] bridged=${bridged} games=${loadedGames.length}`);
          }
        }

        const effectiveSource = (loadSource === "snapshot-fallback" && gamesRef.current.length === 0) ? "snapshot" : loadSource;
        applyGamesSafely(loadedGames, effectiveSource, { allowReplace: true });
      }
      if (cached) {
        setWarnings(cached.warnings || []);
      }
      setInitialLoading(false);
      bootLoaded.current = true;

      // Schedule post-hydration Steam install reconciliation
      if (loadedGames && loadedGames.length > 0) {
        const { schedulePostSnapshotSteamReconciliation } = await import("../services/providerStatusReconciliation");
        schedulePostSnapshotSteamReconciliation(loadedGames, updateGame, { steamRoot: settings.steamRoot });
      }

      reportLibraryProgress({ phase: "done", source: (loadSource === "empty" ? "unknown" : loadSource) as LibraryLoadSource, itemsFound: loadedGames?.length });

      // Schedule background Steam scan after main window is visible
      const needsScan = !cached || isCacheExpired(cached);
      if (needsScan) {
        scheduleAfterMain(async () => {
          setLoading(true);
          try {
            const result = await resolveLibraryGames(settings, {
              force: true,
              onProgress(source, phase, extra) {
                reportLibraryProgress({
                  source,
                  phase,
                  itemsFound: extra?.itemsFound,
                  itemsAdded: extra?.itemsAdded,
                });
              },
            });
            const enriched = await enrichWithStats(result.games);
            reportLibraryProgress({ phase: "updating-cache", source: "unknown" });
            await saveCachedGames(enriched, result.warnings);
            applyGamesSafely(enriched, "background-scan");
            setWarnings(result.warnings);
            reportLibraryProgress({ phase: "done", source: "steam", itemsFound: enriched.length });
          } catch (error) {
            console.error("[LibraryGamesContext] scan error:", error);
            reportLibraryProgress({ phase: "error", source: "steam", errors: [String(error)] });
          } finally {
            setLoading(false);
          }
        }, 3000);
      }
    } catch (error) {
      console.error("[LibraryGamesContext] load error:", error);
      reportLibraryProgress({ phase: "error", source: "unknown", errors: [String(error)] });
      setInitialLoading(false);
      bootLoaded.current = true;
    }
  }

  // Step 1: Settings fingerprint-based load
  const settingsKey = [
    settings.steamRoot,
    settings.luaPath,
    settings.depotcachePath,
    settings.gameScanFolders?.join("|")
  ].filter(Boolean).join("::");

  useEffect(() => {
    if (!settingsKey) {
      console.log(`[LIBRARY_CONTEXT][LOAD_SKIP] reason=settings-not-ready`);
      return;
    }
    if (lastSettingsKey.current === settingsKey) {
      return;
    }
    lastSettingsKey.current = settingsKey;
    console.log(`[LIBRARY_CONTEXT][LOAD_START] settingsReady=true key=${settingsKey.substring(0, 40)}...`);
    setTimeout(() => load(settings), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey]);

  // Step 2: Subscribe to gameStore reconciled updates
  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      const { subscribe, getReconciledGames } = await import("../services/gameStore");
      unsub = subscribe(() => {
        const reconciled = getReconciledGames();
        if (reconciled.length > 0) {
          applyGamesSafely(reconciled, "reconciled-update");
        } else {
          console.log(`[LIBRARY_CONTEXT][EMPTY_RECONCILED_IGNORED] current=${gamesRef.current.length}`);
        }
      });
    })();
    return () => { unsub?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to manualGameStore changes â€” re-apply with fresh manual games
  useEffect(() => {
    if (!isIntegrationEnabled("manual")) return;
    // One-shot boot-time reconcile: delete duplicate numeric-appId favorite keys
    // for manual games that gained a Steam appId (runs after games are loaded).
    if (gamesRef.current.length > 0) {
      const bootManual = getManualLibraryGames();
      if (reconcileManualFavoriteKeys(bootManual)) {
        console.log(`[FAVORITES][RECONCILE] manualGames=${bootManual.length} duplicateAppIdKeysRemoved=true`);
      }
    }
    return subscribeManualGames(() => {
      const current = gamesRef.current;
      if (current.length === 0) return; // not loaded yet
      // Strip manual games — applyGamesSafely re-adds fresh ones from store at line 222.
      // This avoids stale manual objects surviving through mergeGames.
      const nonManual = current.filter((g) => g.source !== "manual");
      const freshManual = getManualLibraryGames();
      // Delete-only reconcile: if a manual game gained a Steam appId, drop the
      // duplicate numeric-appId favorite key when the canonical libraryId is also favorited.
      if (reconcileManualFavoriteKeys(freshManual)) {
        console.log(`[FAVORITES][RECONCILE] manualGames=${freshManual.length} duplicateAppIdKeysRemoved=true`);
      }
      if (DEBUG_MANUAL_REMOVE) {
        const prevManual = current.filter((g) => g.source === "manual");
        const removedIds = prevManual.filter((pg) => !freshManual.some((fm) => fm.id === pg.id)).map((g) => g.id);
        if (removedIds.length > 0) {
          console.log(`[MANUAL_REMOVE][LIBRARY_SUB] prevManual=${prevManual.length} freshManual=${freshManual.length} removed=${removedIds.join(",")}`);
        }
      }
      if (DEBUG_MANUAL_COVER) {
        console.log(`[MANUAL_COVER][LIBRARY_MANUAL_UPDATE] manualCount=${freshManual.length} prevManualCount=${current.filter((g) => g.source === "manual").length} incomingImageUrls=${freshManual.map((g) => g.imageUrl).join(",")} prevImageUrls=${current.filter((g) => g.source === "manual").map((g) => g.imageUrl).join(",")}`);
      }
      applyGamesSafely(nonManual, "manual-update");
    });
  }, []);

  // Subscribe to Epic game store changes â€” re-apply with fresh Epic entries
  useEffect(() => {
    if (!EPIC_LIBRARY_ENABLED || !isIntegrationEnabled("epic")) return;

    // Trigger initial Epic scan (fire-and-forget) only when scanOnStartup is enabled
    if (isIntegrationScanOnStartup("epic")) {
      refreshEpicGames(settings.steamRoot || undefined).catch((err) => console.warn(err));
    }

    // Subscribe to override changes (media/metadata writes from GameEditDialog)
    initOverrideSubscription();

    return subscribeEpicGames(() => {
      const current = gamesRef.current;
      if (current.length === 0) return; // not loaded yet
      // Strip Epic games â€” applyGamesSafely re-adds fresh ones from store.
      // This avoids stale Epic objects surviving through mergeGames.
      const nonEpic = current.filter((g) => g.source !== "epic");
      if (DEBUG_EPIC_LIBRARY) {
        const prevEpicCount = current.filter((g) => g.source === "epic").length;
        const freshEpicCount = getEpicLibraryGames().length;
        console.log(`[EPIC_STORE][LIBRARY_SUB] prevEpic=${prevEpicCount} freshEpic=${freshEpicCount} prevTotal=${current.length} nonEpic=${nonEpic.length}`);
      }
      applyGamesSafely(nonEpic, "epic-update");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to Debrid game store changes — re-apply with fresh Debrid entries
  useEffect(() => {
    if (!DEBRID_LIBRARY_ENABLED || !isIntegrationEnabled("debrid")) return;

    // Self-heal the legacy appinfo index so the sidebar name matches the live
    // (clean) Debrid title, then refresh React state for a re-render.
    const syncDebridTitlesNow = () => {
      syncDebridTitlesToLegacyIndex(getDebridLibraryGames(), appInfoMapRef.current).then((changed) => {
        const keys = Object.keys(changed);
        if (keys.length === 0) return;
        setAppInfoMap((prev) => ({ ...prev, ...changed }));
      });
    };

    // Trigger initial Debrid refresh (fire-and-forget) only when scanOnStartup is enabled
    if (isIntegrationScanOnStartup("debrid")) {
      refreshDebridGames()
        .then(syncDebridTitlesNow)
        .catch((err) => console.warn("[DEBRID] initial refresh:", err));
    }

    return subscribeDebridGames(() => {
      const current = gamesRef.current;
      if (current.length === 0) return; // not loaded yet
      // Strip Debrid games — applyGamesSafely re-adds fresh ones from store.
      // This avoids stale Debrid objects surviving through mergeGames.
      const nonDebrid = current.filter((g) => g.source !== "debrid");
      if (DEBUG_DEBRID_LIBRARY) {
        const prevDebridCount = current.filter((g) => g.source === "debrid").length;
        const freshDebridCount = getDebridLibraryGames().length;
        console.log(`[DEBRID_STORE][LIBRARY_SUB] prevDebrid=${prevDebridCount} freshDebrid=${freshDebridCount} prevTotal=${current.length} nonDebrid=${nonDebrid.length}`);
      }
      applyGamesSafely(nonDebrid, "debrid-update");
      syncDebridTitlesNow();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (appInfoLoaded.current) return;
    appInfoLoaded.current = true;
    loadLibraryAppInfo().then(setAppInfoMap).catch((err) => console.warn(err));
  }, []);

  // Step 9: Snapshot writes only from stable state
  useEffect(() => {
    if (games.length === 0) {
      console.log(`[LIBRARY_CONTEXT][SNAPSHOT_SCHEDULE_SKIP] reason=no-games`);
      return;
    }
    if (Object.keys(appInfoMap).length === 0) {
      console.log(`[LIBRARY_CONTEXT][SNAPSHOT_SCHEDULE_SKIP] reason=no-appinfo`);
      return;
    }
    if (!bootLoaded.current) {
      console.log(`[LIBRARY_CONTEXT][SNAPSHOT_SCHEDULE_SKIP] reason=booting`);
      return;
    }

    // Skip scheduling if games data hasn't changed (e.g., re-render with identical data)
    const fp = computeGamesFingerprint(games);
    if (fp === _lastGamesFingerprint) {
      console.log(`[LIBRARY_CONTEXT][SNAPSHOT_SCHEDULE_SKIP] reason=unchanged-games games=${games.length}`);
      return;
    }
    _lastGamesFingerprint = fp;

    console.log(`[LIBRARY_CONTEXT][SNAPSHOT_SCHEDULE] games=${games.length} delay=60000`);
    scheduleSnapshotWrite(games, appInfoMap, null, 60000, "library-reconcile");
  }, [games, appInfoMap]);

  // Step 8: Manual refresh must not wipe on failure
  const refresh = useCallback(async (options?: { force?: boolean }) => {
    const s = settingsRef.current;
    setLoading(true);
    try {
      const result = await resolveLibraryGames(s, {
        ...(options?.force ? { force: true } : {}),
        onProgress(source, phase, extra) {
          reportLibraryProgress({
            source,
            phase,
            itemsFound: extra?.itemsFound,
            itemsAdded: extra?.itemsAdded,
          });
        },
      });
      let enriched = await enrichWithStats(result.games);

      // â”€â”€ Lua-only fallback when TTL/Store guard blocked resolveLibraryGames â”€â”€
      // After a Lua package download, the full Steam scan is TTL-blocked for 10 min.
      // We scan Lua scripts directly so newly installed Lua-only games appear in Library
      // immediately instead of requiring an app restart.
      // Also updates existing LibraryGame entries when a Lua script now exists for that appId.
      if (result.games.length === 0 && gamesRef.current.length > 0 && s.luaPath) {
        console.log(`[LIBRARY][REFRESH_START] reason=ttl-or-store current=${gamesRef.current.length}`);
        try {
          const { scanInstalledLuaScripts } = await import("../services/tauri");
          const currentGames = gamesRef.current;
          const scripts = await scanInstalledLuaScripts(s.luaPath);
          console.log(`[LIBRARY][LUA_SCAN_RUNTIME] entries=${scripts.length} path=${s.luaPath}`);

          // Group scripts by appId (a game could have multiple .lua files)
          const luaByAppId = new Map<number, (typeof scripts)[number][]>();
          for (const script of scripts) {
            const list = luaByAppId.get(script.app_id) || [];
            list.push(script);
            luaByAppId.set(script.app_id, list);
          }

          // Resolve canonical names for new appIds
          let resolvedNames: Record<string, string> = {};
          try {
            const { resolveCanonicalName } = await import("../services/gameCacheService");
            const existingAppIds = new Set(currentGames.map((g) => g.appId).filter(Boolean));
            await Promise.allSettled(
              [...luaByAppId.keys()]
                .filter((id) => !existingAppIds.has(String(id)))
                .map(async (id) => {
                  const name = await resolveCanonicalName(String(id));
                  if (name) resolvedNames[String(id)] = name;
                }),
            );
          } catch { /* name resolution is optional */ }

          // Phase 1: Update existing games with Lua state from fresh scan
          let updatedCount = 0;
          let clearedCount = 0;
          const updatedGames = currentGames.map((g) => {
            if (!g.appId) return g;
            const appScripts = luaByAppId.get(Number(g.appId));
            if (appScripts) {
              updatedCount++;
              console.log(`[LIBRARY][UPSERT_FROM_LUA] appid=${g.appId} inserted=false updated=true luaActive=${appScripts.some(s => !s.is_disabled)}`);
              return {
                ...g,
                luaScripts: appScripts,
                hasLua: true,
                isLuaActive: appScripts.some((s) => !s.is_disabled),
                isLuaDisabled: appScripts.every((s) => s.is_disabled),
              };
            }
            // No scripts found for this appId â€” clear stale Lua state if it existed
            if (g.hasLua || g.luaScripts.length > 0) {
              clearedCount++;
              console.log(`[LIBRARY][LUA_CLEAR_STALE] appid=${g.appId} title="${g.title}" hadScripts=${g.luaScripts.length}`);
              return {
                ...g,
                luaScripts: [],
                hasLua: false,
                isLuaActive: false,
                isLuaDisabled: false,
                // If game was Lua-only with no Steam install, remove it entirely
                source: g.source === "lua" && !g.steamInstalled ? "lua" : g.source,
              };
            }
            return g;
          });

          // Phase 2: Insert brand-new Lua-only games
          const currentAppIds = new Set(updatedGames.map((g) => g.appId).filter(Boolean));
          const newLuaGames: LibraryGame[] = [];
          for (const [appIdNum, appScripts] of luaByAppId) {
            const appIdStr = String(appIdNum);
            if (!currentAppIds.has(appIdStr)) {
              const title = resolvedNames[appIdStr] || `Steam App ${appIdStr}`;
              newLuaGames.push({
                id: `lua-${appIdStr}`,
                appId: appIdStr,
                title,
                source: "lua",
                isPlayable: false,
                isInstallable: false,
                steamInstalled: false,
                luaScripts: appScripts,
                hasLua: true,
                isLuaActive: appScripts.some((s) => !s.is_disabled),
                isLuaDisabled: appScripts.every((s) => s.is_disabled),
                hasLuaSource: false,
                sources: [],
              } as LibraryGame);
              console.log(`[LIBRARY][UPSERT_FROM_LUA] appid=${appIdStr} inserted=true updated=false title="${title}"`);
            }
          }

          const inserted = newLuaGames.length;
          if (updatedCount > 0 || newLuaGames.length > 0 || clearedCount > 0) {
            // Remove Lua-only games that lost their last script
            const finalGames = updatedGames.filter((g) => !(g.source === "lua" && !g.steamInstalled && g.luaScripts.length === 0));
            enriched = [...finalGames, ...newLuaGames].sort((a, b) =>
              (a.title || "").localeCompare(b.title || ""),
            );
            console.log(`[LIBRARY][REFRESH_LUA_FALLBACK] current=${currentGames.length} inserted=${inserted} updated=${updatedCount} cleared=${clearedCount} removedLuaOnly=${updatedGames.length - finalGames.length} total=${enriched.length}`);
            // Persist to reconciled store for crash recovery (same pattern as install/uninstall handlers)
            try {
              const { setReconciledGames } = await import("../services/gameStore");
              setReconciledGames(enriched);
              console.log(`[LIBRARY][RECONCILED_WRITE] source=lua-fallback count=${enriched.length}`);
            } catch {
              console.log(`[LIBRARY][RECONCILED_WRITE] source=lua-fallback error=failed`);
            }
          }
        } catch (err) {
          console.log(`[LIBRARY][REFRESH_RESULT] reason=lua-scan-error error=${String(err)}`);
        }
      }

      reportLibraryProgress({ phase: "updating-cache", source: "unknown" });
      if (enriched.length === 0 && gamesRef.current.length > 0) {
        console.log(`[LIBRARY_CONTEXT][REFRESH_EMPTY_IGNORED] total=${gamesRef.current.length}`);
        reportLibraryProgress({ phase: "done", source: "steam", itemsFound: 0 });
        return;
      }
      await saveCachedGames(enriched, result.warnings);
      applyGamesSafely(enriched, "manual-refresh", { allowReplace: true });
      setWarnings(result.warnings);
      await updateAppInfoFromGames(enriched).catch((err) => console.warn(err));
      reportLibraryProgress({ phase: "done", source: "steam", itemsFound: enriched.length });
    } catch (error) {
      console.error("[LibraryGamesContext] refresh error:", error);
      reportLibraryProgress({ phase: "error", source: "steam", errors: [String(error)] });
    } finally {
      setLoading(false);
    }
  }, []);

  // Subscribe to SQLite data changes — read directly from SQLite (no re-scan)
  useEffect(() => {
    let lastRefresh = 0;
    const unsub = subscribeDataChanges(async (type, detail) => {
      if (type === "games-upserted") {
        const now = Date.now();
        if (now - lastRefresh > 3000) {
          lastRefresh = now;
          try {
            const { readAllGames } = await import("../services/tauri");
            const { loadSteamGameIndex, indexEntryToLibraryGame } = await import("../services/fullSteamGameIndex");
            const entries = await readAllGames();
            if (entries.length === 0) return;
            const index = await loadSteamGameIndex();
            // Build Lua overlay from current games (preserve existing Lua state)
            const currentByAppId = new Map<string, LibraryGame>();
            for (const g of gamesRef.current) {
              if (g.appId) currentByAppId.set(g.appId, g);
            }
            const games = index.map((entry) => {
              const existing = currentByAppId.get(entry.appId);
              const libGame = indexEntryToLibraryGame(entry, {});
              // Preserve Lua state and metadata from existing games
              if (existing) {
                libGame.hasLua = existing.hasLua;
                libGame.luaScripts = existing.luaScripts;
                libGame.isLuaActive = existing.isLuaActive;
                libGame.isLuaDisabled = existing.isLuaDisabled;
                libGame.hasLuaSource = existing.hasLuaSource;
                libGame.metadata = existing.metadata ?? libGame.metadata;
                libGame.imageUrl = existing.imageUrl ?? libGame.imageUrl;
                libGame.isFavorite = existing.isFavorite;
                if (existing.isStandalone) libGame.isStandalone = true;
                libGame.sizeOnDisk = existing.sizeOnDisk;
                libGame.executablePath = existing.executablePath;
                libGame.installDir = existing.installDir;
                // Preserve media paths — indexEntryToLibraryGame never populates these
                libGame.landscapePath = existing.landscapePath;
                libGame.coverPath = existing.coverPath;
                libGame.backgroundPath = existing.backgroundPath;
                libGame.logoPath = existing.logoPath;
                libGame.iconPath = existing.iconPath;
                // Preserve user-set completion status
                libGame.completionStatus = existing.completionStatus;
                // Preserve playtime fields — indexEntryToLibraryGame reads lastPlayed=0 from SQLite
                libGame.steamLastPlayedAt = existing.steamLastPlayedAt;
                libGame.steamPlaytimeMinutes = existing.steamPlaytimeMinutes;
                libGame.localLastPlayedAt = existing.localLastPlayedAt;
                libGame.localPlaytimeMinutes = existing.localPlaytimeMinutes;
              }
              return libGame;
            });
            applyGamesSafely(games, "sqlite-refresh");
            console.log(`[LIBRARY_CONTEXT][SQLITE_REFRESH] games=${games.length}`);
          } catch (err) {
            console.warn("[LIBRARY_CONTEXT] sqlite refresh failed:", err);
          }
        }
      }

      // Patch media paths when appinfo is updated (after download completes)
      if (type === "appinfo-changed") {
        const appId = detail;
        if (!appId) return;
        try {
          const { getCachedGameAppInfo } = await import("../services/gameCacheService");
          const appInfo = await getCachedGameAppInfo(appId);
          if (!appInfo?.media) return;

          const current = gamesRef.current;
          const idx = current.findIndex((g) => g.appId === appId);
          if (idx === -1) return;

          const game = current[idx];
          const m = appInfo.media;
          if (game.coverPath === (m.coverPath ?? undefined) &&
              game.landscapePath === (m.landscapePath ?? undefined) &&
              game.backgroundPath === (m.backgroundPath ?? undefined) &&
              game.logoPath === (m.logoPath ?? undefined) &&
              game.iconPath === (m.iconPath ?? undefined)) return;

          const updated = [...current];
          updated[idx] = {
            ...game,
            coverPath: m.coverPath ?? undefined,
            landscapePath: m.landscapePath ?? undefined,
            backgroundPath: m.backgroundPath ?? undefined,
            logoPath: m.logoPath ?? undefined,
            iconPath: m.iconPath ?? undefined,
          };
          setGames(updated);
          console.log(`[LIBRARY_CONTEXT][MEDIA_PATCH] appid=${appId} patched cover=${!!m.coverPath} landscape=${!!m.landscapePath}`);
        } catch { /* non-critical */ }
      }
    });
    return unsub;
  }, [applyGamesSafely]);

  // Subscribe to snapshot writes — patch media paths on existing games when downloads complete
  useEffect(() => {
    let cancelled = false;
    import("../services/startupSnapshotService").then(({ subscribeSnapshotUpdated, getCachedSnapshot }) => {
      if (cancelled) return;
      const unsub = subscribeSnapshotUpdated(async () => {
        try {
          const snapshot = getCachedSnapshot();
          if (!snapshot || !snapshot.library.games.length) return;

          const mediaByAppId = new Map<string, SnapshotGame["media"]>();
          for (const sg of snapshot.library.games) {
            if (sg.appId) mediaByAppId.set(sg.appId, sg.media);
          }

          const current = gamesRef.current;
          let changed = false;
          const updated = current.map((game) => {
            if (!game.appId) return game;
            const sm = mediaByAppId.get(game.appId);
            if (!sm) return game;

            const bg = sm.backgroundPath ?? undefined;
            const ls = sm.landscapePath ?? undefined;
            const cv = sm.coverPath ?? undefined;
            const lg = sm.logoPath ?? undefined;
            const ic = sm.iconPath ?? undefined;

            if (
              game.backgroundPath === bg &&
              game.landscapePath === ls &&
              game.coverPath === cv &&
              game.logoPath === lg &&
              game.iconPath === ic
            ) return game;

            changed = true;
            return { ...game, backgroundPath: bg, landscapePath: ls, coverPath: cv, logoPath: lg, iconPath: ic };
          });

          if (changed) {
            const patched = updated.filter((g, i) => current[i] !== g).length;
            setGames(updated);
            console.log(`[LIBRARY_CONTEXT][SNAPSHOT_MEDIA_SYNC] patched=${patched} games=${updated.length}`);
          }
        } catch { /* snapshot not available */ }
      });
      _snapshotMediaUnsubRef.current = unsub;
    });
    return () => {
      cancelled = true;
      _snapshotMediaUnsubRef.current?.();
    };
  }, []);

  const updateGame = useCallback((appId: string, updates: Partial<LibraryGame>) => {
    setGames((prev) => {
      const idx = prev.findIndex((g) => g.appId === appId);
      if (idx === -1) {
        console.log(`[LIBRARY_CONTEXT][UPDATE_GAME_SKIP] appid=${appId} reason=not-found`);
        return prev;
      }
      const updated = { ...prev[idx], ...updates };
      const next = [...prev];
      next[idx] = updated;
      console.log(`[LIBRARY_CONTEXT][UPDATE_GAME] appid=${appId} updates=${Object.keys(updates).join(",")}`);
      return next;
    });
  }, []);

  const checkGameProviderStatus = useCallback(async (appId: string, force?: boolean): Promise<{ steamInstalled: boolean } | null> => {
    const steamRoot = settingsRef.current.steamRoot;
    const current = gamesRef.current;
    const game = current.find((g) => g.appId === appId);
    if (!game) {
      console.log(`[PROVIDER][CHECK_SKIP] appid=${appId} reason=game-not-found`);
      return null;
    }
    const result = await refreshSingleGameSteamStatus(appId, { steamRoot, force });
    if (result && result.steamInstalled !== game.steamInstalled) {
      const newSource = result.steamInstalled ? "steam" as const : (game.hasLua ? "lua" as const : game.source);
      updateGame(appId, {
        steamInstalled: result.steamInstalled,
        isPlayable: result.steamInstalled,
        isInstallable: !result.steamInstalled,
        source: newSource,
      });
    }
    return result;
  }, [updateGame]);

  // Subscribe to install completion events â€” re-ingest through real installed Steam pipeline
  useEffect(() => {
    return installTrackerService.onInstalled(async (appId) => {
      console.log(`[INSTALL_REAL] appid=${appId} phase=detected`);

      // Phase 1: Get real installed game data from Steam appmanifest
      const steamRoot = settingsRef.current.steamRoot;
      let installStatus: import("../services/tauri").SteamGameInstallStatus | null = null;
      try {
        const { checkSteamGameInstalled: doCheck } = await import("../services/tauri");
        installStatus = await doCheck(Number(appId), steamRoot);
        console.log(`[INSTALL_REAL] appid=${appId} phase=steam-scan found=${installStatus.isInstalled} installDir=${installStatus.installPath ?? installStatus.installDir ?? "null"} name=${installStatus.name ?? "null"}`);
      } catch (err) {
        console.log(`[INSTALL_REAL] appid=${appId} phase=steam-scan error=${String(err)}`);
      }

      if (!installStatus || !installStatus.isInstalled) {
        // Appmanifest not found yet â€” tracker race? Fall back to flag-only patch
        updateGame(appId, { steamInstalled: true, isInstallable: false, isPlayable: true });
        console.log(`[INSTALL_REAL] appid=${appId} phase=fallback reason=not-on-disk-yet`);
        return;
      }

      // Phase 2: Build real LibraryGame from installed Steam data
      const current = gamesRef.current;
      const idx = current.findIndex((g) => g.appId === appId);
      if (idx === -1) {
        console.log(`[INSTALL_REAL] appid=${appId} phase=abort reason=game-not-found`);
        return;
      }

      const existing = current[idx];
      const installDir = installStatus.installPath || installStatus.installDir || existing.installDir || undefined;
      const libraryPath = installStatus.libraryPath || existing.libraryPath || undefined;
      const realInstalled: LibraryGame = {
        ...existing,
        // Real installed fields from Steam appmanifest
        steamInstalled: true,
        isInstallable: false,
        isPlayable: installStatus.isInstalled,
        source: "steam",
        installDir,
        libraryPath,
        title: existing.title || installStatus.name || existing.title,
        sizeOnDisk: installStatus.sizeOnDisk ?? existing.sizeOnDisk,
        lastUpdated: installStatus.lastUpdated ?? existing.lastUpdated,
        // Preserve Lua metadata
        luaScripts: existing.luaScripts || [],
        hasLua: existing.hasLua || false,
        isLuaActive: existing.isLuaActive || false,
        isLuaDisabled: existing.isLuaDisabled || false,
        hasLuaSource: existing.hasLuaSource || false,
      };
      console.log(`[INSTALL_REAL] appid=${appId} phase=canonical-built steamInstalled=true isPlayable=true isInstallable=false installDir=${installDir ?? "null"} libraryPath=${libraryPath ?? "null"}`);
      console.log(`[INSTALL_REAL] appid=${appId} phase=merge-preserve-lua hasLua=${existing.hasLua} luaScripts=${(existing.luaScripts || []).length}`);

      // Phase 3: Update React in-memory state via updateGame (sync)
      updateGame(appId, {
        steamInstalled: true,
        isInstallable: false,
        isPlayable: true,
        source: "steam",
        installDir,
        libraryPath,
      });

      // Phase 4: Persist to SQLite cache
      const updatedGames = [...current];
      updatedGames[idx] = realInstalled;
      try {
        await saveCachedGames(updatedGames);
        console.log(`[INSTALL_REAL] appid=${appId} phase=sqlite-write ok=true`);
      } catch {
        console.log(`[INSTALL_REAL] appid=${appId} phase=sqlite-write ok=false`);
      }

      // Phase 5: Update game store for boot reconciliation
      try {
        const { setReconciledGames } = await import("../services/gameStore");
        setReconciledGames(updatedGames);
        console.log(`[INSTALL_REAL] appid=${appId} phase=reconciled-write ok=true`);
      } catch {
        console.log(`[INSTALL_REAL] appid=${appId} phase=reconciled-write ok=false`);
      }

      // Phase 6: Schedule snapshot write with short delay
      const appInfoMapCurrent = appInfoMapRef.current;
      scheduleSnapshotWrite(updatedGames, appInfoMapCurrent, null, 100, "install-detected");
      console.log(`[INSTALL_REAL] appid=${appId} phase=snapshot-dirty ok=true delayMs=100`);
      console.log(`[INSTALL_REAL] appid=${appId} phase=install-dir-action available=${!!installDir} path=${installDir ?? "null"}`);
      console.log(`[INSTALL_REAL] appid=${appId} phase=play-action action=play`);
    });
  }, [updateGame]);

  // â”€â”€ Uninstall detection: periodic check for removed Steam appmanifests â”€â”€
  useEffect(() => {
    if (!isIntegrationEnabled("steam")) return;
    const UNINSTALL_POLL_MS = 30000;
    let running = false;

    const checkForUninstalled = async () => {
      if (running) return;
      running = true;
      try {
        const steamRoot = settingsRef.current.steamRoot;
        if (!steamRoot) return;

        // Scan all currently-installed Steam appmanifests (single Rust command)
        const { scanSteamInstalledGames: doScan } = await import("../services/tauri");
        const scanResult = await doScan({ steamPath: steamRoot });
        const installedAppIds = new Set<string>(
          scanResult.map((g) => String(g.appId))
        );

        // â”€â”€ Check for pending uninstall that timed out (user cancelled Steam modal) â”€â”€
        // Runs every poll cycle before the "no missing games" early return.
        try {
          const { isPendingUninstall, getPendingUninstallTimestamp, clearPendingUninstall, getUninstallPendingScanTtl } = await import("../services/gameCacheService");
          const { showInfo } = await import("../components/toast/GameToast");
          const scanTtl = getUninstallPendingScanTtl();
          for (const game of gamesRef.current) {
            if (!game.appId) continue;
            if (isPendingUninstall(game.appId) && installedAppIds.has(game.appId)) {
              const ts = getPendingUninstallTimestamp(game.appId);
              if (ts && Date.now() - ts > scanTtl) {
                clearPendingUninstall(game.appId);
                const ageMs = Date.now() - ts;
                console.log(`[UNINSTALL_PENDING] appid=${game.appId} phase=auto-clear stillInstalled=true ageMs=${ageMs}`);
                showInfo(`"${game.title ?? game.appId}" uninstall cancelled or not completed. The game is still installed.`);
              }
            }
          }
        } catch { /* ignore */ }

        // Read games AFTER scan to capture any interleaved installs
        const currentGames = gamesRef.current;
        const installedGames = currentGames.filter(
          (g): g is LibraryGame & { appId: string } =>
            g.appId !== undefined && g.steamInstalled === true
        );
        if (installedGames.length === 0) return;

        // Find games marked installed but missing from Steam scan
        const missingAppIds: string[] = [];
        const seenMissing = new Set<string>();
        for (const game of installedGames) {
          if (!installedAppIds.has(game.appId) && !seenMissing.has(game.appId)) {
            seenMissing.add(game.appId);
            missingAppIds.push(game.appId);
          }
        }
        if (missingAppIds.length === 0) return;

        // Clear pending uninstall state for truly removed games + confirm-uninstalled log
        try {
          const { clearPendingUninstall } = await import("../services/gameCacheService");
          for (const appId of missingAppIds) {
            clearPendingUninstall(appId);
            console.log(`[UNINSTALL_PENDING] appid=${appId} phase=confirmed-uninstalled`);
          }
        } catch { /* ignore */ }

        // Build full updated games array from the captured snapshot
        const updatedGames = currentGames.map((g) => {
          if (!g.appId || !seenMissing.has(g.appId)) return g;
          return {
            ...g,
            steamInstalled: false,
            isInstallable: true,
            isPlayable: false,
            installDir: undefined,
            libraryPath: undefined,
            sizeOnDisk: undefined,
            lastUpdated: undefined,
          } as LibraryGame;
        });

        // Update React state (sync, React 18 auto-batches)
        for (const appId of missingAppIds) {
          updateGame(appId, {
            steamInstalled: false,
            isInstallable: true,
            isPlayable: false,
            installDir: undefined,
            libraryPath: undefined,
            sizeOnDisk: undefined,
            lastUpdated: undefined,
          });
          const game = currentGames.find((g) => g.appId === appId);
          console.log(`[UNINSTALL][DETECT] appid=${appId} title=${game?.title ?? "unknown"}`);
        }

        // Persist to SQLite cache
        try { await saveCachedGames(updatedGames); } catch { /* ignore */ }

        // Update game store for boot reconciliation
        try {
          const { setReconciledGames } = await import("../services/gameStore");
          setReconciledGames(updatedGames);
        } catch { /* ignore */ }

        // Schedule snapshot write
        scheduleSnapshotWrite(updatedGames, appInfoMapRef.current, null, 100, "uninstall-detected");
        console.log(`[UNINSTALL][DONE] count=${missingAppIds.length}`);
      } catch {
        // scan failed â€” try again next interval
      } finally {
        running = false;
      }
    };

    const interval = setInterval(checkForUninstalled, UNINSTALL_POLL_MS);
    const initialTimer = setTimeout(checkForUninstalled, 5000);

    return () => {
      clearInterval(interval);
      clearTimeout(initialTimer);
    };
  }, [updateGame]);

  // Listen for Lua folder changes (enable/disable/uninstall of extensions like OpenSteamTool)
  // Triggers a full library refresh which includes Lua script scanning
  useEffect(() => {
    const handler = () => {
      console.log("[LIBRARY][LUA_CHANGED] Extension toggled, refreshing Lua state");
      refresh({ force: true }).catch((err) => console.warn(err));
    };
    window.addEventListener("lumaforge-lua-changed", handler);
    return () => window.removeEventListener("lumaforge-lua-changed", handler);
  }, [refresh]);

  const ctxValue = useMemo(() => ({
    games, warnings, loading, initialLoading,
    selectedId, setSelectedId, selectedGame, setSelectedGame,
    refresh,
    updateGame,
    checkGameProviderStatus,
    appInfoMap, status, librarySource, libraryFingerprint,
  }), [
    games, warnings, loading, initialLoading,
    selectedId, selectedGame,
    refresh, updateGame, checkGameProviderStatus,
    appInfoMap, status, librarySource, libraryFingerprint,
  ]);

  return (
    <LibraryGamesContext.Provider value={ctxValue}>
      {children}
    </LibraryGamesContext.Provider>
  );
}
