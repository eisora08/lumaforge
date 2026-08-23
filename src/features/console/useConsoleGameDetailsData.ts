import { useState, useEffect, useRef, useCallback } from "react";
import type { GameAchievementsSummary } from "../../types/gameAchievements";
import type { SteamReviewSummary } from "../../types/gameReview";
import { achievementStore } from "../../services/achievementStore";
import { getCachedSnapshot } from "../../services/startupSnapshotService";
import { resolveGameReviewSummaries } from "../../services/gameReviewResolver";

const DEBUG_CONSOLE_ACH = false;
const DEBUG_CONSOLE_REVIEW = false;

const log = (flag: boolean, ...args: unknown[]) => {
  if (flag) console.log(...args);
};

export function useConsoleAchievements(appIdStr: string | null) {
  const [state, setState] = useState<{
    appId: string | null;
    summary: GameAchievementsSummary | null;
  }>({ appId: null, summary: null });

  const loadingRef = useRef<Set<string>>(new Set());

  const update = useCallback((appId: string | null, summary: GameAchievementsSummary | null) => {
    setState({ appId, summary });
  }, []);

  const latestAppIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!appIdStr) {
      latestAppIdRef.current = null;
      update(null, null);
      return;
    }

    const current = appIdStr;
    latestAppIdRef.current = current;
    loadingRef.current.add(current);

    /* Clear immediately — effects run after render, but the render-time
       guard (state.appId !== appIdStr) already prevents stale display. */
    update(current, null);

    const fromStore = achievementStore.getSummary(current);
    if (fromStore) {
      loadingRef.current.delete(current);
      if (latestAppIdRef.current !== current) return;
      log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][LOAD] appid=${current} source=store`);
      update(current, fromStore);
    } else {
      const snap = getCachedSnapshot();
      const snapGame = snap?.library?.games?.find(g => g.appId === current);
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
        log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][LOAD] appid=${current} source=snapshot`);
        update(current, fromSnap);
      } else {
        loadingRef.current.delete(current);
        if (latestAppIdRef.current !== current) return;
        log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][MISS] appid=${current} reason=no-store-no-snapshot`);
      }
    }

    const unsub = achievementStore.subscribe((subAppId, subSummary) => {
      if (subAppId !== current) return;
      if (latestAppIdRef.current !== current) {
        log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][IGNORE_STALE] updateAppId=${subAppId} currentAppId=${latestAppIdRef.current}`);
        return;
      }
      log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][SUB] appid=${subAppId} unlocked=${subSummary?.unlocked}/${subSummary?.total}`);
      update(subAppId, subSummary);
    });
    return () => {
      unsub();
      loadingRef.current.delete(current);
    };
  }, [appIdStr, update]);

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
    log(DEBUG_CONSOLE_ACH, `[CONSOLE_ACH][DERIVED] appid=${appIdStr} unlocked=${unlocked}/${total} percent=${percent}`);
    achievementStore.setSummary(appIdStr, patched, "steam-official");
    update(appIdStr, patched);
  }, [appIdStr, state, update]);

  /* ── Render-time guard: only return data if it belongs to current appId ── */
  const achievementsSummary = state.appId === appIdStr ? state.summary : null;

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
