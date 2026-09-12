import type { LibraryGame } from "../types/libraryGame";
import { dedupeLibraryGames } from "./gameCacheService";

type DetectedGamesCache = {
  savedAt: number;
  games: LibraryGame[];
  warnings?: string[];
  errors?: string[];
};

let inMemoryCache: DetectedGamesCache | null = null;

const MEDIA_PATH_FIELDS = ["coverPath", "landscapePath", "backgroundPath", "logoPath", "iconPath"] as const;
const RELATIVE_RE = /^(media|img)\//;

function isRelativeMedia(p: string | null | undefined): p is string {
  return !!p && RELATIVE_RE.test(p);
}

async function resolveMediaPathsBatch(games: LibraryGame[]): Promise<void> {
  const { resolveRelativeMediaPath } = await import("./gameCacheService");
  const tasks: Promise<void>[] = [];
  for (const g of games) {
    for (const field of MEDIA_PATH_FIELDS) {
      const val = (g as Record<string, unknown>)[field];
      if (isRelativeMedia(val as string)) {
        const appId = g.appId ?? "";
        const provider = g.source === "lua" ? "steam" : g.source;
        tasks.push(
          resolveRelativeMediaPath(appId, val as string, provider).then((abs) => {
            (g as Record<string, unknown>)[field] = abs;
          }),
        );
      }
    }
  }
  if (tasks.length > 0) {
    await Promise.allSettled(tasks);
  }
}

/**
 * Load ALL games from games_v2 (single source of truth).
 * Returns a DetectedGamesCache-compatible object for use by LibraryGamesContext.
 * Steam, Lua, Manual, Epic, Debrid — everything comes from games_v2.
 *
 * games_v2 is populated by boot coordinator Stage 4.5 (reconcile) and by each
 * provider's persist function. If games_v2 is empty, the caller should use
 * reconciled/snapshot data as fallback.
 */
export async function loadCachedGamesFromV2(): Promise<DetectedGamesCache | null> {
  if (inMemoryCache) return inMemoryCache;

  try {
    const { getAllGamesV2 } = await import("./tauri");
    const { gameV2ToLibraryGame } = await import("./gameV2Mapper");

    const allGames = await getAllGamesV2();
    if (allGames.length > 0) {
      const libGames = allGames.map((g) => gameV2ToLibraryGame(g));

      // Resolve relative media paths (media/landscape.jpg → absolute) so
      // desktop components can use them with localPathToUrl / asset:// URLs
      await resolveMediaPathsBatch(libGames);

      const deduped = dedupeLibraryGames(libGames);

      const cache: DetectedGamesCache = {
        savedAt: Date.now(),
        games: deduped,
      };
      inMemoryCache = cache;
      const bySource: Record<string, number> = {};
      for (const g of deduped) { const s = g.source || "unknown"; bySource[s] = (bySource[s] || 0) + 1; }
      console.log(`[GAMES_V2][READ] loadCachedGamesFromV2 → ${deduped.length} games bySource=${JSON.stringify(bySource)}`);
      return cache;
    }
    console.log("[GAMES_V2][READ] loadCachedGamesFromV2 → empty (no games in games_v2)");
  } catch (e) {
    console.warn("[GAMES_V2] failed to load from games_v2:", e);
  }

  return null;
}

/**
 * Seed games_v2 from library_cache games (one-time migration on boot).
 * Converts each LibraryGame to GameV2 and upserts into the unified table.
 * This ensures games_v2 is populated for subsequent boots.
 */
async function seedGamesV2FromLibraryCache(games: LibraryGame[]): Promise<void> {
  try {
    const { batchUpsertGamesV2, deleteStaleGamesV2 } = await import("./tauri");
    const { libraryGameToGameV2 } = await import("./gameV2Mapper");

    const entries = games
      .filter((g) => g.appId || g.libraryId)
      .map((g) => libraryGameToGameV2(g));

    if (entries.length === 0) return;

    const activeIds = entries.map((e) => e.id).filter((id): id is string => !!id);
    const deleted = await deleteStaleGamesV2(activeIds);
    if (deleted > 0) {
      console.log(`[GAMES_V2] cleaned ${deleted} orphaned steam/lua rows before upsert`);
    }

    await batchUpsertGamesV2(entries);
    console.log(`[GAMES_V2] seeded ${entries.length} games into games_v2 from library_cache`);
  } catch (e) {
    console.warn("[GAMES_V2] failed to seed games_v2 from library_cache:", e);
  }
}

export async function saveCachedGames(
  games: LibraryGame[],
  warnings?: string[],
  errors?: string[],
): Promise<void> {
  const deduped = dedupeLibraryGames(games);
  if (deduped.length !== games.length) {
    console.log(`[GAMES_V2][DEDUP] before=${games.length} after=${deduped.length}`);
  }
  if (deduped.length === 0) {
    console.log("[GAMES_V2][EMPTY_SKIP] refusing to persist empty library");
    return;
  }
  const bySource: Record<string, number> = {};
  for (const g of deduped) { const s = g.source || "unknown"; bySource[s] = (bySource[s] || 0) + 1; }
  console.log(`[GAMES_V2][WRITE] saveCachedGames → ${deduped.length} games bySource=${JSON.stringify(bySource)}`);

  const cache: DetectedGamesCache = {
    savedAt: Date.now(),
    games: deduped,
    warnings,
    errors,
  };
  inMemoryCache = cache;

  // Write to games_v2 (unified table) — library_cache blob is deprecated and no longer read on boot
  try {
    await seedGamesV2FromLibraryCache(deduped);
  } catch {
    // SQLite unavailable
  }
}

/** Invalidate the in-memory cache so next loadCachedGamesFromV2() re-reads from games_v2. */
export function invalidateGamesV2Cache(): void {
  inMemoryCache = null;
}
