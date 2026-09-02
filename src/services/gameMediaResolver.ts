/**
 * Media resolver — resolves media paths from disk and stores them in games_v2.
 *
 * After each scan (Steam, Epic, Debrid), call `resolveAndStoreMedia()` to:
 * 1. Check if media files exist on disk for each game
 * 2. Update games_v2 with the resolved paths
 *
 * This ensures the library grid always shows the correct media.
 */

import type { GameV2 } from "../types/gameV2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GameMediaPaths = {
  coverPath?: string | null;
  landscapePath?: string | null;
  backgroundPath?: string | null;
  logoPath?: string | null;
  iconPath?: string | null;
};

// ---------------------------------------------------------------------------
// Resolve media for a single game
// ---------------------------------------------------------------------------

/**
 * Resolve media paths for a single game from disk.
 * Returns the resolved paths, or null if no media found.
 */
async function resolveMediaForGame(
  source: string,
  appId: string
): Promise<GameMediaPaths | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    
    // For Steam and Lua games, use the appId directly (Lua wraps Steam appIds)
    if (source === "steam" || source === "lua") {
      const paths = await invoke<GameMediaPaths>("resolve_game_media_paths", { appId });
      return paths;
    }
    
    // For other providers, try using the provider path resolver
    const paths = await invoke<GameMediaPaths>("resolve_game_media_path", {
      provider: source,
      providerGameId: appId,
    });
    return paths;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Batch resolve media for multiple games
// ---------------------------------------------------------------------------

/**
 * Resolve media paths for a batch of games.
 * Returns a map of game ID → resolved media paths.
 */
async function resolveMediaBatch(
  games: GameV2[]
): Promise<Map<string, GameMediaPaths>> {
  const result = new Map<string, GameMediaPaths>();
  
  // Process in batches of 50 to avoid overwhelming the system
  const batchSize = 50;
  for (let i = 0; i < games.length; i += batchSize) {
    const batch = games.slice(i, i + batchSize);
    const promises = batch.map(async (game) => {
      const appId = game.appId ?? game.providerGameId ?? "";
      if (!appId) return;
      
      const paths = await resolveMediaForGame(game.source, appId);
      if (paths && (paths.coverPath || paths.landscapePath || paths.backgroundPath)) {
        result.set(game.id, paths);
      }
    });
    
    await Promise.all(promises);
  }
  
  console.log(`[MediaResolver] batch resolution complete: ${result.size}/${games.length} games found media`);
  return result;
}

// ---------------------------------------------------------------------------
// Main API: resolve and store media
// ---------------------------------------------------------------------------

/**
 * Resolve media for a batch of games and update games_v2 with the paths.
 * Call this after each scan to ensure media paths are stored in the database.
 */
export async function resolveAndStoreMedia(games: GameV2[]): Promise<void> {
  if (games.length === 0) return;
  
  console.log(`[MediaResolver] starting media resolution for ${games.length} games`);
  
  try {
    const { batchUpsertGamesV2 } = await import("./tauri");
    
    // Resolve media for all games
    const mediaMap = await resolveMediaBatch(games);
    
    console.log(`[MediaResolver] resolved media for ${mediaMap.size}/${games.length} games`);
    
    // Update games with resolved media paths
    const updatedGames: GameV2[] = [];
    let skippedNoChange = 0;
    for (const game of games) {
      const media = mediaMap.get(game.id);
      if (!media) continue;
      
      // Only update if we found new paths
      const needsUpdate =
        (media.coverPath && media.coverPath !== game.coverPath) ||
        (media.landscapePath && media.landscapePath !== game.landscapePath) ||
        (media.backgroundPath && media.backgroundPath !== game.backgroundPath) ||
        (media.logoPath && media.logoPath !== game.logoPath) ||
        (media.iconPath && media.iconPath !== game.iconPath);
      
      if (needsUpdate) {
        updatedGames.push({
          ...game,
          coverPath: media.coverPath ?? game.coverPath,
          landscapePath: media.landscapePath ?? game.landscapePath,
          backgroundPath: media.backgroundPath ?? game.backgroundPath,
          logoPath: media.logoPath ?? game.logoPath,
          iconPath: media.iconPath ?? game.iconPath,
          updatedAt: Date.now(),
        });
      } else {
        skippedNoChange++;
      }
    }
    
    console.log(`[MediaResolver] ${updatedGames.length} need update, ${skippedNoChange} already current`);
    
    // Batch update in database
    if (updatedGames.length > 0) {
      await batchUpsertGamesV2(updatedGames);
      console.log(`[MediaResolver] persisted ${updatedGames.length} games with resolved media paths`);
    }
  } catch (err) {
    console.warn("[MediaResolver] failed to resolve and store media:", err);
  }
}

/**
 * Resolve media for a single game and update games_v2.
 * Useful for individual game updates (e.g., after metadata refresh).
 */
export async function resolveAndStoreMediaForGame(game: GameV2): Promise<void> {
  await resolveAndStoreMedia([game]);
}
