import { invoke } from "@tauri-apps/api/core";

export type ArtworkCacheEntry = {
  app_id: number;
  grid_url?: string | null;
  grid_thumb_url?: string | null;
  hero_url?: string | null;
  logo_url?: string | null;
  cached_at: number;
};

export type ArtworkCacheIndex = Record<number, ArtworkCacheEntry>;

export type DownloadKind = "grid" | "grid_thumb" | "hero" | "logo";

async function readArtworkCacheIndex(): Promise<ArtworkCacheIndex> {
  return await invoke<ArtworkCacheIndex>("read_artwork_cache_index");
}

async function writeArtworkCacheIndex(index: ArtworkCacheIndex): Promise<void> {
  await invoke("write_artwork_cache_index", { index });
}

async function cacheRemoteArtwork(
  url: string,
  appId: number,
  kind: DownloadKind
): Promise<string> {
  return await invoke<string>("cache_remote_artwork", { url, appId, kind });
}

async function clearArtworkCacheForGame(appId: number): Promise<void> {
  await invoke("clear_artwork_cache_for_game", { appId });
}

async function clearAllArtworkCache(): Promise<void> {
  await invoke("clear_all_artwork_cache");
}

const tauriArtworkCache = {
  readArtworkCacheIndex,
  writeArtworkCacheIndex,
  cacheRemoteArtwork,
  clearArtworkCacheForGame,
  clearAllArtworkCache,
};

export default tauriArtworkCache;
