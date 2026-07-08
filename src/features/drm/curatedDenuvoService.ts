import type { CuratedDenuvoIndex } from "./curatedDenuvoIndex";

const REMOTE_DENUVO_INDEX_URL =
  "https://raw.githubusercontent.com/eisora08/lumaforge/feature/store-drm-provider-updates/public/data/drm/denuvo-index.json";

export const DEFAULT_REMOTE_DENUVO_INDEX_URL = REMOTE_DENUVO_INDEX_URL;

const BUNDLED_JSON_PATH = "/data/drm/denuvo-index.json";

const REMOTE_FETCH_TIMEOUT_MS = 10_000;

let _cachedIndex: CuratedDenuvoIndex | null = null;
let _loadPromise: Promise<CuratedDenuvoIndex> | null = null;

const EMPTY_INDEX: CuratedDenuvoIndex = {
  schemaVersion: 0,
  updatedAt: "",
  sources: [],
  entries: [],
};

function isSchemaV1(index: unknown): index is CuratedDenuvoIndex {
  return (
    typeof index === "object" &&
    index !== null &&
    "schemaVersion" in index &&
    (index as CuratedDenuvoIndex).schemaVersion === 1
  );
}

async function fetchRemote(): Promise<CuratedDenuvoIndex | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(REMOTE_DENUVO_INDEX_URL, {
      signal: controller.signal,
    });
    if (!response.ok) {
      console.log(
        "[STORE][DRM_CURATED_INDEX_LOAD] source=remote ok=false reason=http-" + response.status,
      );
      return null;
    }
    const json: unknown = await response.json();
    if (!isSchemaV1(json)) {
      console.log(
        "[STORE][DRM_CURATED_INDEX_LOAD] source=remote ok=false reason=bad-schema schemaVersion=" + JSON.stringify((json as Record<string, unknown>)?.schemaVersion),
      );
      return null;
    }
    return json;
  } catch (err) {
    const reason = err instanceof DOMException && err.name === "AbortError"
      ? "timeout"
      : String(err);
    console.log(
      "[STORE][DRM_CURATED_INDEX_LOAD] source=remote ok=false reason=\"" + reason + "\"",
    );
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchLocal(): Promise<CuratedDenuvoIndex | null> {
  try {
    const response = await fetch(BUNDLED_JSON_PATH);
    if (!response.ok) {
      console.log(
        "[STORE][DRM_CURATED_INDEX_LOAD] source=local ok=false reason=http-" + response.status,
      );
      return null;
    }
    const json: unknown = await response.json();
    if (!isSchemaV1(json)) {
      console.log(
        "[STORE][DRM_CURATED_INDEX_LOAD] source=local ok=false reason=bad-schema schemaVersion=" + JSON.stringify((json as Record<string, unknown>)?.schemaVersion),
      );
      return null;
    }
    return json;
  } catch (err) {
    console.log(
      "[STORE][DRM_CURATED_INDEX_LOAD] source=local ok=false reason=\"" + String(err) + "\"",
    );
    return null;
  }
}

export async function loadCuratedDenuvoIndex(): Promise<CuratedDenuvoIndex> {
  if (_cachedIndex) return _cachedIndex;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    const remote = await fetchRemote();
    if (remote) {
      _cachedIndex = remote;
      console.log(
        "[STORE][DRM_CURATED_INDEX_LOAD] source=remote ok=true entries=" + remote.entries.length,
      );
      return remote;
    }

    const local = await fetchLocal();
    if (local) {
      _cachedIndex = local;
      console.log(
        "[STORE][DRM_CURATED_INDEX_LOAD] source=local ok=true entries=" + local.entries.length,
      );
      return local;
    }

    console.log("[STORE][DRM_CURATED_INDEX_LOAD] source=none ok=false");
    _cachedIndex = EMPTY_INDEX;
    return EMPTY_INDEX;
  })();

  return _loadPromise;
}

export function getCuratedDenuvoIndexCached(): CuratedDenuvoIndex | null {
  return _cachedIndex;
}

export function clearCuratedDenuvoCache(): void {
  _cachedIndex = null;
  _loadPromise = null;
}
