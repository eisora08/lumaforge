import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Gamepad2, Loader2, Play, Square, Sparkles, Store, XCircle } from "lucide-react";
import { getCachedSnapshot, subscribeSnapshotUpdated } from "../../services/startupSnapshotService";
import type { SnapshotGame } from "../../services/startupSnapshotService";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useGameSession } from "../../context/GameSessionContext";
import { useFavorites } from "../../context/FavoritesContext";
import { getPlaytimeEntryByAppId, getPlaytimeSecondsForAppId, resolvePlaytimeKey, getPlaytimeEntryByGameKey } from "../../services/playtimeService";
import { resolveDashboardTitles, resolveGameMediaUrl, isPendingUninstall, clearPendingUninstall, subscribePendingUninstall, getPendingUninstallVersion } from "../../services/gameCacheService";

const DEBUG_NAME_HERO = false;
const DEBUG_HERO_LOGS = false;
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import { showInfo, showWarning } from "../toast/GameToast";
import { useDownloadQueueContext } from "../../context/DownloadQueueContext";
import { useSettings } from "../../context/SettingsContext";
import AsyncImage from "../common/AsyncImage";
import StopGameModal from "../library/StopGameModal";
import type { AppPage } from "../../types/navigation";
import type { GameSessionState } from "../../context/GameSessionContext";

type GameHeroProps = {
  onNavigate?: (page: AppPage) => void;
};

type HeroGameResult = {
  game: SnapshotGame | null;
  sessionKey: string | null;
  /** When set, the hero is a manual LibraryGame (not in snapshot) */
  manualGame?: import("../../types/libraryGame").LibraryGame;
  /** When set, the hero is an Epic LibraryGame */
  epicGame?: import("../../types/libraryGame").LibraryGame;
};

function formatElapsed(startedAt: number): string {
  const diff = Date.now() - startedAt;
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);

  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatLastPlayed(timestamp?: number | null): string | null {
  if (timestamp == null) return null;
  return new Date(timestamp * 1000).toLocaleDateString();
}

function hasValidMedia(game: SnapshotGame): boolean {
  const m = game.media;
  if (!m) return false;
  return !!(m.landscapePath || m.coverPath || m.backgroundPath || m.logoPath || m.iconPath);
}

function hasManualValidMedia(game: import("../../types/libraryGame").LibraryGame): boolean {
  return !!(game.imageUrl || game.iconPath || game.coverPath || game.landscapePath || game.backgroundPath);
}

function getEffectiveLastPlayedMs(game: SnapshotGame): number {
  const entry = getPlaytimeEntryByAppId(game.appId);
  if (entry?.lastPlayedAt) return entry.lastPlayedAt * 1000;
  if (game.lastPlayed) return game.lastPlayed * 1000;
  return 0;
}

/** Always-present priority: running session game */
function findRunningHero(
  snapshotGames: SnapshotGame[],
  sessionKeysByAppId: Record<string, string>,
  manualGames: import("../../types/libraryGame").LibraryGame[],
  epicGames: import("../../types/libraryGame").LibraryGame[],
): HeroGameResult | null {
  for (const [appId, key] of Object.entries(sessionKeysByAppId)) {
    const matchingGame = snapshotGames.find((g) => g.appId === appId);
    if (matchingGame) return { game: matchingGame, sessionKey: key };
    const matchingManual = manualGames.find((g) => g.id === appId);
    if (matchingManual) return { game: null, sessionKey: key, manualGame: matchingManual };
    const matchingEpic = epicGames.find((g) => g.id === appId || g.providerGameId === appId);
    if (matchingEpic) return { game: null, sessionKey: key, epicGame: matchingEpic };
  }
  return null;
}

type HeroCandidate = { type: "snapshot" | "manual" | "epic"; game: SnapshotGame | import("../../types/libraryGame").LibraryGame; sourceIndex: number };

function buildManualPlaytime(manualGames: import("../../types/libraryGame").LibraryGame[]) {
  const map = new Map<string, { lastPlayedAt: number; totalSeconds: number }>();
  for (const mg of manualGames) {
    const ptKey = resolvePlaytimeKey(mg);
    const entry = ptKey ? getPlaytimeEntryByGameKey(ptKey) : null;
    if (entry) map.set(mg.id, { lastPlayedAt: entry.lastPlayedAt ?? 0, totalSeconds: entry.totalPlaytimeSeconds });
  }
  return map;
}

function buildEpicPlaytime(epicGames: import("../../types/libraryGame").LibraryGame[]) {
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
  manualGames: import("../../types/libraryGame").LibraryGame[],
  epicGames: import("../../types/libraryGame").LibraryGame[],
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
          const aLp = a.type === "snapshot" ? getEffectiveLastPlayedMs(a.game as SnapshotGame) : (a.type === "epic" ? ((epicPlaytime.get((a.game as import("../../types/libraryGame").LibraryGame).id)?.lastPlayedAt ?? 0) * 1000) : ((manualPlaytime.get((a.game as import("../../types/libraryGame").LibraryGame).id)?.lastPlayedAt ?? 0) * 1000));
          const bLp = b.type === "snapshot" ? getEffectiveLastPlayedMs(b.game as SnapshotGame) : (b.type === "epic" ? ((epicPlaytime.get((b.game as import("../../types/libraryGame").LibraryGame).id)?.lastPlayedAt ?? 0) * 1000) : ((manualPlaytime.get((b.game as import("../../types/libraryGame").LibraryGame).id)?.lastPlayedAt ?? 0) * 1000));
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
          const aLp = a.type === "snapshot" ? getEffectiveLastPlayedMs(a.game as SnapshotGame) : (a.type === "epic" ? ((epicPlaytime.get((a.game as import("../../types/libraryGame").LibraryGame).id)?.lastPlayedAt ?? 0) * 1000) : ((manualPlaytime.get((a.game as import("../../types/libraryGame").LibraryGame).id)?.lastPlayedAt ?? 0) * 1000));
          const bLp = b.type === "snapshot" ? getEffectiveLastPlayedMs(b.game as SnapshotGame) : (b.type === "epic" ? ((epicPlaytime.get((b.game as import("../../types/libraryGame").LibraryGame).id)?.lastPlayedAt ?? 0) * 1000) : ((manualPlaytime.get((b.game as import("../../types/libraryGame").LibraryGame).id)?.lastPlayedAt ?? 0) * 1000));
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
          const aSec = a.type === "snapshot" ? getPlaytimeSecondsForAppId((a.game as SnapshotGame).appId) : (a.type === "epic" ? (epicPlaytime.get((a.game as import("../../types/libraryGame").LibraryGame).id)?.totalSeconds ?? 0) : (manualPlaytime.get((a.game as import("../../types/libraryGame").LibraryGame).id)?.totalSeconds ?? 0));
          const bSec = b.type === "snapshot" ? getPlaytimeSecondsForAppId((b.game as SnapshotGame).appId) : (b.type === "epic" ? (epicPlaytime.get((b.game as import("../../types/libraryGame").LibraryGame).id)?.totalSeconds ?? 0) : (manualPlaytime.get((b.game as import("../../types/libraryGame").LibraryGame).id)?.totalSeconds ?? 0));
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

function findHeroGameFromSources(
  snapshotGames: SnapshotGame[],
  sessionKeysByAppId: Record<string, string>,
  favoriteIds: Set<string>,
  manualGames: import("../../types/libraryGame").LibraryGame[],
  epicGames: import("../../types/libraryGame").LibraryGame[],
  heroSources: string[],
): HeroGameResult {
  // Running session always takes priority (Part 5)
  const running = findRunningHero(snapshotGames, sessionKeysByAppId, manualGames, epicGames);
  if (running) return running;

  // Build candidates from selected sources
  const candidates = buildHeroCandidates(snapshotGames, favoriteIds, manualGames, epicGames, heroSources);
  if (candidates.length > 0) {
    const top = candidates[0];
    if (top.type === "snapshot") return { game: top.game as SnapshotGame, sessionKey: null };
    if (top.type === "epic") return { game: null, sessionKey: null, epicGame: top.game as import("../../types/libraryGame").LibraryGame };
    return { game: null, sessionKey: null, manualGame: top.game as import("../../types/libraryGame").LibraryGame };
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
    <section className="relative overflow-hidden rounded-2xl border border-(--surface-active-border) bg-gradient-to-br from-(--color-accent)/10 via-purple-900/20 to-black">
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
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-(--color-accent) px-5 py-3 text-sm font-medium text-black transition hover:opacity-90"
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

  // Build a map of appId/gameId → sessionKey for all active sessions
  // For manual games (no appId), index by gameKey ("manual:<uuid>") so findHeroGame can match g.id
  const sessionKeysByAppId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [key, s] of Object.entries(sessions)) {
      if (s.state !== "running" && s.state !== "stopping" && s.state !== "launching") continue;
      if (s.appId) {
        map[s.appId] = key;
      } else if (s.gameKey) {
        map[s.gameKey] = key;
      }
    }
    return map;
  }, [sessions]);

  // Build candidates from selected hero sources (for rotate + single-pick)
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

  // Select hero game: running session always wins, then rotate or first candidate
  const { game: heroGame, sessionKey, manualGame: heroManualGame, epicGame: heroEpicGame } = useMemo<HeroGameResult>(() => {
    // Running session always takes priority
    const running = findRunningHero(snapshotGames, sessionKeysByAppId, manualGames, epicGames);
    if (running) return running;

    // Auto-rotate: pick from candidates by rotate index
    if (heroAutoRotate && heroCandidates.length > 0) {
      const idx = rotateIndex % heroCandidates.length;
      const c = heroCandidates[idx];
      if (c.type === "snapshot") return { game: c.game as SnapshotGame, sessionKey: null };
      if (c.type === "epic") return { game: null, sessionKey: null, epicGame: c.game as import("../../types/libraryGame").LibraryGame };
      return { game: null, sessionKey: null, manualGame: c.game as import("../../types/libraryGame").LibraryGame };
    }

    // Single pick: first candidate from selected sources
    if (heroCandidates.length > 0) {
      const c = heroCandidates[0];
      if (c.type === "snapshot") return { game: c.game as SnapshotGame, sessionKey: null };
      if (c.type === "epic") return { game: null, sessionKey: null, epicGame: c.game as import("../../types/libraryGame").LibraryGame };
      return { game: null, sessionKey: null, manualGame: c.game as import("../../types/libraryGame").LibraryGame };
    }

    // Fallback
    return findHeroGameFromSources(snapshotGames, sessionKeysByAppId, favoriteIds, manualGames, epicGames, heroSources);
  }, [snapshotGames, sessionKeysByAppId, favoriteIds, manualGames, epicGames, heroSources, heroCandidates, heroAutoRotate, rotateIndex]);

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

  // Diagnostic logs — once per selection change
  const prevHeroRef = useRef<string | null>(null);
  const prevRunningRef = useRef<string | null>(null);

  useEffect(() => {
    const displayId = heroManualGame?.libraryId || heroEpicGame?.libraryId || heroAppId;
    const reason = sessionKey
      ? "running-session"
      : (heroGame && getEffectiveLastPlayedMs(heroGame) > 0
        ? "last-played"
        : (heroManualGame
          ? "manual-game"
          : (heroEpicGame
            ? "epic-game"
            : (heroGame && heroGame.appId && favoriteIds.has(heroGame.appId)
              ? "favorite"
              : (heroGame && hasValidMedia(heroGame)
                ? "valid-media"
                : (heroGame?.installed
                  ? "installed"
                  : (heroGame?.title
                    ? "titled-fallback"
                    : "last-resort")))))));
    if (prevHeroRef.current !== displayId) {
      prevHeroRef.current = displayId || null;
      if (DEBUG_HERO_LOGS) {
        console.log(`[DASH][HERO_SELECT] running=${displayId && sessionKey ? displayId : null} selected=${displayId || "empty"} reason=${reason}`);
      }
    }
  }, [heroAppId, heroGame, sessionKey, favoriteIds, heroManualGame, heroEpicGame]);

  useEffect(() => {
    const displayId = heroManualGame?.libraryId || heroEpicGame?.libraryId || heroAppId;
    if (isRunning && displayId) {
      if (prevRunningRef.current !== displayId && DEBUG_HERO_LOGS) {
        console.log(`[DASH][HERO_RUNNING] appid=${displayId} running=true focused=true`);
      }
      prevRunningRef.current = displayId;
    }
    if (!isRunning && prevRunningRef.current != null) {
      const wasAppId = prevRunningRef.current;
      if (DEBUG_HERO_LOGS) {
        console.log(`[DASH][HERO_CLEAR_RUNNING] appid=${wasAppId} reason=process-ended`);
      }
      prevRunningRef.current = null;
    }
    if (!isRunning && !displayId) {
      prevRunningRef.current = null;
    }
  }, [isRunning, heroAppId, heroManualGame, heroEpicGame]);

  const libGame = useMemo(() => {
    if (heroManualGame) return heroManualGame;
    if (heroEpicGame) return heroEpicGame;
    if (!heroAppId) return undefined;
    return libraryGames.find((game) => game.appId === heroAppId);
  }, [libraryGames, heroAppId, heroManualGame, heroEpicGame]);

  // Hero background resolution — provider-neutral.
  // For snapshot games: resolve media path via appId.
  // For manual/Epic games: resolve relative provider path directly.
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;

    async function resolveHeroBg() {
      // Manual/Epic game — resolve relative provider media path
      const nonSnapshot = heroManualGame ?? heroEpicGame;
      if (nonSnapshot) {
        const rawPath = nonSnapshot.backgroundPath ?? nonSnapshot.landscapePath ?? nonSnapshot.coverPath ?? null;
        if (!rawPath) { setBgUrl(null); return; }
        try {
          const { resolveProviderMediaPreviewUrl } = await import("../../services/gameCacheService");
          const url = await resolveProviderMediaPreviewUrl(rawPath);
          if (!cancelled) setBgUrl(url);
        } catch {
          if (!cancelled) setBgUrl(null);
        }
        return;
      }

      // Snapshot game — resolve via appId
      if (heroAppId && heroGame) {
        const m = heroGame.media;
        const imgPath = m?.backgroundPath ?? m?.landscapePath ?? m?.coverPath ?? null;
        if (!imgPath) { setBgUrl(null); return; }
        try {
          const url = await resolveGameMediaUrl(heroAppId, imgPath);
          if (!cancelled) setBgUrl(url);
        } catch {
          if (!cancelled) setBgUrl(null);
        }
        return;
      }

      setBgUrl(null);
    }

    resolveHeroBg();
    return () => { cancelled = true; };
  }, [heroAppId, heroGame?.media?.backgroundPath, heroGame?.media?.landscapePath, heroGame?.media?.coverPath, heroManualGame, heroEpicGame]);

  const [heroTitle, setHeroTitle] = useState<string>("");
  useEffect(() => {
    let cancelled = false;

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
          if (DEBUG_NAME_HERO) console.log(`[NAME][HERO] appid=${heroAppId} source=${entry?.source ?? "snapshot"} title=${resolved ?? heroGame!.title}`);
        }
      });
    }
    return () => { cancelled = true; };
  }, [heroGame, heroAppId, heroManualGame, heroEpicGame]);

  const lastPlayedStr = useMemo(() => {
    // For manual/Epic games, look up playtime by game key
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
  }, [heroAppId, heroGame?.lastPlayed, heroManualGame, heroEpicGame]);

  const heroPlaytimeStr = useMemo(() => {
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
  }, [heroAppId, heroGame?.playtime, heroManualGame, heroEpicGame]);

  const stopModalTitle = heroSession?.title || heroGame?.title || heroEpicGame?.title || heroManualGame?.title || "Unknown Game";

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
    if (heroAppId) {
      void requestGameData(heroAppId, LoadPriority.HERO);
    }
  }, [heroAppId]);

  const handlePrimaryAction = useCallback(() => {
    if (!heroGame) return;

    if (isRunning && libGame) {
      setSelectedGame(libGame);
      onNavigate?.("library-game-detail");
      return;
    }

    if (libGame) {
      setSelectedGame(libGame);
      onNavigate?.("library-game-detail");
      return;
    }

    if (heroGame.appId) {
      onNavigate?.("store");
    }
  }, [heroGame, isRunning, libGame, setSelectedGame, onNavigate]);

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

  if (!heroGame && !heroManualGame && !heroEpicGame) {
    return <EmptyHero onNavigate={onNavigate} />;
  }

  return (
    <section className="relative min-h-[300px] overflow-hidden rounded-2xl border border-(--surface-active-border) sm:min-h-[340px]">
      {bgUrl ? (
        <div className="absolute inset-0">
          <AsyncImage
            src={bgUrl}
            alt=""
            className="h-full w-full"
            fallback={
              <div className="h-full w-full bg-gradient-to-br from-(--color-accent)/20 via-purple-900/30 to-black" />
            }
          />
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-(--color-accent)/20 via-purple-900/30 to-black" />
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30" />

      {!hasActiveSession && (
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />
      )}

      <div className="relative z-10 flex min-h-[300px] items-end px-6 pb-8 pt-16 sm:min-h-[340px] sm:px-8">
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
            // ) : isStopping ? (
            //   <>
            //     <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-300 backdrop-blur-sm">
            //       <Loader2 className="h-3 w-3 animate-spin" />
            //       Stopping...
            //     </span>
            //   </>
            // ) : isLaunching ? (
            //   <>
            //     <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/20 px-3 py-1 text-xs font-medium text-blue-300 backdrop-blur-sm">
            //       <Loader2 className="h-3 w-3 animate-spin" />
            //       Launching...
            //     </span>
            //   </>
            ) : (
              <>
                {/* {heroGame.installed && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-300 backdrop-blur-sm">
                    Installed
                  </span>
                )} */}
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
            {heroTitle || heroGame?.title || heroEpicGame?.title}
          </h1>

          <div className="mt-5 flex flex-wrap gap-3">
            {isStopping ? (
              <>
                <button
                  disabled
                  className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-(--color-accent) px-6 py-3 text-sm font-bold text-black opacity-60 transition"
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
                  className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-(--color-accent) px-6 py-3 text-sm font-bold text-black opacity-60 transition"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Launching...
                </button>
              </>
            ) : isRunning ? (
              <>
                <button
                  onClick={handlePrimaryAction}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-(--color-accent) px-6 py-3 text-sm font-bold text-black transition hover:bg-(--color-accent)/80 active:scale-[0.97]"
                >
                  <Play className="h-4 w-4" />
                  Focus Game
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
                    console.log(`[UNINSTALL_PENDING] appid=${heroAppId} phase=manual-cancel before=${isPendingUninstall(heroAppId)}`);
                    clearPendingUninstall(heroAppId);
                    showInfo(`"${heroTitle || heroGame?.title || heroAppId}" uninstall tracking cancelled.`);
                    console.log(`[UNINSTALL_PENDING] appid=${heroAppId} phase=manual-cancel after=${isPendingUninstall(heroAppId)}`);
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
            ) : heroGame?.playable ? (
              <>
                <button
                  onClick={handlePrimaryAction}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-(--color-accent) px-6 py-3 text-sm font-bold text-black transition hover:bg-(--color-accent)/80 active:scale-[0.97]"
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