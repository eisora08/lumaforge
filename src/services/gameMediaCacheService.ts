import { invoke } from "@tauri-apps/api/core";

export type GameMediaCacheEntry = {
  coverPath?: string;
  gridPath?: string;
  heroPath?: string;
  logoPath?: string;
  iconPath?: string;
  updatedAt?: number;
};

export type GameMediaCacheIndex = Record<string, GameMediaCacheEntry>;

export async function getGameMedia(gameKey: string): Promise<GameMediaCacheEntry | null> {
  try {
    return await invoke<GameMediaCacheEntry | null>("get_game_media_cache", { gameKey });
  } catch {
    return null;
  }
}

export async function getAllGameMedia(): Promise<GameMediaCacheIndex> {
  try {
    return await invoke<GameMediaCacheIndex>("get_all_game_media_cache");
  } catch {
    return {};
  }
}

export async function saveGameMedia(
  gameKey: string,
  media: GameMediaCacheEntry
): Promise<GameMediaCacheEntry | null> {
  try {
    return await invoke<GameMediaCacheEntry>("save_game_media_cache", { gameKey, media });
  } catch {
    return null;
  }
}

export async function clearGameMedia(gameKey: string): Promise<boolean> {
  try {
    await invoke("clear_game_media_cache", { gameKey });
    return true;
  } catch {
    return false;
  }
}

export async function clearAllGameMedia(): Promise<boolean> {
  try {
    await invoke("clear_all_game_media_cache");
    return true;
  } catch {
    return false;
  }
}

export function computeGameKey(game: {
  appId?: string;
  id?: string;
  executablePath?: string;
}): string {
  if (game.appId) return `steam-${game.appId}`;
  if (game.id) return game.id;
  if (game.executablePath) {
    let hash = 0;
    const str = game.executablePath;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0;
    }
    return `local-${Math.abs(hash).toString(16)}`;
  }
  return `unknown-${Date.now()}`;
}
