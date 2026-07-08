import type { SteamAppMetadata } from "../../types/gameMetadata";
import type { StoreDrmInfo } from "./storeDrmInfo";
import type { CuratedDenuvoEntry } from "./curatedDenuvoIndex";
import { extractStoreDrmInfo, applyCuratedDenuvoFallback } from "./storeDrmInfo";
import { loadCuratedDenuvoIndex, getCuratedDenuvoIndexCached } from "./curatedDenuvoService";
import { matchCuratedDenuvoEntry } from "./curatedDenuvoIndex";
import { fetchSteamStoreDrmNotice } from "../../services/tauri";

const drmInfoByAppId = new Map<string, StoreDrmInfo>();
const inFlightByAppId = new Map<string, Promise<StoreDrmInfo>>();

/**
 * Resolve DRM info for a single details-page appId.
 *
 * Priority chain:
 *   1. extractStoreDrmInfo(metadata) — checks legal_notice, store_drm_notice, descriptions
 *   2. Curated Denuvo JSON index
 *   3. Steam Store HTML fetch — single appId, cached per session
 */
export async function resolveStoreDrmInfoForDetails(params: {
  appId: string | number;
  metadata: SteamAppMetadata | undefined;
  title?: string | null;
  developerNames?: string[];
  publisherNames?: string[];
}): Promise<StoreDrmInfo> {
  const appIdStr = String(params.appId);

  const cached = drmInfoByAppId.get(appIdStr);
  if (cached) return cached;

  const inFlight = inFlightByAppId.get(appIdStr);
  if (inFlight) return inFlight;

  const promise = resolveDrmInfoInner(params);
  inFlightByAppId.set(appIdStr, promise);
  const result = await promise;
  drmInfoByAppId.set(appIdStr, result);
  inFlightByAppId.delete(appIdStr);
  return result;
}

async function resolveDrmInfoInner(params: {
  appId: string | number;
  metadata: SteamAppMetadata | undefined;
  title?: string | null;
  developerNames?: string[];
  publisherNames?: string[];
}): Promise<StoreDrmInfo> {
  // Step 1: extract from metadata
  const base = extractStoreDrmInfo(params.metadata);
  if (base.source !== "none") return base;

  // Step 2: try curated Denuvo index
  const curatedEntry = await resolveCuratedEntry(params);
  if (curatedEntry) {
    const withCurated = applyCuratedDenuvoFallback(base, curatedEntry);
    if (withCurated.source !== "none") return withCurated;
  }

  // Step 3: fetch Steam Store HTML for this single appId
  const appIdNum = typeof params.appId === "number" ? params.appId : Number(params.appId);
  try {
    const drmNotice = await fetchSteamStoreDrmNotice(appIdNum);
    if (drmNotice) {
      return {
        hasThirdPartyDrm: true,
        hasDenuvo: drmNotice.toLowerCase().includes("denuvo"),
        drmNames: drmNotice.toLowerCase().includes("denuvo")
          ? ["Denuvo Anti-Tamper"]
          : ["Third-party DRM"],
        source: "steam-html",
        matchedText: drmNotice,
      };
    }
  } catch {
    // HTML fetch failed, keep source="none"
  }

  return base;
}

async function resolveCuratedEntry(params: {
  appId: string | number;
  title?: string | null;
  developerNames?: string[];
  publisherNames?: string[];
}): Promise<CuratedDenuvoEntry | undefined> {
  const cached = getCuratedDenuvoIndexCached();
  const index = cached ?? (await loadCuratedDenuvoIndex());
  if (!index || index.entries.length === 0) return undefined;

  return matchCuratedDenuvoEntry({
    appId: params.appId,
    title: params.title,
    developerNames: params.developerNames ?? [],
    publisherNames: params.publisherNames ?? [],
    index,
  });
}

export function clearDrmInfoCache(): void {
  drmInfoByAppId.clear();
  inFlightByAppId.clear();
}

export function getDrmInfoCacheSnapshot(): Record<string, StoreDrmInfo> {
  const result: Record<string, StoreDrmInfo> = {};
  for (const [k, v] of drmInfoByAppId) result[k] = v;
  return result;
}
