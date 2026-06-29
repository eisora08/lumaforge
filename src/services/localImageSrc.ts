import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveGameMediaPaths } from "./tauri";

const ENABLE_VERBOSE_LOCAL_IMAGE_LOGS = false;

function isHttpUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

function isLocalPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/");
}

function isTmpPath(path: string): boolean {
  return path.endsWith(".tmp");
}

/**
 * resolveLocalImageSrc — safely convert a raw file path to a usable
 * <img> src. Returns null for null/undefined/empty input, passes through
 * http/https/data: URLs unchanged, converts local filesystem paths via
 * convertFileSrc("asset").
 * Never returns .tmp paths — those are intermediate files that should
 * never reach AsyncImage.
 */
export function resolveLocalImageSrc(path: string | null | undefined): string | null {
  if (!path) return null;
  if (isHttpUrl(path)) return path;
  if (isTmpPath(path)) {
    if (ENABLE_VERBOSE_LOCAL_IMAGE_LOGS) {
      console.log("[MediaCache] ignored tmp path —", path);
    }
    return null;
  }
  if (isLocalPath(path)) {
    try {
      return convertFileSrc(path, "asset");
    } catch {
      if (ENABLE_VERBOSE_LOCAL_IMAGE_LOGS) {
        console.warn("[localImageSrc] convertFileSrc failed for", path);
      }
      return null;
    }
  }
  return path;
}

/**
 * resolveGameMediaImageSrc — last-resort disk check. Directly invokes the
 * Rust command to check for landscape.jpg/cover.jpg, bypassing all caches.
 * Returns the converted asset:// URL for the best available image, or null.
 * Components should call this only when their primary resolution chain
 * (loadGameAppInfoWithMediaFallback) returns nothing usable.
 */
export async function resolveGameMediaImageSrc(appId: string): Promise<string | null> {
  try {
    const paths = await resolveGameMediaPaths(appId);
    if (!paths) return null;
    const raw = paths.landscapePath || paths.coverPath;
    if (!raw) return null;
    // resolveGameMediaPaths now repairs .tmp files, but filter defensively
    if (raw.endsWith(".tmp")) {
      if (ENABLE_VERBOSE_LOCAL_IMAGE_LOGS) {
        console.log("[MediaCache] ignored tmp path from resolve —", raw);
      }
      return null;
    }
    return resolveLocalImageSrc(raw);
  } catch {
    if (ENABLE_VERBOSE_LOCAL_IMAGE_LOGS) {
      console.warn("[localImageSrc] resolveGameMediaImageSrc failed for", appId);
    }
    return null;
  }
}
