import { convertFileSrc } from "@tauri-apps/api/core";
import {
  readLibraryAppinfo,
  updateLibraryAppinfoEntry,
  readLibraryGameDetails,
  writeLibraryGameDetails,
  getGameMediaCache,
  saveGameMediaCache,
  clearGameMediaCache,
  readImageAsDataUrl,
} from "./tauri";

import type {
  LibraryAppInfoEntry,
  LibraryAppInfoMap,
  LibraryGameDetailsEntry,
  GameMediaCacheEntry,
} from "./tauri";

// ---------------------------------------------------------------------------
// In-memory appinfo cache
// ---------------------------------------------------------------------------

let _appInfoCache: LibraryAppInfoMap | null = null;

async function ensureAppInfoLoaded(): Promise<LibraryAppInfoMap> {
  if (_appInfoCache === null) {
    try {
      _appInfoCache = await readLibraryAppinfo();
    } catch {
      _appInfoCache = {};
    }
  }
  return _appInfoCache!;
}

export function clearAppInfoMemoryCache(): void {
  _appInfoCache = null;
}

export async function loadLibraryAppInfo(): Promise<LibraryAppInfoMap> {
  return await ensureAppInfoLoaded();
}

export async function getLibraryAppInfo(
  appId: string
): Promise<LibraryAppInfoEntry | null> {
  const map = await ensureAppInfoLoaded();
  return map[appId] ?? null;
}

export async function updateLibraryAppInfo(
  appId: string,
  entry: LibraryAppInfoEntry
): Promise<boolean> {
  try {
    await updateLibraryAppinfoEntry(appId, entry);
    if (_appInfoCache) {
      _appInfoCache[appId] = entry;
    }
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Game details (details/{appid}.json)
// ---------------------------------------------------------------------------

export async function getLibraryGameDetails(
  appId: string
): Promise<LibraryGameDetailsEntry | null> {
  try {
    return await readLibraryGameDetails(appId);
  } catch {
    return null;
  }
}

export async function saveLibraryGameDetails(
  appId: string,
  metadata: LibraryGameDetailsEntry
): Promise<boolean> {
  try {
    await writeLibraryGameDetails(appId, metadata);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Game media key – stable key generation
// ---------------------------------------------------------------------------

function stableHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export type GameMediaKeyInput = {
  appId?: string;
  id?: string;
  executablePath?: string;
  source?: string;
};

export function getGameMediaKey(game: GameMediaKeyInput): string {
  if (game.appId) {
    return `steam-${game.appId}`;
  }
  if (game.id) {
    return `local-${game.id}`;
  }
  if (game.executablePath) {
    return `exe-${stableHash(game.executablePath)}`;
  }
  return `unknown-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Game media cache (media/{game_key}/metadata.json)
// ---------------------------------------------------------------------------

export async function getGameMediaCacheForGame(
  game: GameMediaKeyInput
): Promise<GameMediaCacheEntry | null> {
  const key = getGameMediaKey(game);
  try {
    return await getGameMediaCache(key);
  } catch {
    return null;
  }
}

export async function saveGameMediaCacheForGame(
  game: GameMediaKeyInput,
  entry: GameMediaCacheEntry
): Promise<GameMediaCacheEntry | null> {
  const key = getGameMediaKey(game);
  try {
    return await saveGameMediaCache(key, entry);
  } catch {
    return null;
  }
}

export async function clearGameMediaCacheForGame(
  game: GameMediaKeyInput
): Promise<boolean> {
  const key = getGameMediaKey(game);
  try {
    await clearGameMediaCache(key);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Data normalization helpers
// ---------------------------------------------------------------------------

export function normalizeAppId(value: unknown): string {
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

export function isValidAppId(value: unknown): value is string {
  if (typeof value === "string") {
    return /^\d{1,10}$/.test(value.trim());
  }
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 && value <= 9999999999;
  }
  return false;
}

export function nowTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

export function pickTitleFromLocalCache(
  _game: { title?: string },
  appinfoEntry: LibraryAppInfoEntry | null
): string | null {
  // Priority: appinfo name > game.title (where game.title already has manifest > metadata > fallback)
  if (appinfoEntry?.name) {
    return appinfoEntry.name;
  }
  return null;
}

export function computeDisplayTitle(
  game: { title: string; appId?: string },
  appinfoEntry: LibraryAppInfoEntry | null,
): string {
  if (appinfoEntry?.name) return appinfoEntry.name;
  return game.title || (game.appId ? `Steam App ${game.appId}` : "Unknown Game");
}

export function pickImageFromLocalCache(
  _game: { imageUrl?: string },
  appinfoEntry: LibraryAppInfoEntry | null,
  mediaEntry: GameMediaCacheEntry | null
): string | null {
  if (mediaEntry?.grid_path) {
    return mediaEntry.grid_path;
  }
  if (mediaEntry?.cover_path) {
    return mediaEntry.cover_path;
  }
  if (appinfoEntry?.cover_path) {
    return appinfoEntry.cover_path;
  }
  if (appinfoEntry?.grid_path) {
    return appinfoEntry.grid_path;
  }
  if (appinfoEntry?.header_image) {
    return appinfoEntry.header_image;
  }
  if (appinfoEntry?.hero_path) {
    return appinfoEntry.hero_path;
  }
  return null;
}

export function pickSidebarImage(
  _game: { imageUrl?: string },
  appinfoEntry: LibraryAppInfoEntry | null,
  mediaEntry: GameMediaCacheEntry | null
): string | null {
  if (mediaEntry?.icon_path) {
    return mediaEntry.icon_path;
  }
  if (appinfoEntry?.icon_path) {
    return appinfoEntry.icon_path;
  }
  if (mediaEntry?.grid_path) {
    return mediaEntry.grid_path;
  }
  if (mediaEntry?.cover_path) {
    return mediaEntry.cover_path;
  }
  if (appinfoEntry?.cover_path) {
    return appinfoEntry.cover_path;
  }
  if (appinfoEntry?.grid_path) {
    return appinfoEntry.grid_path;
  }
  if (appinfoEntry?.header_image) {
    return appinfoEntry.header_image;
  }
  return null;
}

export function isHttpUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

export function isLocalPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/");
}

/**
 * Convert a local file path to a URL the webview can load.
 * HTTP URLs are returned as-is.
 */
export function localPathToUrl(path: string): string {
  if (isHttpUrl(path)) return path;
  try {
    return convertFileSrc(path, "asset");
  } catch {
    return path;
  }
}

export async function resolveLocalImageAsDataUrl(path: string): Promise<string | null> {
  if (isHttpUrl(path)) return path;
  try {
    return await readImageAsDataUrl(path);
  } catch {
    return null;
  }
}
