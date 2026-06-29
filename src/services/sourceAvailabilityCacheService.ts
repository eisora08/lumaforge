import { invoke } from "@tauri-apps/api/core";
import type { PackageSource } from "../types/package";

const ENABLE_VERBOSE_SOURCE_LOGS = false;

export type SourceCheckStatus =
  | "idle"
  | "checking"
  | "ready"
  | "none"
  | "error"
  | "timeout";

export interface SourceAvailabilitySourceEntry {
  id: string;
  name: string;
  type: string;
  status: string;
  packageUrl?: string;
  updatedAt?: number;
}

export interface SourceAvailabilityGameEntry {
  appId: string;
  title: string;
  status: SourceCheckStatus;
  luaReady: boolean;
  selectedSourceId?: string;
  availableSources: SourceAvailabilitySourceEntry[];
  sourceCount: number;
  totalProviderCount: number;
  updatedAt: number;
}

export interface SourceAvailabilityIndex {
  version: number;
  updatedAt: number;
  games: Record<string, SourceAvailabilityGameEntry>;
}

let cachedIndex: SourceAvailabilityIndex | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let loadPromise: Promise<SourceAvailabilityIndex> | null = null;

function log(...args: unknown[]) {
  if (ENABLE_VERBOSE_SOURCE_LOGS) {
    console.log("[SourceCache]", ...args);
  }
}

async function loadFromDisk(): Promise<SourceAvailabilityIndex> {
  try {
    const result = await invoke<SourceAvailabilityIndex | null>(
      "read_source_availability_index"
    );
    if (result) {
      log(`loaded entries ${Object.keys(result.games).length}`);
      return result;
    }
  } catch {
    log("load failed");
  }
  return { version: 1, updatedAt: 0, games: {} };
}

export async function loadSourceAvailabilityIndex(): Promise<SourceAvailabilityIndex> {
  if (cachedIndex) return cachedIndex;
  if (loadPromise) return loadPromise;
  loadPromise = loadFromDisk().then((idx) => {
    cachedIndex = idx;
    return idx;
  });
  return loadPromise;
}

export function getSourceAvailability(
  appId: string
): SourceAvailabilityGameEntry | undefined {
  return cachedIndex?.games[appId];
}

export function getCachedSourceAvailabilityIndex(): SourceAvailabilityIndex | null {
  return cachedIndex;
}

export async function updateSourceAvailability(
  appId: string,
  entry: SourceAvailabilityGameEntry
): Promise<void> {
  await loadSourceAvailabilityIndex();
  if (!cachedIndex) return;
  cachedIndex.games[appId] = entry;
  cachedIndex.updatedAt = Math.floor(Date.now() / 1000);
  scheduleSave();
  log(`updated ${appId} (${entry.title})`);
}

export async function markSourceUnavailable(
  appId: string,
  _reason: string
): Promise<void> {
  await loadSourceAvailabilityIndex();
  if (!cachedIndex) return;
  const existing = cachedIndex.games[appId];
  if (existing) {
    existing.status = "none";
    existing.luaReady = false;
    existing.availableSources = [];
    existing.sourceCount = 0;
    existing.updatedAt = Math.floor(Date.now() / 1000);
  }
  scheduleSave();
  log(`marked unavailable ${appId}: ${_reason}`);
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (cachedIndex) {
      try {
        await invoke("write_source_availability_index", {
          index: cachedIndex,
        });
        log(
          `saved source-index (${Object.keys(cachedIndex.games).length} entries)`
        );
      } catch {
        console.warn("[SourceCache] save failed");
      }
    }
  }, 2000);
}

export async function saveSourceAvailabilityIndexNow(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!cachedIndex) return;
  try {
    await invoke("write_source_availability_index", {
      index: cachedIndex,
    });
    log("saved source-index immediately");
  } catch {
    console.warn("[SourceCache] immediate save failed");
  }
}

export function buildSourceAvailabilityFromProviders(
  appId: string,
  title: string,
  sources: PackageSource[],
  totalProviderCount: number
): SourceAvailabilityGameEntry {
  const availableSources = sources.filter((s) => s.available);
  const status: SourceCheckStatus = availableSources.length > 0 ? "ready" : "none";
  return {
    appId,
    title,
    status,
    luaReady: availableSources.length > 0,
    selectedSourceId:
      availableSources.length > 0 ? availableSources[0].providerId : undefined,
    availableSources: availableSources.map((s) => ({
      id: s.providerId,
      name: s.providerName,
      type: s.fileType,
      status: s.available ? "ready" : "unavailable",
      packageUrl: s.downloadUrl,
      updatedAt: s.checkedAt
        ? Math.floor(new Date(s.checkedAt).getTime() / 1000)
        : undefined,
    })),
    sourceCount: availableSources.length,
    totalProviderCount,
    updatedAt: Math.floor(Date.now() / 1000),
  };
}
