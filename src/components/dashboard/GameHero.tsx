import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Gamepad2, Loader2, Play, Square, Sparkles, Store, XCircle } from "lucide-react";
import { getCachedSnapshot, subscribeSnapshotUpdated } from "../../services/startupSnapshotService";
import type { SnapshotGame } from "../../services/startupSnapshotService";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useGameSession } from "../../context/GameSessionContext";
import type { GameSessionState, RunningGameSession } from "../../context/GameSessionContext";
import { useFavorites } from "../../context/FavoritesContext";
import { getPlaytimeEntryByAppId, getPlaytimeSecondsForAppId, resolvePlaytimeKey, getPlaytimeEntryByGameKey } from "../../services/playtimeService";
import { resolveDashboardTitles, resolveGameMediaUrl, isPendingUninstall, clearPendingUninstall, subscribePendingUninstall, getPendingUninstallVersion } from "../../services/gameCacheService";
import { localPathToUrl, isLocalPath } from "../../services/gameCacheService";
import { setAmbientSource, clearAmbientSource } from "../../services/ambientBackgroundStore";
import { subscribeHeroTransition, getHeroTransitionSnapshot } from "../../services/heroTransitionStore";
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import { focusGameWindow } from "../../services/tauri";
import { showInfo, showWarning } from "../toast/GameToast";
import { useDownloadQueueContext } from "../../context/DownloadQueueContext";
import { useSettings } from "../../context/SettingsContext";
import AsyncImage from "../common/AsyncImage";
import StopGameModal from "../library/StopGameModal";
import type { AppPage } from "../../types/navigation";
import type { LibraryGame } from "../../types/libraryGame";

type GameHeroProps = {
  onNavigate?: (page: AppPage) => void;
};

type HeroGameResult = {
  game: SnapshotGame | null;
  sessionKey: string | null;
  /** When set, the hero is a manual LibraryGame (not in snapshot) */
  manualGame?: LibraryGame;
  /** When set, the hero is an Epic LibraryGame */
  epicGame?: LibraryGame;
};

function formatElapsed(startedAt: number): string {
  const diff = Date.now() - startedAt;
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatLastPlayed(timestamp?: number | null): string | null {
  if (timestamp == null || timestamp <= 0) return null;
  const diff = Date.now() - timestamp * 1000;
  if (diff < 0) return null;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

function hasValidMedia(game: SnapshotGame): boolean {
  const m = game.media;
  if (!m) return false;
  return !!(m.landscapePath || m.coverPath || m.backgroundPath || m.logoPath || m.iconPath);
}

function hasManualValidMedia(game: LibraryGame): boolean {
  return !!(game.imageUrl || game.iconPath || game.coverPath || game.landscapePath || game.backgroundPath);
}

function getEffectiveLastPlayedMs(game: SnapshotGame): number {
  const entry = getPlaytimeEntryByAppId(game.appId);
  if (entry?.lastPlayedAt) return entry.lastPlayedAt * 1000;
  if (game.lastPlayed) return game.lastPlayed * 1000;
  return 0;
}

// ─── FIX 2+3: Provider-neutral session + canonical game resolution ──────────

type ActiveSessionInfo = { sessionMapKey: string; gameKey: string; state: ActiveGameState };

type ActiveGameState = GameSessionState;

/** Find the highest-priority active session. Returns sessionMapKey (for getState/getSession) + gameKey. */
function findActiveSession(
  sessions: Record<string, RunningGameSession>,
): ActiveSessionInfo | null {
  const priority: ActiveGameState[] = ["running", "launching", "stopping"];
  for (const targetState of priority) {
    for (const [sessionMapKey, s] of Object.entries(sessions)) {
      if (s.state === targetState) {
        return { sessionMapKey, gameKey: s.gameKey, state: s.state };
      }
    }
  }
  return null;
}

/** Resolve a session's gameKey to a canonical LibraryGame from the full libraryGames collection. */
function resolveRunningLibraryGame(
  gameKey: string,
  libraryGames: LibraryGame[],
): LibraryGame | null {
  // Priority 1: libraryId
  const byLibraryId = libraryGames.find((g) => g.libraryId === gameKey);
  if (byLibraryId) return byLibraryId;

  // Priority 2: id
  const byId = libraryGames.find((g) => g.id === gameKey);
  if (byId) return byId;

  // Priority 3: providerId:providerGameId
  const byProvider = libraryGames.find(
    (g) => g.providerId && g.providerGameId && `${g.providerId}:${g.providerGameId}` === gameKey,
  );
  if (byProvider) return byProvider;

  // Priority 4: legacy Steam — app-${appId}
  const bySteamKey = libraryGames.find((g) => g.appId && `app-${g.appId}` === gameKey);
  if (bySteamKey) return bySteamKey;

  // Priority 5: raw Steam appId
  const byAppId = libraryGames.find((g) => g.appId === gameKey);
  if (byAppId) return byAppId;

  return null;
}

// ─── Non-running hero selection (kept for favorites, continue playing, etc.) ─

type HeroCandidate = { type: "snapshot" | "manual" | "epic"; game: SnapshotGame | LibraryGame; sourceIndex: number };

function buildManualPlaytime(manualGames: LibraryGame[]) {
  const map = new Map<string, { lastPlayedAt: number; totalSeconds: number }>();
  for (const mg of manualGames) {
    const ptKey = resolvePlaytimeKey(mg);
    const entry = ptKey ? getPlaytimeEntryByGameKey(ptKey) : null;
    if (entry) map.set(mg.id, { lastPlayedAt: entry.lastPlayedAt ?? 0, totalSeconds: entry.totalPlaytimeSeconds });
  }
  return map;
}

function buildEpicPlaytime(epicGames: LibraryGame[]) {
  const map = new Map<string, { lastPlayedAt: number; totalSeconds: number }>();
  for (const eg of epicGames) {
    const ptKey = resolvePlaytimeKey(eg);
    const entry = ptKey ? getPlaytimeEntryByGameKey(ptKey) : null;
    if (entry) map.set(eg.id, { lastPlayedAt: entry.lastPlayedAt ?? 0, totalSeconds: entry.totalPlaytimeSeconds });
  }
  return map;
}

/** Build candidates from selected hero sources in source-priority order. */
function buildHeroCandidates(
  snapshotGames: SnapshotGame[],
  favoriteIds: Set<string>,
  manualGames: LibraryGame[],
  epicGames: LibraryGame[],
  heroSources: string[],
): HeroCandidate[] {
  const manualPlaytime = buildManualPlaytime(manualGames);
  const epicPlaytime = buildEpicPlaytime(epicGames);
  const candidates: HeroCandidate[] = [];

  for (let si = 0; si < heroSources.length; si++) {
    const sourceId = heroSources[si];
    switch (sourceId) {
      case "continuePlaying": {
        const all: HeroCandidate[] = [];
        for (const g of snapshotGames) {
          if (g.appId && g.title) {
            const lp = getEffectiveLastPlayedMs(g);
            if (lp > 0) all.push({ type: "snapshot", game: g, sourceIndex: si });
          }
        }
        for (const mg of manualGames) {
          if (!mg.title) continue;
          const mp = manualPlaytime.get(mg.id);
          const lp = (mp?.lastPlayedAt ?? 0) * 1000;
          if (lp > 0) all.push({ type: "manual", game: mg, sourceIndex: si });
        }
        for (const eg of epicGames) {
          if (!eg.title) continue;
          const ep = epicPlaytime.get(eg.id);
          const lp = (ep?.lastPlayedAt ?? 0) * 1000;
          if (lp > 0) all.push({ type: "epic", game: eg, sourceIndex: si });
        }
        all.sort((a, b) => {
          const aLp = a.type === "snapshot" ? getEffectiveLastPlayedMs(a.game as SnapshotGame) : (a.type === "epic" ? ((epicPlaytime.get((a.game as LibraryGame).id)?.lastPlayedAt ?? 0) * 1000) : ((manualPlaytime.get((a.game as LibraryGame).id)?.lastPlayedAt ?? 0) * 1000));
          const bLp = b.type === "snapshot" ? getEffectiveLastPlayedMs(b.game as SnapshotGame) : (b.type === "epic" ? ((epicPlaytime.get((b.game as LibraryGame).id)?.lastPlayedAt ?? 0) * 1000) : ((manualPlaytime.get((b.game as LibraryGame).id)?.lastPlayedAt ?? 0) * 1000));
          return bLp - aLp;
        });
        candidates.push(...all);
        break;
      }
      case "favorites": {
        for (const g of snapshotGames) {
          if (g.appId && favoriteIds.has(g.appId) && hasValidMedia(g)) {
            candidates.push({ type: "snapshot", game: g, sourceIndex: si });
          }
        }
        for (const mg of manualGames) {
          const favKey = mg.libraryId || mg.id;
          if (favoriteIds.has(favKey) && hasManualValidMedia(mg)) {
            candidates.push({ type: "manual", game: mg, sourceIndex: si });
          }
        }
        for (const eg of epicGames) {
          const favKey = eg.libraryId || eg.id;
          if (favoriteIds.has(favKey) && hasManualValidMedia(eg)) {
            candidates.push({ type: "epic", game: eg, sourceIndex: si });
          }
        }
        break;
      }
      case "recentlyPlayed": {
        const all: HeroCandidate[] = [];
        for (const g of snapshotGames) {
          if (g.appId && g.title) {
            const lp = getEffectiveLastPlayedMs(g);
            if (lp > 0) all.push({ type: "snapshot", game: g, sourceIndex: si });
          }
        }
        for (const mg of manualGames) {
          if (!mg.title) continue;
          const mp = manualPlaytime.get(mg.id);
          const lp = (mp?.lastPlayedAt ?? 0) * 1000;
          if (lp > 0) all.push({ type: "manual", game: mg, sourceIndex: si });
        }
        for (const eg of epicGames) {
          if (!eg.title) continue;
          const ep = epicPlaytime.get(eg.id);
          const lp = (ep?.lastPlayedAt ?? 0) * 1000;
          if (lp > 0) all.push({ type: "epic", game: eg, sourceIndex: si });
        }
        all.sort((a, b) => {
          const aLp = a.type === "snapshot" ? getEffectiveLastPlayedMs(a.game as SnapshotGame) : (a.type === "epic" ? ((epicPlaytime.get((a.game as LibraryGame).id)?.lastPlayedAt ?? 0) * 1000) : ((manualPlaytime.get((a.game as LibraryGame).id)?.lastPlayedAt ?? 0) * 1000));
          const bLp = b.type === "snapshot" ? getEffectiveLastPlayedMs(b.game as SnapshotGame) : (b.type === "epic" ? ((epicPlaytime.get((b.game as LibraryGame).id)?.lastPlayedAt ?? 0) * 1000) : ((manualPlaytime.get((b.game as LibraryGame).id)?.lastPlayedAt ?? 0) * 1000));
          return bLp - aLp;
        });
        candidates.push(...all);
        break;
      }
      case "topPlayed": {
        const all: HeroCandidate[] = [];
        for (const g of snapshotGames) {
          if (g.appId && g.title) {
            all.push({ type: "snapshot", game: g, sourceIndex: si });
          }
        }
        for (const mg of manualGames) {
          if (!mg.title) continue;
          all.push({ type: "manual", game: mg, sourceIndex: si });
        }
        for (const eg of epicGames) {
          if (!eg.title) continue;
          all.push({ type: "epic", game: eg, sourceIndex: si });
        }
        all.sort((a, b) => {
          const aSec = a.type === "snapshot" ? getPlaytimeSecondsForAppId((a.game as SnapshotGame).appId) : (a.type === "epic" ? (epicPlaytime.get((a.game as LibraryGame).id)?.totalSeconds ?? 0) : (manualPlaytime.get((a.game as LibraryGame).id)?.totalSeconds ?? 0));
          const bSec = b.type === "snapshot" ? getPlaytimeSecondsForAppId((b.game as SnapshotGame).appId) : (b.type === "epic" ? (epicPlaytime.get((b.game as LibraryGame).id)?.totalSeconds ?? 0) : (manualPlaytime.get((b.game as LibraryGame).id)?.totalSeconds ?? 0));
          return bSec - aSec;
        });
        candidates.push(...all);
        break;
      }
      case "recommended": {
        for (const g of snapshotGames) {
          if (g.appId && g.title && hasValidMedia(g)) {
            candidates.push({ type: "snapshot", game: g, sourceIndex: si });
          }
        }
        break;
      }
      case "featured": {
        for (const g of snapshotGames) {
          if (g.appId && g.title && hasValidMedia(g)) {
            candidates.push({ type: "snapshot", game: g, sourceIndex: si });
          }
        }
        break;
      }
      case "newNoteworthy": {
        for (const g of snapshotGames) {
          if (g.appId && g.title && hasValidMedia(g)) {
            candidates.push({ type: "snapshot", game: g, sourceIndex: si });
          }
        }
        break;
      }
      case "manualGames": {
        for (const mg of manualGames) {
          if (mg.title && hasManualValidMedia(mg)) {
            candidates.push({ type: "manual", game: mg, sourceIndex: si });
          }
        }
        for (const eg of epicGames) {
          if (eg.title && hasManualValidMedia(eg)) {
            candidates.push({ type: "epic", game: eg, sourceIndex: si });
          }
        }
        break;
      }
      case "steamGames": {
        for (const g of snapshotGames) {
          if (g.appId && g.title) {
            candidates.push({ type: "snapshot", game: g, sourceIndex: si });
          }
        }
        break;
      }
      // "collections" — disabled, no candidates
    }
  }

  return candidates;
}

function pickNonRunningHero(
  snapshotGames: SnapshotGame[],
  _favoriteIds: Set<string>,
  manualGames: LibraryGame[],
  epicGames: LibraryGame[],
  _heroSources: string[],
  heroAutoRotate: boolean,
  rotateIndex: number,
  heroCandidates: HeroCandidate[],
): HeroGameResult {
  // Auto-rotate: pick from candidates by rotate index
  if (heroAutoRotate && heroCandidates.length > 0) {
    const idx = rotateIndex % heroCandidates.length;
    const c = heroCandidates[idx];
    if (c.type === "snapshot") return { game: c.game as SnapshotGame, sessionKey: null };
    if (c.type === "epic") return { game: null, sessionKey: null, epicGame: c.game as LibraryGame };
    return { game: null, sessionKey: null, manualGame: c.game as LibraryGame };
  }

  // Single pick: first candidate from selected sources
  if (heroCandidates.length > 0) {
    const c = heroCandidates[0];
    if (c.type === "snapshot") return { game: c.game as SnapshotGame, sessionKey: null };
    if (c.type === "epic") return { game: null, sessionKey: null, epicGame: c.game as LibraryGame };
    return { game: null, sessionKey: null, manualGame: c.game as LibraryGame };
  }

  // Fallback: first installed game with title
  const installedGame = snapshotGames.find((game) => game.installed && game.title);
  if (installedGame) return { game: installedGame, sessionKey: null };

  if (manualGames.length > 0 && manualGames[0].title) {
    return { game: null, sessionKey: null, manualGame: manualGames[0] };
  }

  if (epicGames.length > 0 && epicGames[0].title) {
    return { game: null, sessionKey: null, epicGame: epicGames[0] };
  }

  const titledGame = snapshotGames.find((game) => game.title);
  if (titledGame) return { game: titledGame, sessionKey: null };

  return { game: snapshotGames[0] || null, sessionKey: null };
}

function EmptyHero({ onNavigate }: GameHeroProps) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-(--color-accent)/10 via-purple-900/20 to-black">
      <div className="relative z-10 flex flex-col items-center justify-center px-8 py-20 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-4 py-1.5 text-xs text-(--color-accent)">
          <Sparkles className="h-3.5 w-3.5" />
          LumaForge
        </div>

        <h1 className="text-4xl font-bold tracking-tight text-(--color-text)">
          Your Game Launcher
        </h1>

        <p className="mt-2 max-w-lg text-sm text-(--color-muted)">
          Discover, manage, and play your games with Lua modding support.
        </p>

        <div className="mt-6 flex gap-3">
          <button
            onClick={() => onNavigate?.("store")}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-(--color-accent) px-5 py-3 text-sm font-medium text-(--color-accent-text) transition hover:opacity-90"
          >
            <Store className="h-4 w-4" />
            Browse Store
          </button>

          <button
            onClick={() => onNavigate?.("library")}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/6 px-5 py-3 text-sm text-(--color-text) backdrop-blur-xl transition hover:bg-white/10"
          >
            <Gamepad2 className="h-4 w-4" />
            Open Library
          </button>
        </div>
      </div>
    </section>
  );
}

export default function GameHero({ onNavigate }: GameHeroProps) {
  const snapshot = getCachedSnapshot();
  const [, setSnapshotWriteVersion] = useState(0);
  const { settings } = useSettings();

  // Re-read snapshot after background snapshot writes (playtime/lastPlayed updates)
  useEffect(() => {
    const unsub = subscribeSnapshotUpdated(() => setSnapshotWriteVersion(v => v + 1));
    return unsub;
  }, []);

  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const { favoriteIds } = useFavorites();

  const {
    sessions,
    getState,
    getSession,
    stopSession,
    clearSession,
    findGameProcessForSession,
  } = useGameSession();

  const [elapsed, setElapsed] = useState("");
  const [showStopModal, setShowStopModal] = useState(false);

  const snapshotGames = useMemo(() => {
    return snapshot?.library?.games ?? [];
  }, [snapshot]);

  const manualGames = useMemo(
    () => libraryGames.filter((g) => g.source === "manual" && g.title),
    [libraryGames],
  );

  const epicGames = useMemo(
    () => libraryGames.filter((g) => g.source === "epic" && g.title),
    [libraryGames],
  );

  // Hero sources from settings
  const heroSources = settings.dashboardHeroSources ?? ["continuePlaying", "favorites"];
  const heroAutoRotate = settings.dashboardHeroAutoRotate ?? false;
  const heroRotateSeconds = settings.dashboardHeroRotateSeconds ?? 15;

  // ─── FIX 2: Active session lookup — searches sessions by state priority ──
  const activeSession = useMemo(() => findActiveSession(sessions), [sessions]);

  // ─── FIX 2: Resolve running game from full libraryGames via gameKey ──────
  const runningLibGame = useMemo(
    () => activeSession?.gameKey ? resolveRunningLibraryGame(activeSession.gameKey, libraryGames) : null,
    [activeSession, libraryGames],
  );

  // Build candidates from selected hero sources (for non-running rotate + single-pick)
  const heroCandidates = useMemo(() => {
    return buildHeroCandidates(snapshotGames, favoriteIds, manualGames, epicGames, heroSources);
  }, [snapshotGames, favoriteIds, manualGames, epicGames, heroSources]);

  // Auto-rotate state
  const [rotateIndex, setRotateIndex] = useState(0);
  const rotateIndexRef = useRef(0);

  // Reset rotate index when sources change
  const heroSourcesKey = heroSources.join(",");
  useEffect(() => {
    setRotateIndex(0);
    rotateIndexRef.current = 0;
  }, [heroSourcesKey]);

  // Auto-rotate timer
  useEffect(() => {
    if (!heroAutoRotate || heroCandidates.length <= 1) return;
    const interval = window.setInterval(() => {
      rotateIndexRef.current = (rotateIndexRef.current + 1) % heroCandidates.length;
      setRotateIndex(rotateIndexRef.current);
    }, heroRotateSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [heroAutoRotate, heroRotateSeconds, heroCandidates.length]);

  // Non-running hero selection (favorites, continue playing, etc.)
  const { game: heroGame, manualGame: heroManualGame, epicGame: heroEpicGame } = useMemo<HeroGameResult>(() => {
    return pickNonRunningHero(snapshotGames, favoriteIds, manualGames, epicGames, heroSources, heroAutoRotate, rotateIndex, heroCandidates);
  }, [snapshotGames, favoriteIds, manualGames, epicGames, heroSources, heroCandidates, heroAutoRotate, rotateIndex]);

  // ─── FIX 3: Unified sessionKey — running session always wins ────────────
  const sessionKey = activeSession?.sessionMapKey ?? null;

  // Read session state from the single source of truth
  const heroGameState: GameSessionState = sessionKey ? getState(sessionKey) : "idle";
  const heroSession = sessionKey ? getSession(sessionKey) : undefined;

  const isRunning = heroGameState === "running";
  const isStopping = heroGameState === "stopping";
  const isLaunching = heroGameState === "launching";
  const hasActiveSession = isRunning || isStopping || isLaunching;

  const heroAppId = heroGame?.appId;
  const { getJobByAppId } = useDownloadQueueContext();
  const heroInstallJob = heroAppId ? getJobByAppId(heroAppId) : undefined;
  const activeInstallStatuses = ["queued", "waiting", "checking", "downloading", "extracting", "installing", "paused"];
  const hasActiveInstall = heroInstallJob?.type === "steam-install" && activeInstallStatuses.includes(heroInstallJob.status);
  // Subscribe to pending uninstall state changes so React re-renders when the module-level Map changes
  useSyncExternalStore(subscribePendingUninstall, getPendingUninstallVersion, getPendingUninstallVersion);
  const heroPendingUninstall = heroAppId ? isPendingUninstall(heroAppId) : false;
  // Subscribe to the selectable hero/background transition (Settings → Animaciones)
  useSyncExternalStore(subscribeHeroTransition, getHeroTransitionSnapshot, getHeroTransitionSnapshot);
  const heroTransition = getHeroTransitionSnapshot().id;
  const heroBgClass =
    heroTransition === "kenburns"
      ? "animate-hero-kenburns"
      : heroTransition === "focus"
        ? "animate-hero-focus-in"
        : "animate-hero-crossfade-in";

  // ─── FIX 4: libGame — running takes absolute priority ──────────────────
  const libGame = useMemo(() => {
    if (runningLibGame) return runningLibGame;
    if (heroManualGame) return heroManualGame;
    if (heroEpicGame) return heroEpicGame;
    if (heroGame?.appId) return libraryGames.find((game) => game.appId === heroGame.appId);
    return undefined;
  }, [runningLibGame, heroManualGame, heroEpicGame, heroGame, libraryGames]);

  // ─── FIX 6: [RUNNING_HERO_SELECT] diagnostic log ──────────────────────
  useEffect(() => {
    const activeCount = Object.values(sessions).filter(
      (s) => s.state === "running" || s.state === "launching" || s.state === "stopping",
    ).length;
    console.log(
      `[RUNNING_HERO_SELECT] activeSessions=${activeCount}` +
      (activeSession
        ? ` selectedState=${activeSession.state} sessionGameKey=${activeSession.gameKey}`
        : " activeSession=none") +
      ` libraryGames=${libraryGames.length}` +
      (runningLibGame
        ? ` canonicalFound=true libraryId=${runningLibGame.libraryId} source=${runningLibGame.source} appId=${runningLibGame.appId ?? "none"}`
        : activeSession
          ? " canonicalFound=false"
          : ""),
    );
  }, [sessions, activeSession, libraryGames, runningLibGame]);

  // ─── FIX 5: Hero background resolution — running game first, then non-running ──
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [sharpImgError, setSharpImgError] = useState(false);
  const bgUrlGenerationRef = useRef(0);
  useEffect(() => {
    setSharpImgError(false);
  }, [bgUrl]);
  useEffect(() => {
    let cancelled = false;
    const generation = ++bgUrlGenerationRef.current;

    async function resolveHeroBg() {
      // ── FIX 5: Running game — resolve from libGame directly ──
      if (runningLibGame) {
        const bgPath = runningLibGame.backgroundPath ?? runningLibGame.landscapePath ?? runningLibGame.coverPath ?? runningLibGame.imageUrl ?? null;
        const role = bgPath === runningLibGame.backgroundPath ? "background"
          : bgPath === runningLibGame.landscapePath ? "landscape"
          : bgPath === runningLibGame.coverPath ? "cover"
          : "imageUrl";
        console.log(`[RUNNING_HERO_MEDIA] role=${role} raw=${bgPath}`);

        if (!bgPath) {
          if (!cancelled) {
            setBgUrl(null);
            clearAmbientSource("dashboard");
          }
          return;
        }

        try {
          let url: string | null = null;
          const isNonSteamRunning = runningLibGame.source && runningLibGame.source !== "steam" && runningLibGame.source !== "lua";
          if (isNonSteamRunning) {
            // Manual/debrid/Epic — media lives at appData/media/ (flat), NOT under games/steam/<appId>/
            const { resolveProviderMediaPreviewUrl } = await import("../../services/gameCacheService");
            url = await resolveProviderMediaPreviewUrl(bgPath);
          } else if (runningLibGame.appId) {
            // Steam game — resolve via appId
            url = await resolveGameMediaUrl(runningLibGame.appId, bgPath);
          } else {
            const { resolveProviderMediaPreviewUrl } = await import("../../services/gameCacheService");
            url = await resolveProviderMediaPreviewUrl(bgPath);
          }
          console.log(`[RUNNING_HERO_MEDIA] resolvedUrl=${url} src=${runningLibGame.source} isNonSteam=${isNonSteamRunning}`);
          console.log(`[DASH][HERO] branch=running title="${runningLibGame.title}" appId=${runningLibGame.appId} src=${runningLibGame.source} bgPath=${bgPath} role=${role} resolved=${url ?? "NULL"}`);
          if (!cancelled && generation === bgUrlGenerationRef.current) {
            setBgUrl(url);
            setAmbientSource("dashboard", url);
          }
        } catch {
          if (!cancelled && generation === bgUrlGenerationRef.current) {
            setBgUrl(null);
            clearAmbientSource("dashboard");
          }
        }
        return;
      }

      // Non-running: Manual/Epic game — resolve relative provider media path
      const nonSnapshot = heroManualGame ?? heroEpicGame;
      if (nonSnapshot) {
        const candidates = [
          { role: "backgroundPath", value: nonSnapshot.backgroundPath },
          { role: "landscapePath", value: nonSnapshot.landscapePath },
          { role: "coverPath", value: nonSnapshot.coverPath },
          { role: "imageUrl", value: nonSnapshot.imageUrl },
        ];
        const selected = candidates.find((c) => c.value) ?? null;
        const rawPath = selected?.value ?? null;

        if (rawPath) {
          try {
            const { resolveProviderMediaPreviewUrl } = await import("../../services/gameCacheService");
            const url = await resolveProviderMediaPreviewUrl(rawPath);
            console.log(`[DASH][HERO] branch=nonRunning title="${nonSnapshot.title}" appId=${nonSnapshot.appId} src=${nonSnapshot.source} rawPath=${rawPath} selectedRole=${selected?.role} resolved=${url ?? "NULL"}`);
            if (!cancelled && generation === bgUrlGenerationRef.current) {
              setBgUrl(url);
              setAmbientSource("dashboard", url);
            }
          } catch {
            if (!cancelled && generation === bgUrlGenerationRef.current) {
              setBgUrl(null);
              clearAmbientSource("dashboard");
            }
          }
          return;
        }
        // No media on manual/Epic game → find snapshot by appId
        // pickNonRunningHero returns {game:null} for manual games so heroGame is null,
        // but snapshotGames HAS the game with media.backgroundPath = "media/background.jpg".
        if (nonSnapshot.appId) {
          const snapGame = snapshotGames.find((s) => s.appId === nonSnapshot.appId);
          const imgPath = snapGame?.media?.backgroundPath ?? snapGame?.media?.landscapePath ?? snapGame?.media?.coverPath ?? null;
          if (imgPath) {
            try {
              const url = await resolveGameMediaUrl(nonSnapshot.appId, imgPath);
              console.log(`[DASH][HERO] branch=nonRunning→snapshot title="${nonSnapshot.title}" appId=${nonSnapshot.appId} imgPath=${imgPath} resolved=${url ?? "NULL"}`);
              if (!cancelled && generation === bgUrlGenerationRef.current) {
                setBgUrl(url);
                setAmbientSource("dashboard", url);
              }
            } catch {
              if (!cancelled && generation === bgUrlGenerationRef.current) {
                setBgUrl(null);
                clearAmbientSource("dashboard");
              }
            }
            return;
          }
        }
        console.log(`[DASH][HERO] branch=nonRunning title="${nonSnapshot.title}" appId=${nonSnapshot.appId} src=${nonSnapshot.source} rawPath=NULL noSnapshotMedia either`);
      }

      // Snapshot game — resolve via appId
      if (heroAppId && heroGame) {
        const m = heroGame.media;
        const imgPath = m?.backgroundPath ?? m?.landscapePath ?? m?.coverPath ?? null;
        if (!imgPath) {
          console.log(`[DASH][HERO] branch=snapshot title="${heroGame.title}" appId=${heroAppId} src=${heroGame.source} imgPath=NULL (no media)`);
          if (!cancelled) {
            setBgUrl(null);
            clearAmbientSource("dashboard");
          }
          return;
        }
        try {
          const url = await resolveGameMediaUrl(heroAppId, imgPath);
          console.log(`[DASH][HERO] branch=snapshot title="${heroGame.title}" appId=${heroAppId} imgPath=${imgPath} resolved=${url ?? "NULL"}`);
          if (!cancelled && generation === bgUrlGenerationRef.current) {
            setBgUrl(url);
            setAmbientSource("dashboard", url);
          }
        } catch {
          if (!cancelled && generation === bgUrlGenerationRef.current) {
            setBgUrl(null);
            clearAmbientSource("dashboard");
          }
        }
        return;
      }

      if (!cancelled) setBgUrl(null);
    }

    resolveHeroBg();
    return () => { cancelled = true; };
  }, [runningLibGame, heroAppId, heroGame?.media?.backgroundPath, heroGame?.media?.landscapePath, heroGame?.media?.coverPath, heroManualGame, heroEpicGame]);

  // ─── Ambient background: feed resolved hero art + clear on unmount ──
  useEffect(() => {
    return () => clearAmbientSource("dashboard");
  }, []);

  // ─── Ambient: synchronous first-paint feed from raw in-memory media so the
  // background never goes stale/blank during the async resolution window above.
  // Relative provider paths (games/, media/, img/) are skipped — the async effect
  // resolves those and upgrades the feed. ──
  useEffect(() => {
    const raw = runningLibGame
      ? (runningLibGame.backgroundPath ?? runningLibGame.landscapePath ?? runningLibGame.coverPath ?? runningLibGame.imageUrl ?? null)
      : (heroManualGame ?? heroEpicGame)
        ? (heroManualGame?.backgroundPath ?? heroManualGame?.landscapePath ?? heroManualGame?.coverPath ?? heroManualGame?.imageUrl
          ?? heroEpicGame?.backgroundPath ?? heroEpicGame?.landscapePath ?? heroEpicGame?.coverPath ?? heroEpicGame?.imageUrl
          ?? null)
        : heroGame
          ? (heroGame.media?.backgroundPath ?? heroGame.media?.landscapePath ?? heroGame.media?.coverPath ?? null)
          : null;
    if (!raw) return;
    if (raw.startsWith("games/") || raw.startsWith("media/") || raw.startsWith("img/")) return;
    const url = isLocalPath(raw) ? (localPathToUrl(raw) ?? undefined) : raw;
    if (url) setAmbientSource("dashboard", url);
  }, [runningLibGame, heroAppId, heroGame?.media?.backgroundPath, heroGame?.media?.landscapePath, heroGame?.media?.coverPath, heroManualGame, heroEpicGame]);

  const [heroTitle, setHeroTitle] = useState<string>("");
  useEffect(() => {
    let cancelled = false;

    // Running game — use libGame title directly
    if (runningLibGame) {
      setHeroTitle(runningLibGame.title);
      return () => { cancelled = true; };
    }

    const activeNonSnapshot = heroManualGame ?? heroEpicGame;
    if (activeNonSnapshot) {
      setHeroTitle(activeNonSnapshot.title);
      return () => { cancelled = true; };
    }

    // Snapshot game — resolve title from canonical source
    if (heroAppId && heroGame) {
      resolveDashboardTitles([heroGame]).then((r: Record<string, { title: string; source: string }>) => {
        if (!cancelled) {
          const entry = r[heroAppId!];
          const resolved = entry?.title;
          setHeroTitle(resolved ?? heroGame!.title);
        }
      });
    }
    return () => { cancelled = true; };
  }, [runningLibGame, heroGame, heroAppId, heroManualGame, heroEpicGame]);

  const lastPlayedStr = useMemo(() => {
    // Running game — use libGame playtime
    if (runningLibGame) {
      const ptKey = resolvePlaytimeKey(runningLibGame);
      const entry = ptKey ? getPlaytimeEntryByGameKey(ptKey) : null;
      if (entry?.lastPlayedAt) return formatLastPlayed(entry.lastPlayedAt);
      return null;
    }

    const activeNonSnapshot = heroManualGame ?? heroEpicGame;
    if (activeNonSnapshot) {
      const ptKey = resolvePlaytimeKey(activeNonSnapshot);
      const entry = ptKey ? getPlaytimeEntryByGameKey(ptKey) : null;
      if (entry?.lastPlayedAt) return formatLastPlayed(entry.lastPlayedAt);
      return null;
    }
    const entry = getPlaytimeEntryByAppId(heroAppId);
    if (entry?.lastPlayedAt) return formatLastPlayed(entry.lastPlayedAt);
    return formatLastPlayed(heroGame?.lastPlayed);
  }, [runningLibGame, heroAppId, heroGame?.lastPlayed, heroManualGame, heroEpicGame]);

  const heroPlaytimeStr = useMemo(() => {
    // Running game — use libGame playtime
    if (runningLibGame) {
      const ptKey = resolvePlaytimeKey(runningLibGame);
      const entry = ptKey ? getPlaytimeEntryByGameKey(ptKey) : null;
      const seconds = entry?.totalPlaytimeSeconds ?? 0;
      if (seconds > 0) return `${Math.round(seconds / 60)} min`;
      return null;
    }

    const activeNonSnapshot = heroManualGame ?? heroEpicGame;
    if (activeNonSnapshot) {
      const ptKey = resolvePlaytimeKey(activeNonSnapshot);
      const entry = ptKey ? getPlaytimeEntryByGameKey(ptKey) : null;
      const seconds = entry?.totalPlaytimeSeconds ?? 0;
      if (seconds > 0) return `${Math.round(seconds / 60)} min`;
      return null;
    }
    const seconds = getPlaytimeSecondsForAppId(heroAppId);
    if (seconds > 0) return `${Math.round(seconds / 60)} min`;
    if (heroGame?.playtime != null) return `${heroGame.playtime} min`;
    return null;
  }, [runningLibGame, heroAppId, heroGame?.playtime, heroManualGame, heroEpicGame]);

  const stopModalTitle = heroSession?.title || libGame?.title || heroGame?.title || heroEpicGame?.title || heroManualGame?.title || "Unknown Game";

  // Elapsed timer (only when session is running)
  useEffect(() => {
    if (!isRunning || !heroSession?.launchedAt) {
      setElapsed("");
      return;
    }

    setElapsed(formatElapsed(heroSession.launchedAt));

    const interval = window.setInterval(() => {
      setElapsed(formatElapsed(heroSession.launchedAt!));
    }, 10000);

    return () => {
      window.clearInterval(interval);
    };
  }, [isRunning, heroSession?.launchedAt]);

  // HERO priority: load game data at highest priority immediately
  useEffect(() => {
    const appId = runningLibGame?.appId ?? heroAppId;
    if (appId) {
      void requestGameData(appId, LoadPriority.HERO);
    }
  }, [runningLibGame?.appId, heroAppId]);

  const handlePrimaryAction = useCallback(async () => {
    if (isRunning && heroSession?.pid) {
      focusGameWindow(heroSession.pid).catch(() => {
        if (libGame) {
          setSelectedGame(libGame);
          onNavigate?.("library-game-detail");
        }
      });
      return;
    }

    // Soft session — no PID stored, but game is running. Try to find PID now.
    if (isRunning && sessionKey) {
      try {
        const candidate = await findGameProcessForSession(sessionKey);
        if (candidate) {
          focusGameWindow(candidate.pid).catch(() => {});
          return;
        }
      } catch { /* fall through to navigate */ }
    }

    if (libGame) {
      setSelectedGame(libGame);
      onNavigate?.("library-game-detail");
      return;
    }

    if (heroGame?.appId) {
      onNavigate?.("store");
    }
  }, [heroGame, isRunning, heroSession, sessionKey, libGame, setSelectedGame, onNavigate, findGameProcessForSession]);

  const handleOpenStopModal = useCallback(() => {
    if (!sessionKey) return;
    setShowStopModal(true);
  }, [sessionKey]);

  const handleCloseStopModal = useCallback(() => {
    setShowStopModal(false);
  }, []);

  const handleConfirmStop = useCallback(async () => {
    setShowStopModal(false);
    if (sessionKey) {
      await stopSession(sessionKey);
    }
  }, [sessionKey, stopSession]);

  const handleMarkAsStopped = useCallback(() => {
    setShowStopModal(false);
    if (sessionKey) {
      clearSession(sessionKey);
    }
  }, [sessionKey, clearSession]);

  const handleFindProcess = useCallback(async () => {
    if (!sessionKey) return;
    const candidate = await findGameProcessForSession(sessionKey);
    if (candidate) {
      showWarning(`Found process: ${candidate.name} (PID ${candidate.pid})`, {
        title: "Process Found",
      });
      return;
    }
    showWarning("Could not find the game process automatically.", {
      title: "Not Found",
    });
  }, [sessionKey, findGameProcessForSession]);

  // MUST be declared BEFORE the early return to keep hook count stable across renders.
  const heroSectionRef = useCallback((_node: HTMLElement | null) => {}, []);

  // ─── FIX 4: Never return EmptyHero when an active session exists ──────
  if (!libGame && !activeSession) {
    return <EmptyHero onNavigate={onNavigate} />;
  }

  return (
    <section ref={heroSectionRef} className="relative -mt-14 min-h-[300px] overflow-hidden rounded-2xl sm:min-h-[380px] lg:min-h-[440px] xl:min-h-[480px]">
      {/* Layer 1 — Blurred backdrop (full-bleed color field) */}
      {bgUrl ? (
        <div className="absolute inset-0 overflow-hidden brightness-[0.65] saturate-[1.1]">
          <AsyncImage
            key={bgUrl}
            src={bgUrl}
            alt=""
            className="h-full w-full scale-105 blur-2xl"
            fallback={
              <div className="h-full w-full bg-gradient-to-br from-(--color-accent)/20 via-purple-900/30 to-black" />
            }
          />
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-(--color-accent)/20 via-purple-900/30 to-black" />
      )}

      {/* Layer 2 — Sharp image centered (height-driven, fades into blurred sides) */}
      {bgUrl && !sharpImgError && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center overflow-hidden">
          <img
            key={bgUrl}
            src={bgUrl}
            alt=""
            draggable={false}
            loading="eager"
            decoding="async"
            onError={() => setSharpImgError(true)}
            className={`${heroBgClass} block h-full w-auto max-w-none shrink-0 [mask-image:linear-gradient(to_right,transparent_0%,transparent_4%,black_12%,black_88%,transparent_96%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0%,transparent_4%,black_12%,black_88%,transparent_96%,transparent_100%)]`}
          />
        </div>
      )}

      {/* Layer 3 — Readability gradients */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30" />

      {!hasActiveSession && (
        <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-transparent" />
      )}

      <div className="relative z-10 flex min-h-[300px] items-end px-6 pb-8 pt-16 sm:min-h-[380px] sm:px-8 lg:min-h-[440px] xl:min-h-[480px]">
        <div className="flex-1">
          <div className="mb-3 flex items-center gap-3">
            {isRunning ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-300 backdrop-blur-sm">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  Running
                </span>
                {elapsed && (
                  <span className="text-xs text-white/60">
                    {elapsed} elapsed
                  </span>
                )}
              </>
            ) : (
              <>
                {lastPlayedStr && (
                  <span className="text-xs text-white/60">
                    Last played: {lastPlayedStr}
                  </span>
                )}
                {heroPlaytimeStr && (
                  <span className="text-xs text-white/60">
                    {heroPlaytimeStr}
                  </span>
                )}
              </>
            )}
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-lg sm:text-3xl">
            {heroTitle || libGame?.title || heroGame?.title || heroEpicGame?.title}
          </h1>

          <div className="mt-5 flex flex-wrap gap-3">
            {isStopping ? (
              <>
                <button
                  disabled
                  className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-(--color-accent) px-6 py-3 text-sm font-bold text-(--color-accent-text) opacity-60 transition"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Stopping...
                </button>
                <span className="inline-flex items-center gap-1 text-xs text-(--color-muted)">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Stopping...
                </span>
              </>
            ) : isLaunching ? (
              <>
                <button
                  disabled
                  className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-(--color-accent) px-6 py-3 text-sm font-bold text-(--color-accent-text) opacity-60 transition"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Launching...
                </button>
              </>
            ) : isRunning ? (
              <>
                <button
                  onClick={handlePrimaryAction}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-(--color-accent) px-6 py-3 text-sm font-bold text-(--color-accent-text) transition hover:bg-(--color-accent)/80 active:scale-[0.97]"
                >
                  <Play className="h-4 w-4" />
                  {heroSession?.pid ? "Focus Game" : "Ver detalles"}
                </button>
                <button
                  onClick={handleOpenStopModal}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-red-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-red-500/80 active:scale-[0.97]"
                >
                  <Square className="h-4 w-4" />
                  Stop
                </button>
              </>
            ) : heroPendingUninstall ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-2 rounded-xl bg-amber-500/10 px-5 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                  <span className="text-sm font-medium text-amber-400">Uninstalling…</span>
                </div>
                <button
                  onClick={() => {
                    if (!heroAppId) return;
                    clearPendingUninstall(heroAppId);
                    showInfo(`"${heroTitle || heroGame?.title || heroAppId}" uninstall tracking cancelled.`);
                  }}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-(--color-muted) transition hover:bg-white/5"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Cancel tracking
                </button>
              </div>
            ) : hasActiveInstall ? (
              <div className="inline-flex items-center gap-2 rounded-xl bg-amber-500/10 px-5 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                <span className="text-sm font-medium text-amber-400">
                  {heroInstallJob.status === "waiting" || heroInstallJob.status === "queued"
                    ? "Waiting for Steam\u2026"
                    : heroInstallJob.status === "downloading"
                      ? "Downloading"
                      : "Installing\u2026"}
                </span>
              </div>
            ) : (heroGame?.playable || libGame?.isPlayable) ? (
              <>
                <button
                  onClick={handlePrimaryAction}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-(--color-accent) px-6 py-3 text-sm font-bold text-(--color-accent-text) transition hover:bg-(--color-accent)/80 active:scale-[0.97]"
                >
                  <Play className="h-4 w-4" />
                  Play
                </button>
                <button
                  onClick={() => onNavigate?.("store")}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-white/6 px-5 py-3 text-sm text-white/80 backdrop-blur-sm transition hover:bg-white/10"
                >
                  <Store className="h-4 w-4" />
                  Browse Store
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handlePrimaryAction}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white/10 px-6 py-3 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/20"
                >
                  Open Details
                </button>
                <button
                  onClick={() => onNavigate?.("store")}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-white/6 px-5 py-3 text-sm text-white/80 backdrop-blur-sm transition hover:bg-white/10"
                >
                  <Store className="h-4 w-4" />
                  Browse Store
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <StopGameModal
        open={showStopModal}
        gameTitle={stopModalTitle}
        canTerminate={!!heroSession?.pid}
        isSoftSession={heroSession?.softSession ?? true}
        trackingConfidence={heroSession?.trackingConfidence}
        onClose={handleCloseStopModal}
        onConfirmStop={handleConfirmStop}
        onMarkStopped={handleMarkAsStopped}
        onFindProcess={handleFindProcess}
      />
    </section>
  );
}
