import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import {
  Wrench, Disc3, Package, Zap, CheckCircle2, Gamepad2, X, Loader2, AlertTriangle,
  Copy, Check, ExternalLink, Power,
} from "lucide-react";

import type { LibraryGame } from "../../types/libraryGame";
import { resolveGameMediaUrl } from "../../services/gameCacheService";
import { getHeroTransitionSnapshot, subscribeHeroTransition } from "../../services/heroTransitionStore";
import { setAmbientSource, clearAmbientSource } from "../../services/ambientBackgroundStore";
import type { GameFixInfo, FixInstallationStatus, GameFixResult } from "../../services/tauri";
import {
  libraryGetGameFixInfo,
  libraryHasSmokeApiFix,
  libraryHasSteamlessFix,
  libraryHasGoldbergFix,
  libraryHasOnlineFixFix,
  libraryCheckFixInstallations,
  libraryApplySmokeApi,
  libraryApplySteamless,
  libraryApplyGoldberg,
  libraryApplyOnlineFix,
  libraryUnfixSmokeApi,
  libraryUnfixSteamless,
  libraryUnfixGoldberg,
  libraryUnfixOnlineFix,
  libraryOpenSteamLaunchOptions,
  seedGseSavesFolder,
  libraryApplyCatalogFix,
  libraryHasCatalogFix,
  libraryUnfixCatalogFix,
  scanSteamLoginUsers,
} from "../../services/tauri";
import { setFixModalOpen } from "../fixes/FixProgressListener";
import { useSettings } from "../../context/SettingsContext";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { showSuccess, showError } from "../toast/GameToast";
import { setStandalone as persistStandalone } from "../../services/standaloneStore";
import { updateConfigForCrack } from "../../services/achievementConfigService";
import { achievementWatcherService } from "../../services/achievementWatcherService";
import {
  fetchFixesCatalog,
  getFixesForAppId,
  type FixesCatalogEntry,
} from "../../services/fixesCatalogService";

// =============================================================================
// Types
// =============================================================================

type FixKind = "smokeApi" | "steamless" | "onlineFix" | "goldberg";

interface FixProgress {
  progress: number;
  message: string;
}

interface FixResultDisplay {
  ok: boolean;
  message: string;
  filesInstalled?: string[];
}

interface FixRowState {
  busy: boolean;
  applied: boolean;
  progress: FixProgress | null;
  result: FixResultDisplay | null;
  resultTimer: ReturnType<typeof setTimeout> | null;
  glowTimer: ReturnType<typeof setTimeout> | null;
  showGlow: boolean;
}

const TOOL_EVENT_MAP: Record<FixKind, string> = {
  smokeApi: "smoke_api",
  steamless: "steamless",
  onlineFix: "online_fix",
  goldberg: "goldberg",
};

const RESULT_DISPLAY_MS = 5000;
const GLOW_DURATION_MS = 1200;

// =============================================================================
// Styles
// =============================================================================

const GLASS_ROW = "flex items-center gap-3 rounded-2xl border p-4 shadow-lg backdrop-blur-xl transition-all duration-300";

const GLASS_BUTTON =
  "inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/50 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md transition hover:bg-black/70 disabled:cursor-not-allowed disabled:opacity-40";

// =============================================================================
// Component
// =============================================================================

export interface ToolsModalProps {
  open: boolean;
  game: LibraryGame | null;
  onClose: () => void;
}

export default function ToolsModal({ open, game, onClose }: ToolsModalProps) {
  const { settings } = useSettings();
  const { updateGame } = useLibraryGames();
  const transition = useSyncExternalStore(
    subscribeHeroTransition,
    getHeroTransitionSnapshot,
    getHeroTransitionSnapshot,
  ).id;

  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const [heroError, setHeroError] = useState(false);

  const [nativeInfo, setNativeInfo] = useState<GameFixInfo | null>(null);
  const [nativeInstallStatus, setNativeInstallStatus] = useState<FixInstallationStatus | null>(null);
  const [applied, setApplied] = useState<Record<FixKind, boolean>>({
    smokeApi: false, steamless: false, onlineFix: false, goldberg: false,
  });
  const [fixStates, setFixStates] = useState<Record<FixKind, FixRowState>>({
    smokeApi: { busy: false, applied: false, progress: null, result: null, resultTimer: null, glowTimer: null, showGlow: false },
    steamless: { busy: false, applied: false, progress: null, result: null, resultTimer: null, glowTimer: null, showGlow: false },
    onlineFix: { busy: false, applied: false, progress: null, result: null, resultTimer: null, glowTimer: null, showGlow: false },
    goldberg: { busy: false, applied: false, progress: null, result: null, resultTimer: null, glowTimer: null, showGlow: false },
  });

  const nativeAppId = game?.appId ? Number(game.appId) : null;
  const fixStatesRef = useRef(fixStates);

  // ── Catalog fix state ───────────────────────────────────────────────────
  const [catalogFixes, setCatalogFixes] = useState<FixesCatalogEntry[]>([]);
  const [catalogApplied, setCatalogApplied] = useState<Record<string, boolean>>({});
  const [catalogStates, setCatalogStates] = useState<Record<string, FixRowState>>({});
  const catalogBusyRef = useRef(new Set<string>());
  fixStatesRef.current = fixStates;
  const busyRef = useRef(new Set<FixKind>());
  const [showOnlineFixModal, setShowOnlineFixModal] = useState(false);
  const [onlineFixCopied, setOnlineFixCopied] = useState(false);
  const [standaloneBusy, setStandaloneBusy] = useState(false);
  const steamAccountNameRef = useRef<string | null>(null);

  // ── Escape closes ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ── Notify FixProgressListener about modal open state ──────────────────────
  useEffect(() => {
    setFixModalOpen(open, open ? nativeAppId : null);
    if (!open) setShowOnlineFixModal(false);
    return () => setFixModalOpen(false, null);
  }, [open, nativeAppId]);

  // ── Resolve hero artwork ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !game) return;
    let cancelled = false;
    (async () => {
      try {
        if (settings.steamRoot) {
          const users = await scanSteamLoginUsers(settings.steamRoot);
          if (!cancelled && users.length > 0) {
            steamAccountNameRef.current = users[0].accountName;
          }
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [open, game, settings.steamRoot]);
  useEffect(() => {
    if (!open || !game?.appId) {
      setHeroUrl(null);
      setHeroError(false);
      return;
    }
    const appId = String(game.appId);
    const path = game.landscapePath ?? game.backgroundPath ?? game.coverPath;
    if (!path) { setHeroUrl(null); return; }
    let cancelled = false;
    resolveGameMediaUrl(appId, path).then((url) => {
      if (!cancelled) setHeroUrl(url);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, game?.appId]);

  // ── Feed ambient background ────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    if (heroUrl && !heroError) setAmbientSource("tools-modal", heroUrl);
    return () => clearAmbientSource("tools-modal");
  }, [open, heroUrl, heroError]);

  // ── Listen to fix-progress events (only when modal is open) ────────────────
  useEffect(() => {
    if (!open) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    async function setup() {
      unlisten = await listen<{ appId: number; tool: string; progress: number; message: string }>(
        "library://fix-progress",
        (event) => {
          if (cancelled) return;
          const { tool, progress, message } = event.payload;
          // Find the FixKind from the event tool name
          const kind = (Object.entries(TOOL_EVENT_MAP) as [FixKind, string][]).find(
            ([, v]) => v === tool,
          )?.[0];
          if (kind) {
            setFixStates((prev) => {
              const s = prev[kind];
              if (!s.busy) return prev;
              return {
                ...prev,
                [kind]: { ...s, progress: { progress, message } },
              };
            });
            return;
          }
          // Check if it's a catalog fix (RockstarFix, Voices38Fix)
          if (tool === "RockstarFix" || tool === "Voices38Fix") {
            setCatalogStates((prev) => {
              // Find the entry by matching a busy state
              const entryId = Object.keys(prev).find((id) => prev[id].busy);
              if (!entryId) return prev;
              return {
                ...prev,
                [entryId]: { ...prev[entryId], progress: { progress, message } },
              };
            });
          }
        },
      );
    }
    setup();
    return () => { cancelled = true; unlisten?.(); };
  }, [open]);

  // ── Cleanup timers on unmount ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      for (const kind of Object.keys(fixStates) as FixKind[]) {
        const s = fixStatesRef.current[kind];
        if (s.resultTimer) clearTimeout(s.resultTimer);
        if (s.glowTimer) clearTimeout(s.glowTimer);
      }
    };
  }, []);

  // ── Detection ──────────────────────────────────────────────────────────────
  const refreshNativeState = useCallback(async () => {
    if (!game?.installDir || nativeAppId == null || !Number.isFinite(nativeAppId)) return;
    const appId = nativeAppId;
    const installDir = game.installDir;
    try {
      const [info, status] = await Promise.all([
        libraryGetGameFixInfo({ appId, name: game.title, installDir, hasLua: !!game.hasLua, luaCount: game.luaScripts?.length ?? 0 }),
        libraryCheckFixInstallations(),
      ]);
      const [hasSmoke, hasSteamless, hasGoldberg, hasOnline] = await Promise.all([
        libraryHasSmokeApiFix(appId, installDir),
        libraryHasSteamlessFix(appId, installDir),
        libraryHasGoldbergFix(appId, installDir),
        libraryHasOnlineFixFix(appId, installDir),
      ]);
      setNativeInfo(info);
      setNativeInstallStatus(status as FixInstallationStatus);
      setApplied({ smokeApi: hasSmoke, steamless: hasSteamless, onlineFix: hasOnline, goldberg: hasGoldberg });
    } catch {
      // silent — detection is non-critical
    }
  }, [game, nativeAppId]);

  useEffect(() => {
    if (!open || !game?.installDir || nativeAppId == null || !Number.isFinite(nativeAppId)) {
      setNativeInfo(null);
      setNativeInstallStatus(null);
      setApplied({ smokeApi: false, steamless: false, onlineFix: false, goldberg: false });
      return;
    }
    refreshNativeState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, game?.id, game?.installDir, nativeAppId]);

  // ── Load catalog fixes for this appId ───────────────────────────────────
  useEffect(() => {
    if (!open || !game?.appId || !game?.installDir || nativeAppId == null) {
      setCatalogFixes([]);
      setCatalogApplied({});
      setCatalogStates({});
      return;
    }
    const appId = String(game.appId);
    const installDir = game.installDir;
    let cancelled = false;

    async function load() {
      await fetchFixesCatalog();
      if (cancelled) return;
      const fixes = getFixesForAppId(appId).filter((e) => e.type === "fix");
      if (cancelled) return;
      setCatalogFixes(fixes);
      // Check which catalog fixes are already applied
      const applied: Record<string, boolean> = {};
      const states: Record<string, FixRowState> = {};
      const empty: FixRowState = { busy: false, applied: false, progress: null, result: null, resultTimer: null, glowTimer: null, showGlow: false };
      for (const fix of fixes) {
        const fixType = fix.provider === "rockstar" ? "RockstarFix" : "Voices38Fix";
        try {
          applied[fix.id] = await libraryHasCatalogFix(nativeAppId!, installDir, fixType);
        } catch {
          applied[fix.id] = false;
        }
        states[fix.id] = { ...empty, applied: applied[fix.id] };
      }
      if (!cancelled) {
        setCatalogApplied(applied);
        setCatalogStates(states);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [open, game?.appId, game?.installDir, nativeAppId]);

  // ── Transition a fix row into busy state ───────────────────────────────────
  const markBusy = useCallback((kind: FixKind) => {
    setFixStates((prev) => ({
      ...prev,
      [kind]: { ...prev[kind], busy: true, progress: { progress: 0, message: "Starting..." }, result: null, showGlow: false },
    }));
  }, []);

  // ── Transition a fix row from busy → completed (with glow + result) ────────
  const markCompleted = useCallback((kind: FixKind, result: GameFixResult | null) => {
    const msg = result?.message ?? "Done";
    const files = result?.filesInstalled;
    const ok = result?.ok ?? false;

    // Clear existing timers
    setFixStates((prev) => {
      const s = prev[kind];
      if (s.resultTimer) clearTimeout(s.resultTimer);
      if (s.glowTimer) clearTimeout(s.glowTimer);
      return prev;
    });

    // Set completed state
    setFixStates((prev) => ({
      ...prev,
      [kind]: {
        ...prev[kind],
        busy: false,
        progress: null,
        result: { ok, message: msg, filesInstalled: files },
        showGlow: ok,
      },
    }));

    // Clear glow after animation
    const glowTimer = setTimeout(() => {
      setFixStates((prev) => ({
        ...prev,
        [kind]: { ...prev[kind], showGlow: false },
      }));
    }, GLOW_DURATION_MS);

    // Clear result after display
    const resultTimer = setTimeout(() => {
      setFixStates((prev) => ({
        ...prev,
        [kind]: { ...prev[kind], result: null },
      }));
    }, RESULT_DISPLAY_MS);

    setFixStates((prev) => ({
      ...prev,
      [kind]: { ...prev[kind], glowTimer, resultTimer },
    }));
  }, []);

  // ── Apply handler ──────────────────────────────────────────────────────────
  const handleApply = useCallback(async (kind: FixKind, _label: string) => {
    if (!game?.installDir || nativeAppId == null || !Number.isFinite(nativeAppId)) return;
    if (busyRef.current.has(kind)) return;
    busyRef.current.add(kind);
    const appId = nativeAppId;
    const installDir = game.installDir;
    markBusy(kind);
    try {
      let result: GameFixResult | null = null;
      if (kind === "smokeApi") result = await libraryApplySmokeApi({ appId, name: game.title, installDir });
      else if (kind === "steamless") result = await libraryApplySteamless({ appId, name: game.title, installDir });
      else if (kind === "goldberg") {
        result = await libraryApplyGoldberg({ appId, name: game.title, installDir, steamWebApiKey: settings.steamWebApiKey || "" });
        if (result?.ok) {
          try { await seedGseSavesFolder(String(appId)); } catch { /* non-critical */ }
        }
      }
      else result = await libraryApplyOnlineFix({ appId, name: game.title, installDir });
      markCompleted(kind, result);
    } catch (err) {
      markCompleted(kind, { ok: false, tool: kind, message: err instanceof Error ? err.message : String(err), filesInstalled: [], errors: [], requiresManualSelection: false, availableFiles: [] });
    } finally {
      busyRef.current.delete(kind);
      await refreshNativeState();
    }
  }, [game, nativeAppId, markBusy, markCompleted, refreshNativeState, settings.steamWebApiKey]);

  // ── Unfix handler ──────────────────────────────────────────────────────────
  const handleUnfix = useCallback(async (kind: FixKind, _label: string) => {
    if (!game?.installDir || nativeAppId == null || !Number.isFinite(nativeAppId)) return;
    if (busyRef.current.has(kind)) return;
    busyRef.current.add(kind);
    const appId = nativeAppId;
    const installDir = game.installDir;
    markBusy(kind);
    try {
      let result: GameFixResult | null = null;
      if (kind === "smokeApi") result = await libraryUnfixSmokeApi(appId, installDir);
      else if (kind === "steamless") result = await libraryUnfixSteamless(appId, installDir);
      else if (kind === "goldberg") result = await libraryUnfixGoldberg(appId, installDir);
      else result = await libraryUnfixOnlineFix(appId, installDir);
      markCompleted(kind, result);
    } catch (err) {
      markCompleted(kind, { ok: false, tool: kind, message: err instanceof Error ? err.message : String(err), filesInstalled: [], errors: [], requiresManualSelection: false, availableFiles: [] });
    } finally {
      busyRef.current.delete(kind);
      await refreshNativeState();
    }
  }, [game, nativeAppId, markBusy, markCompleted, refreshNativeState]);

  // ── Catalog fix apply handler ─────────────────────────────────────────────
  const handleCatalogApply = useCallback(async (entry: FixesCatalogEntry) => {
    if (!game?.installDir || nativeAppId == null || !Number.isFinite(nativeAppId)) return;
    if (catalogBusyRef.current.has(entry.id)) return;
    catalogBusyRef.current.add(entry.id);
    const appId = nativeAppId;
    const installDir = game.installDir;
    const fixType = entry.provider === "rockstar" ? "RockstarFix" : "Voices38Fix";
    setCatalogStates((prev) => ({
      ...prev,
      [entry.id]: { ...prev[entry.id], busy: true, progress: { progress: 0, message: "Starting..." }, result: null, showGlow: false },
    }));
    try {
      const result = await libraryApplyCatalogFix({
        appId,
        name: game.title,
        installDir,
        downloadUrl: entry.downloadUrl,
        fixType,
        accountName: steamAccountNameRef.current ?? undefined,
        steamId: settings.steamId64 || undefined,
      });
      setCatalogStates((prev) => ({
        ...prev,
        [entry.id]: { ...prev[entry.id], busy: false, progress: null, result: { ok: result.ok, message: result.message, filesInstalled: result.filesInstalled }, showGlow: result.ok },
      }));
      if (result.ok) {
        setCatalogApplied((prev) => ({ ...prev, [entry.id]: true }));
      }
      setTimeout(() => {
        setCatalogStates((prev) => ({
          ...prev,
          [entry.id]: { ...prev[entry.id], result: null, showGlow: false },
        }));
      }, 5000);
    } catch (err) {
      setCatalogStates((prev) => ({
        ...prev,
        [entry.id]: { ...prev[entry.id], busy: false, progress: null, result: { ok: false, message: err instanceof Error ? err.message : String(err) }, showGlow: false },
      }));
      setTimeout(() => {
        setCatalogStates((prev) => ({
          ...prev,
          [entry.id]: { ...prev[entry.id], result: null },
        }));
      }, 5000);
    } finally {
      catalogBusyRef.current.delete(entry.id);
    }
  }, [game, nativeAppId]);

  // ── Catalog fix unfix handler ─────────────────────────────────────────────
  const handleCatalogUnfix = useCallback(async (entry: FixesCatalogEntry) => {
    if (!game?.installDir || nativeAppId == null || !Number.isFinite(nativeAppId)) return;
    if (catalogBusyRef.current.has(entry.id)) return;
    catalogBusyRef.current.add(entry.id);
    const appId = nativeAppId;
    const installDir = game.installDir;
    const fixType = entry.provider === "rockstar" ? "RockstarFix" : "Voices38Fix";
    setCatalogStates((prev) => ({
      ...prev,
      [entry.id]: { ...prev[entry.id], busy: true, progress: { progress: 0, message: "Starting..." }, result: null, showGlow: false },
    }));
    try {
      const result = await libraryUnfixCatalogFix({ appId, installDir, fixType });
      setCatalogStates((prev) => ({
        ...prev,
        [entry.id]: { ...prev[entry.id], busy: false, progress: null, result: { ok: result.ok, message: result.message, filesInstalled: result.filesInstalled }, showGlow: result.ok },
      }));
      if (result.ok) {
        setCatalogApplied((prev) => ({ ...prev, [entry.id]: false }));
      }
      setTimeout(() => {
        setCatalogStates((prev) => ({
          ...prev,
          [entry.id]: { ...prev[entry.id], result: null, showGlow: false },
        }));
      }, 5000);
    } catch (err) {
      setCatalogStates((prev) => ({
        ...prev,
        [entry.id]: { ...prev[entry.id], busy: false, progress: null, result: { ok: false, message: err instanceof Error ? err.message : String(err) }, showGlow: false },
      }));
      setTimeout(() => {
        setCatalogStates((prev) => ({
          ...prev,
          [entry.id]: { ...prev[entry.id], result: null },
        }));
      }, 5000);
    } finally {
      catalogBusyRef.current.delete(entry.id);
    }
  }, [game, nativeAppId]);

  // ── Standalone mode toggle ──────────────────────────────────────────────────
  const canToggleStandalone = !!nativeInstallStatus?.goldbergInstalled && !!nativeInstallStatus?.steamlessInstalled;
  const isStandalone = !!game?.isStandalone;

  const handleToggleStandalone = useCallback(async () => {
    if (!game?.appId || !game?.installDir || standaloneBusy) return;
    setStandaloneBusy(true);
    try {
      if (isStandalone) {
        // Deactivate: remove fixes + clear persistence
        if (applied.goldberg) await libraryUnfixGoldberg(nativeAppId!, game.installDir);
        if (applied.steamless) await libraryUnfixSteamless(nativeAppId!, game.installDir);
        persistStandalone(game.appId, false);
        localStorage.removeItem(`lumaforge-ach-platform-${game.appId}`);
        updateGame(game.appId, { isStandalone: false, executablePath: undefined });
        showSuccess(`${game.title} — Modo standalone desactivado`);
      } else {
        // Activate: apply Goldberg + Steamless + seed GSE Saves
        if (!applied.goldberg) {
          await libraryApplyGoldberg({ appId: nativeAppId!, name: game.title, installDir: game.installDir, steamWebApiKey: settings.steamWebApiKey || "" });
        }
        // Seed GSE Saves folder so Goldberg has a place to write achievements.json
        let gseSavesPath = "";
        try { gseSavesPath = await seedGseSavesFolder(game.appId); } catch { /* non-critical */ }
        if (!applied.steamless && nativeInfo?.hasSteamStubDrm) {
          await libraryApplySteamless({ appId: nativeAppId!, name: game.title, installDir: game.installDir });
        }
        // 1. Persist standalone to localStorage (survives restart)
        persistStandalone(game.appId, true);
        // 2. Switch achievement dropdown to "Crack Saves" immediately
        localStorage.setItem(`lumaforge-ach-platform-${game.appId}`, "steam");
        // 3. Write achievement config pointing to GSE Saves (for watcher on next restart)
        if (gseSavesPath) {
          try { await updateConfigForCrack(game.appId, gseSavesPath, game.title); } catch { /* non-critical */ }
        }
        // 4. Set watcher platform for current session
        achievementWatcherService.setPlatform(game.appId, "steam");
        // 5. Trigger schema creation (names/icons/descriptions) immediately
        achievementWatcherService.triggerSchemaCreation(game.appId).catch(() => {});
        // 6. Restart Rust watcher so it picks up the new GSE Saves/<appId>/ dir
        achievementWatcherService.restartWatching().catch(() => {});
        // 5. Update React state
        updateGame(game.appId, {
          isStandalone: true,
          isPlayable: true,
          executablePath: nativeInfo?.exeName ?? game.executablePath,
          installDir: nativeInfo?.installPath ?? game.installDir,
        });
        showSuccess(`${game.title} — Modo standalone activado`);
      }
    } catch (err) {
      showError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setStandaloneBusy(false);
      await refreshNativeState();
    }
  }, [game, nativeAppId, isStandalone, standaloneBusy, applied, nativeInfo, updateGame, refreshNativeState, settings.steamWebApiKey]);

  if (!open) return null;

  const title = game
    ? game.source === "epic"
      ? `Fixes · ${game.title}`
      : `Fixes · ${game.title} · #${game.appId}`
    : "Fixes";

  const heroClass =
    transition === "kenburns"
      ? "animate-hero-kenburns-in"
      : transition === "focus"
        ? "animate-hero-focus-in"
        : "animate-hero-crossfade-in";

  // ── Build fix rows ─────────────────────────────────────────────────────────
  const buildRows = () => {
    if (!nativeInfo || nativeAppId == null) return null;
    const arch = nativeInfo.hasSteamApi64
      ? "x64"
      : nativeInfo.hasSteamApi32
        ? "x86"
        : nativeInfo.gameArch ?? null;

    const rows: Array<{
      kind: FixKind;
      label: string;
      description: string;
      icon: React.ReactNode;
      toolInstalled: boolean;
      applicable: boolean;
      hint: string;
    }> = [
      {
        kind: "smokeApi",
        label: "SmokeAPI",
        description: "Bypass Steam API for multiplayer/co-op and DLC unlock",
        icon: <Disc3 className="h-4 w-4" />,
        toolInstalled: !!nativeInstallStatus?.smokeApiInstalled,
        applicable: nativeInfo.installed,
        hint: nativeInfo.hasSteamApi64
          ? "Detectado steam_api64.dll (x64)"
          : nativeInfo.hasSteamApi32
            ? "Detectado steam_api.dll (x86)"
            : "Sin steam_api detectado — se inyectará vía Koaloader",
      },
      {
        kind: "steamless",
        label: "Steamless",
        description: "Remove Steam DRM (SteamStub) from game executables",
        icon: <Package className="h-4 w-4" />,
        toolInstalled: !!nativeInstallStatus?.steamlessInstalled,
        applicable: nativeInfo.installed,
        hint: nativeInfo.hasSteamStubDrm
          ? `SteamStub detectado en ${nativeInfo.mainExe ?? "el ejecutable"}`
          : nativeInfo.exeName
            ? "Comprobará todos los ejecutables candidatos"
            : "Sin ejecutables detectados",
      },
      {
        kind: "goldberg",
        label: "Goldberg",
        description: "Offline Steam emulator for LAN/single-player",
        icon: <Gamepad2 className="h-4 w-4" />,
        toolInstalled: !!nativeInstallStatus?.goldbergInstalled,
        applicable: nativeInfo.installed,
        hint: "Requiere Goldberg (fork) instalado",
      },
      {
        kind: "onlineFix",
        label: "Online Fix",
        description: "Download multiplayer/co-op fix from online-fix database",
        icon: <Zap className="h-4 w-4" />,
        toolInstalled: true,
        applicable: nativeInfo.hasOnlineFix,
        hint: "Solo para juegos con fix online disponible",
      },
    ];

    const canAffect = rows.some((r) => applied[r.kind] || r.applicable);
    if (!canAffect) return null;

    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          <p className="text-xs text-amber-300/80 leading-relaxed">
            Unofficial content from external sources. Use at your own risk. Back up your files before continuing.
          </p>
        </div>
        <div className="space-y-2">
        {rows.map((row) => {
          const state = fixStates[row.kind];
          const isBusy = state.busy;
          const isApplied = applied[row.kind];
          const progress = state.progress;
          const result = state.result;
          const showGlow = state.showGlow;

          const applyDisabled = isBusy || isApplied || !row.toolInstalled || !row.applicable;
          const pct = progress?.progress ?? 0;

          // Determine row styling
          let rowBorder = "border-white/10";
          let rowShadow = "shadow-black/20";
          if (showGlow) {
            rowBorder = "border-emerald-500/40";
            rowShadow = "shadow-emerald-500/15 shadow-lg";
          } else if (isApplied) {
            rowBorder = "border-emerald-500/20";
          }

          return (
            <div key={row.kind} className={`${GLASS_ROW} ${rowBorder} ${rowShadow} ${showGlow ? "lf-fix-glow-pulse" : ""} ${isApplied && !showGlow ? "opacity-80" : ""}`}>
              {/* Icon chip */}
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors duration-300 ${
                isApplied && !isBusy ? "bg-emerald-500/15 text-emerald-400" : "bg-(--color-accent)/15 text-(--color-accent)"
              }`}>
                {row.icon}
              </span>

              {/* Main content */}
              <div className="min-w-0 flex-1">
                {/* Title row */}
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{row.label}</span>
                  {arch && row.kind === "steamless" && (
                    <span className="rounded-md bg-(--color-accent)/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-(--color-accent)">
                      {arch}
                    </span>
                  )}
                  {/* Checkmark — pops in on completion */}
                  {isApplied && !isBusy && (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 lf-fix-check-pop" />
                  )}
                  {/* Spinner — when busy */}
                  {isBusy && (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-(--color-accent)" />
                  )}
                  {/* Progress percentage — when busy */}
                  {isBusy && progress && (
                    <span className="ml-auto text-xs font-semibold tabular-nums text-(--color-accent)">
                      {pct}%
                    </span>
                  )}
                </div>

                {/* Description — always visible */}
                <p className="text-[11px] text-white/40 mt-0.5">{row.description}</p>

                {/* Progress bar — when busy */}
                {isBusy && progress && (
                  <div className="mt-1.5">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-(--color-accent) transition-[width] duration-300 ease-out"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {progress.message && (
                      <p className="mt-1 text-[11px] text-white/50 truncate">{progress.message}</p>
                    )}
                  </div>
                )}

                {/* Hint — when idle and not applied */}
                {!isBusy && !isApplied && (!row.toolInstalled || !row.applicable) && (
                  <p className="mt-0.5 text-xs text-white/50">
                    {row.toolInstalled ? row.hint : `${row.label} no instalado.`}
                  </p>
                )}

                {/* Result line — after completion */}
                {result && !isBusy && (
                  <div className="lf-fix-result-slide-in mt-1.5">
                    <p className={`text-xs ${result.ok ? "text-emerald-400/90" : "text-rose-400/90"}`}>
                      {result.ok ? "✓" : "✗"}{" "}
                      {result.filesInstalled && result.filesInstalled.length > 0
                        ? result.filesInstalled.slice(0, 2).join(", ") + (result.filesInstalled.length > 2 ? ` +${result.filesInstalled.length - 2}` : "")
                        : result.message}
                    </p>
                  </div>
                )}
              </div>

              {/* Action button — when not busy */}
              {!isBusy && isApplied && (
                <button
                  type="button"
                  onClick={() => handleUnfix(row.kind, row.label)}
                  className={`${GLASS_BUTTON} border-red-500/40 text-red-400 hover:bg-red-500/20`}
                >
                  Quitar
                </button>
              )}
              {!isBusy && !isApplied && (
                <button
                  type="button"
                  disabled={applyDisabled}
                  onClick={() => handleApply(row.kind, row.label)}
                  className={`${GLASS_BUTTON} border-(--color-accent)/50 bg-(--color-accent)/20 text-(--color-accent-text) hover:bg-(--color-accent)/30`}
                >
                  Aplicar
                </button>
              )}
              {/* Online Fix: secondary "Abrir Steam" button */}
              {!isBusy && row.kind === "onlineFix" && nativeAppId != null && (
                <button
                  type="button"
                  onClick={() => setShowOnlineFixModal(true)}
                  className={`${GLASS_BUTTON} border-white/15 text-white/70 hover:bg-white/10`}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Abrir Steam
                </button>
              )}
              {/* No button when busy — progress bar IS the indicator */}
            </div>
          );
        })}
        </div>
      </div>
    );
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative mx-4 flex max-h-[85vh] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-(--color-border) lf-surface shadow-2xl">
        {/* Hero band */}
        {heroUrl && !heroError ? (
          <div className="relative shrink-0 h-[200px] overflow-hidden sm:h-[220px]">
            <img
              key={heroUrl}
              src={heroUrl}
              alt=""
              loading="eager"
              className={`h-full w-full object-cover ${heroClass} brightness-[0.5] saturate-[1.05]`}
              onError={() => setHeroError(true)}
            />
            <div className="absolute inset-0 bg-linear-to-t from-(--color-bg) via-(--color-bg)/60 to-transparent" />
            <div className="absolute inset-x-0 top-0 flex items-start justify-between px-6 pt-4">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-(--color-accent)" />
                <h2 className="text-base font-semibold text-white drop-shadow-md">{title}</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="relative z-10 flex shrink-0 items-center justify-between px-6 pb-2 pt-5">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-(--color-accent)" />
              <h2 className="text-base font-semibold text-(--color-text)">{title}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-muted) hover:bg-white/10 hover:text-(--color-text)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="relative z-10 flex-1 overflow-y-auto px-6 py-4">
          {!game?.installDir ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
              <p className="text-sm text-(--color-muted)">
                Este juego no tiene carpeta de instalación.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {buildRows()}

              {/* ── Catalog fix rows (Rockstar, Voices38, etc.) ────────── */}
              {catalogFixes.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-white/30">
                    Available from catalog
                  </p>
                  {catalogFixes.map((entry) => {
                    const state = catalogStates[entry.id];
                    const isBusy = state?.busy ?? false;
                    const isApplied = catalogApplied[entry.id] ?? false;
                    const progress = state?.progress ?? null;
                    const result = state?.result ?? null;
                    const showGlow = state?.showGlow ?? false;

                    let rowBorder = "border-white/10";
                    let rowShadow = "shadow-black/20";
                    if (showGlow) {
                      rowBorder = "border-emerald-500/40";
                      rowShadow = "shadow-emerald-500/15 shadow-lg";
                    } else if (isApplied) {
                      rowBorder = "border-emerald-500/20";
                    }

                    const providerLabel = entry.provider === "rockstar" ? "Rockstar Fix" : "Voices38 Fix";
                    const pct = progress?.progress ?? 0;

                    return (
                      <div
                        key={entry.id}
                        className={`${GLASS_ROW} ${rowBorder} ${rowShadow} ${showGlow ? "lf-fix-glow-pulse" : ""} ${isApplied && !showGlow ? "opacity-80" : ""}`}
                      >
                        {/* Icon chip */}
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors duration-300 ${
                          isApplied && !isBusy ? "bg-emerald-500/15 text-emerald-400" : "bg-(--color-accent)/15 text-(--color-accent)"
                        }`}>
                          <Zap className="h-4 w-4" />
                        </span>

                        {/* Main content */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white">{providerLabel}</span>
                            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/50">
                              Catalog
                            </span>
                            {isApplied && !isBusy && (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 lf-fix-check-pop" />
                            )}
                            {isBusy && (
                              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-(--color-accent)" />
                            )}
                            {isBusy && progress && (
                              <span className="ml-auto text-xs font-semibold tabular-nums text-(--color-accent)">
                                {pct}%
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-white/40 mt-0.5">
                            {entry.title}
                            {entry.fileSizeHuman ? ` · ${entry.fileSizeHuman}` : ""}
                          </p>
                          {isBusy && progress && (
                            <div className="mt-1.5">
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                                <div
                                  className="h-full rounded-full bg-(--color-accent) transition-[width] duration-300 ease-out"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              {progress.message && (
                                <p className="mt-1 text-[11px] text-white/50 truncate">{progress.message}</p>
                              )}
                            </div>
                          )}
                          {result && !isBusy && (
                            <div className="lf-fix-result-slide-in mt-1.5">
                              <p className={`text-xs ${result.ok ? "text-emerald-400/90" : "text-rose-400/90"}`}>
                                {result.ok ? "✓" : "✗"}{" "}
                                {result.filesInstalled && result.filesInstalled.length > 0
                                  ? result.filesInstalled.slice(0, 2).join(", ") + (result.filesInstalled.length > 2 ? ` +${result.filesInstalled.length - 2}` : "")
                                  : result.message}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Action buttons */}
                        {!isBusy && isApplied && (
                          <button
                            type="button"
                            onClick={() => handleCatalogUnfix(entry)}
                            className={`${GLASS_BUTTON} border-red-500/40 text-red-400 hover:bg-red-500/20`}
                          >
                            Quitar
                          </button>
                        )}
                        {!isBusy && !isApplied && (
                          <button
                            type="button"
                            onClick={() => handleCatalogApply(entry)}
                            className={`${GLASS_BUTTON} border-(--color-accent)/50 bg-(--color-accent)/20 text-(--color-accent-text) hover:bg-(--color-accent)/30`}
                          >
                            Aplicar
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Standalone Mode toggle */}
              <div className={`${GLASS_ROW} ${isStandalone ? "border-emerald-500/30" : "border-white/10"}`}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors duration-300 ${
                  isStandalone ? "bg-emerald-500/15 text-emerald-400" : "bg-(--color-accent)/15 text-(--color-accent)"
                }`}>
                  <Power className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">Modo Standalone</span>
                    {isStandalone && !standaloneBusy && (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 lf-fix-check-pop" />
                    )}
                    {standaloneBusy && (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-(--color-accent)" />
                    )}
                  </div>
                  <p className="text-[11px] text-white/40 mt-0.5">
                    Juega sin Steam — crea esquema de logros con Goldberg + Steamless
                  </p>
                  {!canToggleStandalone && !isStandalone && (
                    <p className="mt-0.5 text-xs text-amber-400/80">
                      Instalá Goldberg y Steamless en Configuración &gt; Third Party Tools
                    </p>
                  )}
                </div>
                {!standaloneBusy && (
                  <button
                    type="button"
                    disabled={!canToggleStandalone}
                    onClick={handleToggleStandalone}
                    className={`${isStandalone
                      ? `${GLASS_BUTTON} border-red-500/40 text-red-400 hover:bg-red-500/20`
                      : `${GLASS_BUTTON} border-(--color-accent)/50 bg-(--color-accent)/20 text-(--color-accent-text) hover:bg-(--color-accent)/30`
                    }`}
                  >
                    {isStandalone ? "Desactivar" : "Activar"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* ── Online Fix mini modal ──────────────────────────────────────── */}
      {showOnlineFixModal && nativeAppId != null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowOnlineFixModal(false); }}
          onKeyDown={(e) => { if (e.key === "Escape") setShowOnlineFixModal(false); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="online-fix-launch-title"
            className="relative mx-4 w-full max-w-[440px] overflow-hidden rounded-2xl border border-(--surface-active-border) lf-surface p-5 shadow-2xl"
          >
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
              <h3 id="online-fix-launch-title" className="text-sm font-semibold text-(--color-text)">
                Steam Launch Options
              </h3>
              <button
                type="button"
                onClick={() => setShowOnlineFixModal(false)}
                aria-label="Cerrar"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Description */}
            <p className="text-xs leading-relaxed text-(--color-muted)">
              Generic Online Fix (Steam Lobby Spoof) — Enables multiplayer in games that use
              the native Steam lobby system via the{" "}
              <code className="rounded bg-(--color-surface) px-1.5 py-0.5 text-[11px] font-mono text-(--color-accent)">
                -onlinefix
              </code>{" "}
              launch parameter.
            </p>

            {/* Compatibility note */}
            <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2.5">
              <p className="text-[11px] leading-relaxed text-amber-300/80">
                <span className="font-semibold">Note:</span> Not all games are compatible. This
                only works on titles relying on Steam&apos;s built-in matchmaking API. Games with
                custom dedicated servers or proprietary online systems will not work.
              </p>
            </div>

            {/* Instructions */}
            <p className="mt-3 text-xs text-(--color-muted)">
              In Steam, right-click the game →{" "}
              <strong className="text-(--color-text)">Properties → General → Launch Options</strong>
            </p>

            {/* Code row with copy */}
            <div className="mt-2.5 flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm font-mono text-(--color-text) select-all">
                -onlinefix
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText("-onlinefix");
                  setOnlineFixCopied(true);
                  setTimeout(() => setOnlineFixCopied(false), 1500);
                }}
                className="lf-surface inline-flex items-center gap-1.5 rounded-full border border-(--surface-active-border) px-3 py-2 text-xs font-medium text-(--color-text) transition hover:bg-(--surface-active-hover)"
              >
                {onlineFixCopied ? (
                  <><Check className="h-3.5 w-3.5" /> Copied</>
                ) : (
                  <><Copy className="h-3.5 w-3.5" /> Copy</>
                )}
              </button>
            </div>

            {/* Action */}
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  void libraryOpenSteamLaunchOptions(nativeAppId);
                  setShowOnlineFixModal(false);
                  setOnlineFixCopied(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-(--color-accent)/50 bg-(--color-accent)/20 px-4 py-2 text-xs font-medium text-(--color-accent-text) backdrop-blur-md transition hover:bg-(--color-accent)/30"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in Steam
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
