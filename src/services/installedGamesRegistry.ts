import { readInstalledGamesRegistry, writeInstalledGamesRegistry, getGameV2, upsertGameV2 } from "./tauri";
import type { GameV2 } from "../types/gameV2";
import { discoverExecutables } from "./tauri";

const LOCALSTORAGE_LEGACY_KEY = "lumaforge-installed-games-v1";

export type InstalledGameEntry = {
  gameId: string;
  installDir: string;
  exePath: string;
  exeName: string;
  title?: string;
  provider: "steam" | "local" | "lua" | "unknown";
  lastValidated: number;
};

type RegistryStore = Record<string, InstalledGameEntry>;

// In-memory cache to avoid repeated file reads
let _cache: RegistryStore | null = null;
let _cachePromise: Promise<RegistryStore> | null = null;

async function loadRegistry(): Promise<RegistryStore> {
  if (_cache) return _cache;
  if (_cachePromise) return _cachePromise;

  _cachePromise = (async () => {
    try {
      const raw = await readInstalledGamesRegistry();
      const parsed = JSON.parse(raw) as RegistryStore;
      _cache = parsed;
      console.debug("[Registry] loaded from file", { count: Object.keys(parsed).length });
      return parsed;
    } catch (err) {
      console.warn("[Registry] failed to load from file, trying localStorage fallback", err);
      // Fallback: migrate from localStorage
      try {
        const legacyRaw = localStorage.getItem(LOCALSTORAGE_LEGACY_KEY);
        if (legacyRaw) {
          const legacy = JSON.parse(legacyRaw) as RegistryStore;
          _cache = legacy;
          // Persist to file asynchronously
          persistRegistry(legacy);
          localStorage.removeItem(LOCALSTORAGE_LEGACY_KEY);
          console.debug("[Registry] migrated from localStorage", { count: Object.keys(legacy).length });
          return legacy;
        }
      } catch {}
      _cache = {};
      return {};
    }
  })();

  return _cachePromise;
}

async function persistRegistry(store: RegistryStore): Promise<void> {
  try {
    const data = JSON.stringify(store);
    await writeInstalledGamesRegistry(data);
    // Dual-write: also persist to SQLite for fast boot reads
    try {
      const { upsertGameCatalogBlob, CATALOG_KEYS } = await import("./tauri");
      await upsertGameCatalogBlob(CATALOG_KEYS.installedGames, data);
    } catch { /* non-critical */ }
    console.debug("[Registry] written to file", { count: Object.keys(store).length });
  } catch (err) {
    console.warn("[Registry] failed to write to file", err);
  }
}

export async function getInstalledGameEntry(gameId: string): Promise<InstalledGameEntry | undefined> {
  const store = await loadRegistry();
  return store[gameId];
}

export async function setInstalledGameEntry(entry: InstalledGameEntry): Promise<void> {
  const store = await loadRegistry();
  store[entry.gameId] = entry;
  _cache = store;
  await persistRegistry(store);

  // Sync to SQLite cache.db
  syncToDb(entry);

  console.debug("[Registry] set entry", { gameId: entry.gameId, exeName: entry.exeName, exePath: entry.exePath });
}

export async function removeInstalledGameEntry(gameId: string): Promise<void> {
  const store = await loadRegistry();
  delete store[gameId];
  _cache = store;
  await persistRegistry(store);

  console.debug("[Registry] removed entry", { gameId });
}

export async function getAllInstalledGameEntries(): Promise<InstalledGameEntry[]> {
  const store = await loadRegistry();
  return Object.values(store);
}

export async function getExeNameFromEntry(gameId: string): Promise<string | undefined> {
  const store = await loadRegistry();
  return store[gameId]?.exeName;
}

export async function getExePathFromEntry(gameId: string): Promise<string | undefined> {
  const store = await loadRegistry();
  return store[gameId]?.exePath;
}

async function syncToDb(entry: InstalledGameEntry): Promise<void> {
  try {
    // Ensure ID has source prefix to match what steamGameToGameV2 creates
    const prefixedId = entry.gameId.startsWith(`${entry.provider}-`) || entry.gameId.startsWith("epic:") || entry.gameId.startsWith("lua-") || entry.gameId.startsWith("debrid:") || entry.gameId.startsWith("manual:")
      ? entry.gameId
      : `${entry.provider}-${entry.gameId}`;
    const existing = await getGameV2(prefixedId);
    const now = Date.now();
    // Extract appId from prefixed ID (e.g., "steam-3768760" → "3768760")
    const appIdMatch = prefixedId.match(/^(?:steam|lua)-(\d+)$/);
    const appId = existing?.appId || appIdMatch?.[1] || entry.gameId;

    // Check if ANY entry exists with this appId (lua, manual, debrid, steam)
    // to avoid creating ghost steam entries for games from other sources.
    let targetId = prefixedId;
    let targetExisting = existing;
    if (!existing && appId !== entry.gameId) {
      const { getGameV2ByAppId } = await import("./tauri");
      const matchByAppId = await getGameV2ByAppId(appId);
      if (matchByAppId) {
        targetId = matchByAppId.id;
        targetExisting = matchByAppId;
      }
    }

    const game: GameV2 = {
      id: targetId,
      title: targetExisting?.title || entry.title || "",
      source: targetExisting?.source || entry.provider,
      appId,
      providerGameId: targetExisting?.providerGameId || appId,
      libraryId: targetExisting?.libraryId || targetId,
      isInstalled: targetExisting?.isInstalled ?? true,
      lastPlayedAt: targetExisting?.lastPlayedAt,
      playtimeSeconds: targetExisting?.playtimeSeconds ?? 0,
      playCount: targetExisting?.playCount ?? 0,
      isFavorite: targetExisting?.isFavorite ?? false,
      isHidden: targetExisting?.isHidden ?? false,
      standalone: targetExisting?.standalone ?? false,
      hasLua: targetExisting?.hasLua ?? false,
      exePath: entry.exePath,
      exeName: entry.exeName,
      installDir: entry.installDir,
      createdAt: targetExisting?.createdAt ?? now,
      updatedAt: now,
    };
    await upsertGameV2(game);
    console.debug("[Registry] synced to DB", { gameId: entry.gameId, targetId });
  } catch (err) {
    console.warn("[Registry] DB sync failed", err);
  }
}

export async function discoverAndRegister(
  gameId: string,
  installDir: string,
  title: string | undefined,
  provider: InstalledGameEntry["provider"]
): Promise<InstalledGameEntry | null> {
  try {
    const executables = await discoverExecutables(installDir);
    if (executables.length === 0) return null;

    const candidates = executables.filter(
      (exe) => !isLauncherExe(exe.file_name)
    );
    if (candidates.length === 0) return null;

    // Priority 1: Win64/ directory
    const win64 = candidates.filter((e) => {
      const path = e.exe_path.replace(/\\/g, "/").toLowerCase();
      const parts = path.split("/");
      return parts.some((p) => p === "win64");
    });
    if (win64.length > 0) {
      const best = win64[0];
      return registerExe(gameId, installDir, best.exe_path, best.file_name, provider, title);
    }

    // Priority 2: /bin/ directory
    const bin = candidates.filter((e) => {
      const path = e.exe_path.replace(/\\/g, "/").toLowerCase();
      const parts = path.split("/");
      return parts.some((p) => p === "bin");
    });
    if (bin.length > 0) {
      const best = bin[0];
      return registerExe(gameId, installDir, best.exe_path, best.file_name, provider, title);
    }

    // Priority 3: Title keyword match
    if (title) {
      const titleWords = title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const titleMatch = candidates.find((exe) => {
        const base = exe.file_name.toLowerCase().replace(".exe", "");
        return titleWords.some(
          (word) => word.length > 3 && (base.includes(word) || word.includes(base))
        );
      });
      if (titleMatch) {
        return registerExe(gameId, installDir, titleMatch.exe_path, titleMatch.file_name, provider, title);
      }
    }

    // Priority 4: Root directory
    const installNorm = installDir.replace(/\\/g, "/").replace(/\/+$/, "");
    const rootCandidates = candidates.filter((e) => {
      const exeDir = e.exe_path.replace(/\\/g, "/");
      const lastSlash = exeDir.lastIndexOf("/");
      const dir = lastSlash >= 0 ? exeDir.substring(0, lastSlash) : exeDir;
      return dir === installNorm;
    });
    if (rootCandidates.length > 0) {
      const best = rootCandidates[0];
      return registerExe(gameId, installDir, best.exe_path, best.file_name, provider, title);
    }

    // Priority 5: Largest file
    const best = candidates[0];
    return registerExe(gameId, installDir, best.exe_path, best.file_name, provider, title);
  } catch (err) {
    console.warn("[Registry] discoverAndRegister failed", err);
    return null;
  }
}

async function registerExe(
  gameId: string,
  installDir: string,
  exePath: string,
  exeName: string,
  provider: InstalledGameEntry["provider"],
  title?: string,
): Promise<InstalledGameEntry> {
  const entry: InstalledGameEntry = {
    gameId,
    installDir,
    exePath,
    exeName,
    title,
    provider,
    lastValidated: Date.now(),
  };
  await setInstalledGameEntry(entry);
  return entry;
}

const COMMON_LAUNCHER_EXES = new Set([
  "setup.exe", "install.exe", "installer.exe", "uninstall.exe",
  "unins000.exe", "unins001.exe", "dxsetup.exe", "vcredist_x86.exe",
  "vcredist_x64.exe", "vc_redist.x86.exe", "vc_redist.x64.exe",
  "dotnetfx.exe", "directx.exe", "dxwebsetup.exe", "oalinst.exe",
  "gfwlivesetup.exe", "steam.exe", "steamwebhelper.exe",
  "epicgameslauncher.exe", "eosoverlay.exe", "eosoverlayrenderer.exe",
  "crashreporter.exe", "unitycrashhandler.exe", "ngscrt64.exe",
  "scp_service.exe", "gamerserviceservice.exe", "gamerservicesnet.exe",
  "gamerservicerenderer.exe", "updater.exe", "update.exe", "redist.exe",
  "launcher.exe", "launch.exe",
]);

function isLauncherExe(name: string): boolean {
  return COMMON_LAUNCHER_EXES.has(name.toLowerCase());
}
