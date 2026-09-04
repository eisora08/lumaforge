import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { GameAchievementsSummary } from "../../types/gameAchievements";
import type { SteamReviewSummary } from "../../types/gameReview";
import type { LibraryGame } from "../../types/libraryGame";
import { achievementStore } from "../../services/achievementStore";
import { getCachedSnapshot } from "../../services/startupSnapshotService";
import { resolveGameReviewSummaries } from "../../services/gameReviewResolver";
import { scanAchievementFolders } from "../../services/tauri";
import { setFolderAchievementCache } from "./consoleGameStats";
import { DEBUG_CONSOLE_ACH } from "../../config/debug";

const DEBUG_CONSOLE_REVIEW = false;

const log = (flag: boolean, ...args: unknown[]) => {
  if (flag) console.log(...args);
};

export function useConsoleAchievements(appIdStr: string | null, game?: LibraryGame | null) {
  const [state, setState] = useState<{
    appId: string | null;
    summary: GameAchievementsSummary | null;
  }>({ appId: null, summary: null });

  const loadingRef = useRef<Set<string>>(new Set());

  const update = useCallback((appId: string | null, summary: GameAchievementsSummary | null) => {
    setState({ appId, summary });
  }, []);

  const latestAppIdRef = useRef<string | null>(null);

  // Build lookup keys from game object
  // For Epic games: extract appName from providerGameId ("ns:catalogId:appName" → "appName")
  const epicAppName = useMemo(() => {
    if (game?.source !== "epic" || !game?.providerGameId) return null;
    const parts = game.providerGameId.split(":");
    return parts[parts.length - 1] || null;
  }, [game?.source, game?.providerGameId]);

  const lookupKey = useMemo(() => {
    if (appIdStr) return appIdStr;
    if (epicAppName) return epicAppName;
    if (game?.libraryId) return game.libraryId;
    if (game?.id) return game.id;
    return null;
  }, [appIdStr, epicAppName, game?.libraryId, game?.id]);

  useEffect(() => {
    if (!lookupKey) {
      latestAppIdRef.current = null;
      update(null, null);
      return;
    }

    let cancelled = false;
    const current = lookupKey;
    latestAppIdRef.current = current;
    loadingRef.current.add(current);

    update(current, null);

    // FIRST: try game object fields directly (like getGameAchievementSummary does)
    if (game && typeof game.achievementUnlocked === "number" && typeof game.achievementTotal === "number" && game.achievementTotal > 0) {
      const fromGame: GameAchievementsSummary = {
        appId: current,
        source: "local-cache",
        total: game.achievementTotal,
        unlocked: game.achievementUnlocked,
        percent: game.achievementTotal > 0 ? Math.round((game.achievementUnlocked / game.achievementTotal) * 100) : 0,
        progressAvailable: true,
        updatedAt: game.lastUpdated ?? 0,
        achievements: [],
      };
      loadingRef.current.delete(current);
      if (latestAppIdRef.current !== current) return;
      log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][LOAD] key=${current} source=game-fields`);
      update(current, fromGame);
    }

    // SECOND: try achievement store — bare keys first, then composite keys with known platforms
    const KNOWN_PLATFORMS = ["epic-official", "steam-official", "steam"];
    const bareKeys = [appIdStr, epicAppName, game?.libraryId, game?.id].filter((k): k is string => !!k);
    log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][STORE] key=${current} bareKeys=${JSON.stringify(bareKeys)} gameSource=${game?.source}`);
    let fromStore: GameAchievementsSummary | undefined;
    for (const k of bareKeys) {
      fromStore = achievementStore.getSummary(k);
      if (fromStore) break;
    }
    // If no match with bare keys, try composite keys (appId:platform)
    if (!fromStore) {
      for (const k of bareKeys) {
        for (const platform of KNOWN_PLATFORMS) {
          fromStore = achievementStore.getSummary(k, platform);
          if (fromStore) break;
        }
        if (fromStore) break;
      }
    }
    log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][STORE] key=${current} fromStore=${fromStore ? "FOUND" : "MISS"} total=${fromStore?.total ?? 0}`);
    if (fromStore) {
      loadingRef.current.delete(current);
      if (latestAppIdRef.current !== current) return;
      log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][LOAD] key=${current} source=store`);
      update(current, fromStore);
    } else {
      // THIRD: try snapshot — match by appId
      const snap = getCachedSnapshot();
      const snapGame = appIdStr ? snap?.library?.games?.find(g => g.appId === appIdStr) : undefined;
      if (snapGame?.achievementSummary && snapGame.achievementSummary.total > 0) {
        const a = snapGame.achievementSummary;
        const fromSnap: GameAchievementsSummary = {
          appId: current,
          source: "local-cache",
          total: a.total,
          unlocked: a.unlocked ?? 0,
          percent: a.percent ?? 0,
          progressAvailable: a.progressAvailable ?? false,
          updatedAt: snapGame.updatedAt ?? 0,
          achievements: [],
        };
        loadingRef.current.delete(current);
        if (latestAppIdRef.current !== current) return;
        log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][LOAD] key=${current} source=snapshot`);
        update(current, fromSnap);
      } else {
        // FOURTH: try scanAchievementFolders (reads from disk — works for Epic schema path)
        (async () => {
          try {
            const folderRows = await scanAchievementFolders();
            if (cancelled || latestAppIdRef.current !== current) return;
            setFolderAchievementCache(folderRows);
            const matchRow = folderRows.find((r) => bareKeys.includes(r.appId) && r.total > 0);
            if (matchRow) {
              const fromFolder: GameAchievementsSummary = {
                appId: matchRow.appId,
                source: (matchRow.source === "epic" ? "epic-official" : matchRow.source) as GameAchievementsSummary["source"],
                total: matchRow.total,
                unlocked: matchRow.unlocked,
                percent: matchRow.percent,
                progressAvailable: true,
                updatedAt: Date.now(),
                achievements: [],
              };
              achievementStore.setSummary(matchRow.appId, fromFolder, matchRow.source === "epic" ? "epic-official" : "steam-official");
              loadingRef.current.delete(current);
              if (latestAppIdRef.current !== current) return;
              log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][LOAD] key=${current} source=folder appId=${matchRow.appId} total=${matchRow.total} unlocked=${matchRow.unlocked}`);
              update(current, fromFolder);
            } else {
              loadingRef.current.delete(current);
              if (latestAppIdRef.current !== current) return;
              log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][MISS] key=${current} reason=no-folder-match`);
              const allKeys = [...achievementStore.getAllSummaries().keys()];
              log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][STORE_DUMP] allKeys=${JSON.stringify(allKeys.slice(0, 30))}`);
            }
          } catch (err) {
            loadingRef.current.delete(current);
            if (latestAppIdRef.current !== current) return;
            log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][MISS] key=${current} reason=folder-scan-error err=${err}`);
          }
        })();
      }
    }

    const unsub = achievementStore.subscribe((subAppId, subSummary) => {
      if (subAppId !== current) return;
      if (latestAppIdRef.current !== current) {
        log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][IGNORE_STALE] updateKey=${subAppId} currentKey=${latestAppIdRef.current}`);
        return;
      }
      log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][SUB] key=${subAppId} unlocked=${subSummary?.unlocked}/${subSummary?.total}`);
      update(subAppId, subSummary);
    });
    return () => {
      cancelled = true;
      unsub();
      loadingRef.current.delete(current);
    };
  }, [lookupKey, appIdStr, epicAppName, game?.libraryId, game?.id, game?.achievementUnlocked, game?.achievementTotal, game?.lastUpdated, update]);

  useEffect(() => {
    if (!appIdStr || !state.summary) return;
    if (state.appId !== appIdStr) return;
    if (state.summary.progressAvailable) return;
    const list = state.summary.achievements;
    if (!list || list.length === 0) return;
    const unlocked = list.filter(a => a.unlocked).length;
    if (unlocked === 0) return;
    const total = list.length;
    const percent = Math.round((unlocked / total) * 100);
    const patched: GameAchievementsSummary = {
      ...state.summary,
      unlocked,
      total,
      percent,
      progressAvailable: true,
    };
    log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][DERIVED] key=${lookupKey} unlocked=${unlocked}/${total} percent=${percent}`);
    if (lookupKey) {
      achievementStore.setSummary(lookupKey, patched, "steam-official");
    }
    update(lookupKey, patched);
  }, [lookupKey, state, update]);

  /* ── Render-time guard: only return data if it belongs to current lookup key ── */
  const achievementsSummary = state.appId === lookupKey ? state.summary : null;

  const derivedUnlocked = achievementsSummary?.achievements?.filter(a => a.unlocked).length ?? 0;
  const effectiveUnlocked = achievementsSummary?.unlocked ?? derivedUnlocked;
  const effectiveTotal = achievementsSummary?.total ?? achievementsSummary?.achievements?.length ?? 0;
  const effectivePercent = effectiveTotal > 0 ? Math.round((effectiveUnlocked / effectiveTotal) * 100) : 0;
  const isPerfected = effectiveTotal > 0 && effectiveUnlocked >= effectiveTotal;
  const hasData = achievementsSummary !== null && effectiveTotal > 0;

  return { achievementsSummary, effectiveUnlocked, effectiveTotal, effectivePercent, isPerfected, hasData };
}

export function useConsoleReviews(appIdStr: string | null) {
  const [state, setState] = useState<{
    appId: string | null;
    summary: SteamReviewSummary | null;
    isLoading: boolean;
  }>({ appId: null, summary: null, isLoading: false });

  const latestAppIdRef = useRef<string | null>(null);
  const reviewFetchRef = useRef(false);

  useEffect(() => {
    if (!appIdStr) {
      latestAppIdRef.current = null;
      reviewFetchRef.current = false;
      setState({ appId: null, summary: null, isLoading: false });
      log(DEBUG_CONSOLE_REVIEW, `[CONSOLE_REVIEW][CLEAR] appId=null`);
      return;
    }
    const current = appIdStr;
    latestAppIdRef.current = current;
    reviewFetchRef.current = false;

    log(DEBUG_CONSOLE_REVIEW, `[CONSOLE_REVIEW][CLEAR] appId=${current}`);
    setState({ appId: current, summary: null, isLoading: false });
  }, [appIdStr]);

  useEffect(() => {
    if (!appIdStr) return;
    const current = appIdStr;
    const appIdNum = Number(current);
    if (!appIdNum || appIdNum <= 0) return;
    if (reviewFetchRef.current) return;
    reviewFetchRef.current = true;
    setState(prev => prev.appId === current ? { ...prev, isLoading: true } : prev);

    log(DEBUG_CONSOLE_REVIEW, `[CONSOLE_REVIEW][LOAD] appid=${current}`);

    resolveGameReviewSummaries([appIdNum]).then((result) => {
      if (latestAppIdRef.current !== current) {
        log(DEBUG_CONSOLE_REVIEW, `[CONSOLE_REVIEW][IGNORE_STALE] updateAppId=${current} currentAppId=${latestAppIdRef.current}`);
        return;
      }
      const s = result[appIdNum];
      if (s && s.resolved && s.total_reviews > 0) {
        log(DEBUG_CONSOLE_REVIEW, `[CONSOLE_REVIEW][APPLY] appid=${current} label=${s.review_score_desc} percent=${s.positive_percent}`);
        setState({ appId: current, summary: s, isLoading: false });
      } else {
        log(DEBUG_CONSOLE_REVIEW, `[CONSOLE_REVIEW][MISS] appid=${current} reason=no-summary`);
        setState(prev => prev.appId === current ? { ...prev, isLoading: false } : prev);
      }
    });
  }, [appIdStr]);

  /* ── Render-time guard ── */
  const reviewSummary = state.appId === appIdStr ? state.summary : null;
  const isLoading = state.appId === appIdStr ? state.isLoading : false;
  const hasData = reviewSummary !== null && reviewSummary.resolved && reviewSummary.total_reviews > 0;

  return { reviewSummary, isLoading, hasData };
}
