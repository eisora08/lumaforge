/**
 * Repository Loader — Parse a local index.json and resolve manifests.
 *
 * Reads a repository index (local file), resolves each extension entry
 * to its manifest.json, and returns validated ExtensionManifestV1 objects.
 *
 * Fully offline — all files are local.
 * No network calls, no HTTP, no external I/O.
 */

import type { ExtensionManifestV1, RepositoryIndex, RepositoryExtensionEntry } from "../types";
import { loadManifestFromObject } from "../manifests";
import { RepositoryIndexError, ManifestParseError, ManifestValidationError, SchemaVersionUnsupportedError } from "../errors";

// =============================================================================
// Types
// =============================================================================

export interface RepositoryLoadResult {
  index: RepositoryIndex;
  manifests: Array<{ entry: RepositoryExtensionEntry; manifest: ExtensionManifestV1 }>;
  errors: Array<{ entryId: string; error: string }>;
}

// =============================================================================
// RepositoryLoader
// =============================================================================

/**
 * Parse a repository index from a raw JSON object.
 * @throws {RepositoryIndexError} if the index is invalid
 */
export function parseRepositoryIndex(raw: unknown, opts?: { path?: string }): RepositoryIndex {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RepositoryIndexError("unknown", "Index must be a non-null object", { path: opts?.path });
  }

  const obj = raw as Record<string, unknown>;

  // Required fields
  if (typeof obj.id !== "string" || !obj.id) {
    throw new RepositoryIndexError("unknown", "Index must have an 'id' field", { path: opts?.path });
  }
  if (typeof obj.name !== "string" || !obj.name) {
    throw new RepositoryIndexError(obj.id, "Index must have a 'name' field", { path: opts?.path });
  }
  if (typeof obj.version !== "string" || !obj.version) {
    throw new RepositoryIndexError(obj.id, "Index must have a 'version' field", { path: opts?.path });
  }
  if (typeof obj.updatedAt !== "string" || !obj.updatedAt) {
    throw new RepositoryIndexError(obj.id, "Index must have an 'updatedAt' field", { path: opts?.path });
  }
  if (!Array.isArray(obj.extensions)) {
    throw new RepositoryIndexError(obj.id, "Index must have an 'extensions' array", { path: opts?.path });
  }

  // Schema version
  if (obj.schemaVersion !== undefined && obj.schemaVersion !== 1) {
    throw new RepositoryIndexError(obj.id, `Unsupported schema version: ${obj.schemaVersion}`, { path: opts?.path });
  }

  return {
    schemaVersion: 1,
    id: obj.id as string,
    name: obj.name as string,
    description: obj.description as string | undefined,
    homepage: obj.homepage as string | undefined,
    maintainer: obj.maintainer as string | undefined,
    version: obj.version as string,
    updatedAt: obj.updatedAt as string,
    extensions: obj.extensions as RepositoryExtensionEntry[],
  };
}

/**
 * Load a repository index from a JSON string.
 */
export function loadRepositoryIndexFromString(json: string, opts?: { path?: string }): RepositoryIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new RepositoryIndexError("unknown", "Invalid JSON", { path: opts?.path, cause });
  }
  return parseRepositoryIndex(parsed, opts);
}

/**
 * Resolve a single repository entry to a manifest by loading its manifest.json.
 * Reads the file via fetch (local file serving).
 */
export async function resolveEntryManifest(
  entry: RepositoryExtensionEntry,
  basePath: string,
): Promise<{ entry: RepositoryExtensionEntry; manifest: ExtensionManifestV1 } | { entry: RepositoryExtensionEntry; error: string }> {
  const manifestUrl = `${basePath}/${entry.manifestUrl}`;
  try {
    const response = await fetch(manifestUrl);
    if (!response.ok) {
      return { entry, error: `HTTP ${response.status}` };
    }
    const raw = await response.json();
    const manifest = loadManifestFromObject(raw, { path: manifestUrl });
    return { entry, manifest };
  } catch (err) {
    if (err instanceof ManifestParseError || err instanceof ManifestValidationError || err instanceof SchemaVersionUnsupportedError) {
      return { entry, error: err.message };
    }
    return { entry, error: String(err) };
  }
}

/**
 * Load all manifests from a repository index.
 * Fetches each entry's manifest.json via local file serving.
 */
export async function loadRepositoryManifests(
  index: RepositoryIndex,
  basePath: string,
): Promise<RepositoryLoadResult> {
  const manifests: Array<{ entry: RepositoryExtensionEntry; manifest: ExtensionManifestV1 }> = [];
  const errors: Array<{ entryId: string; error: string }> = [];

  for (const entry of index.extensions) {
    const result = await resolveEntryManifest(entry, basePath);
    if ("error" in result) {
      errors.push({ entryId: entry.id, error: result.error });
    } else {
      manifests.push(result);
    }
  }

  return { index, manifests, errors };
}
