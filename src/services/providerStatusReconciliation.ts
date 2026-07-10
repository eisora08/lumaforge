import type { LibraryGame } from "../types/libraryGame";

const POST_SNAPSHOT_RECONCILE_DELAY_MS = 2000;
const PROVIDER_STATUS_RECONCILE_TTL_MS = 300000;

let _reconcileScheduled = false;
let _reconcileComplete = false;
const _reconciledTimestamps = new Map<string, number>();

function resolveSourceForInstallState(
  currentSource: LibraryGame["source"],
  steamInstalled: boolean,
  hasLua: boolean,
): LibraryGame["source"] {
  if (steamInstalled) return "steam";
  if (hasLua) return "lua";
  return currentSource;
}

export function schedulePostSnapshotSteamReconciliation(
  games: LibraryGame[],
  updateGame: (appId: string, updates: Partial<LibraryGame>) => void,
  options: { steamRoot?: string },
): void {
  if (_reconcileScheduled) return;
  _reconcileScheduled = true;

  setTimeout(async () => {
    try {
      const steamRoot = options.steamRoot;
      if (!steamRoot) {
        console.log("[PROVIDER][RECONCILE_SKIP] reason=no-steam-root");
        return;
      }

      const { scanSteamInstalledGames: doScan } = await import("./tauri");
      const scanResult = await doScan({ steamPath: steamRoot });
      const installedAppIds = new Set(scanResult.map((g) => String(g.appId)));

      let updatedCount = 0;
      const seen = new Set<string>();
      for (const game of games) {
        if (!game.appId || seen.has(game.appId)) continue;
        seen.add(game.appId);

        const isSteamInstalled = installedAppIds.has(game.appId);
        const needsUpdate = game.steamInstalled !== isSteamInstalled;

        if (needsUpdate) {
          const newSource = resolveSourceForInstallState(
            game.source,
            isSteamInstalled,
            game.hasLua,
          );

          const updates: Partial<LibraryGame> = {
            steamInstalled: isSteamInstalled,
            isPlayable: isSteamInstalled,
            isInstallable: !isSteamInstalled,
            source: newSource,
          };

          if (isSteamInstalled) {
            const match = scanResult.find((g) => String(g.appId) === game.appId);
            updates.installDir = (match as Record<string, unknown>)?.installDir as string | undefined ?? game.installDir;
          } else {
            updates.installDir = undefined;
          }

          updateGame(game.appId, updates);
          updatedCount++;
          console.log(
            `[PROVIDER][RECONCILE] appid=${game.appId} title=${game.title} ` +
            `steamInstalled=${game.steamInstalled}->${isSteamInstalled} ` +
            `source=${game.source}->${newSource}`,
          );
        }
      }

      _reconcileComplete = true;
      if (updatedCount > 0) {
        console.log(`[PROVIDER][RECONCILE_DONE] checked=${seen.size} updated=${updatedCount}`);
      }
    } catch (error) {
      console.warn("[PROVIDER][RECONCILE_FAILED]", error);
      _reconcileScheduled = false;
    }
  }, POST_SNAPSHOT_RECONCILE_DELAY_MS);
}

export async function refreshSingleGameSteamStatus(
  appId: string,
  options: { steamRoot?: string; force?: boolean },
): Promise<{ steamInstalled: boolean } | null> {
  const now = Date.now();
  const lastChecked = _reconciledTimestamps.get(appId);

  if (!options.force && lastChecked && now - lastChecked < PROVIDER_STATUS_RECONCILE_TTL_MS) {
    console.log(
      `[PROVIDER][REFRESH_SKIP] appid=${appId} reason=fresh ageMs=${now - lastChecked}`,
    );
    return null;
  }

  try {
    const steamRoot = options.steamRoot;
    if (!steamRoot) {
      console.log(`[PROVIDER][REFRESH_SKIP] appid=${appId} reason=no-steam-root`);
      return null;
    }

    const { scanSteamInstalledGames: doScan } = await import("./tauri");
    const scanResult = await doScan({ steamPath: steamRoot });
    const isInstalled = scanResult.some((g) => String(g.appId) === appId);

    _reconciledTimestamps.set(appId, now);

    console.log(`[PROVIDER][REFRESH] appid=${appId} steamInstalled=${isInstalled}`);
    return { steamInstalled: isInstalled };
  } catch (error) {
    console.warn(`[PROVIDER][REFRESH_FAILED] appid=${appId}`, error);
    return null;
  }
}

export function isProviderStatusReconcileComplete(): boolean {
  return _reconcileComplete;
}

export function resetProviderStatusReconciliation(): void {
  _reconcileScheduled = false;
  _reconcileComplete = false;
  _reconciledTimestamps.clear();
}
