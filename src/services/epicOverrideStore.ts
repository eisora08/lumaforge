/**
 * Epic Override Store — localStorage-backed metadata overrides for Epic games.
 *
 * When the user edits an Epic game via GameEditDialog, the overrides are stored
 * here (keyed by providerGameId). On library load, overrides are merged into the
 * LibraryGame fields via mergeEpicOverrides().
 *
 * No Rust backend needed — pure localStorage persistence.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EpicOverrideData = {
  /** User-set display name (overrides manifest displayName). */
  name?: string;
  /** User-set sorting name. */
  sortingName?: string;
  /** User-set description. */
  description?: string;
  /** User-set genres (comma-separated or array). */
  genres?: string[];
  /** User-set developers. */
  developers?: string[];
  /** User-set publishers. */
  publishers?: string[];
  /** User-set categories. */
  categories?: string[];
  /** User-set features. */
  features?: string[];
  /** User-set tags. */
  tags?: string[];
  /** User-set release date. */
  releaseDate?: string;
  /** User-set series name. */
  series?: string;
  /** User-set age rating. */
  ageRating?: string;
  /** User-set region. */
  region?: string;
  /** User-set linked Steam App ID (for cross-referencing achievements etc). */
  linkedSteamAppId?: string;
  /** User-set linked IGDB ID. */
  linkedIgdbId?: string;
  /** Media paths — relative paths within games/epic/<providerGameId>/media/. */
  coverPath?: string;
  landscapePath?: string;
  backgroundPath?: string;
  logoPath?: string;
  iconPath?: string;
  /** Timestamp of last override write. */
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "lumaforge-epic-overrides-v1";

// ---------------------------------------------------------------------------
// Subscriber notification
// ---------------------------------------------------------------------------

type OverrideChangeListener = (providerGameId: string) => void;
const _overrideListeners = new Set<OverrideChangeListener>();

function notifyOverrideChanged(providerGameId: string): void {
  for (const listener of _overrideListeners) {
    try { listener(providerGameId); } catch { /* listener error must not break */ }
  }
}

/**
 * Subscribe to Epic override changes. Returns unsubscribe function.
 * Called by epicGameStore to rebuild games with fresh overrides.
 */
export function subscribeEpicOverridesChanged(listener: OverrideChangeListener): () => void {
  _overrideListeners.add(listener);
  return () => { _overrideListeners.delete(listener); };
}

function loadAllFromStorage(): Record<string, EpicOverrideData> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, EpicOverrideData>;
  } catch {
    return {};
  }
}

function persistAllToStorage(all: Record<string, EpicOverrideData>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    console.warn("[EPIC_OVERRIDE] Failed to persist overrides to localStorage");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read overrides for a specific Epic game.
 * Returns undefined if no overrides exist for this providerGameId.
 */
export function readEpicOverrides(providerGameId: string): EpicOverrideData | undefined {
  const all = loadAllFromStorage();
  return all[providerGameId];
}

/**
 * Write (merge) overrides for a specific Epic game.
 * Existing fields not present in `data` are preserved (partial merge).
 */
export function writeEpicOverrides(
  providerGameId: string,
  data: Partial<Omit<EpicOverrideData, "updatedAt">>,
): EpicOverrideData {
  const all = loadAllFromStorage();
  const existing = all[providerGameId] ?? {};
  const merged: EpicOverrideData = {
    ...existing,
    ...data,
    updatedAt: Date.now(),
  };
  all[providerGameId] = merged;
  persistAllToStorage(all);
  notifyOverrideChanged(providerGameId);
  return merged;
}

/**
 * Delete overrides for a specific Epic game.
 */
export function deleteEpicOverrides(providerGameId: string): void {
  const all = loadAllFromStorage();
  delete all[providerGameId];
  persistAllToStorage(all);
  notifyOverrideChanged(providerGameId);
}

/**
 * Merge Epic overrides into a LibraryGame-like object.
 * Returns a new object with override fields applied on top of the original.
 * Only non-undefined override fields are applied (partial merge).
 *
 * Also builds a synthetic SteamAppMetadata from overrides and merges it into
 * game.metadata, so that LibraryGameDetails can read from game.metadata.*
 * (genres, developer, short_description, release_date, etc.)
 */
export function mergeEpicOverrides(
  game: Record<string, unknown>,
  providerGameId: string,
): Record<string, unknown> {
  const overrides = readEpicOverrides(providerGameId);
  if (!overrides) return game;

  const result = { ...game };
  if (overrides.name !== undefined) result.title = overrides.name;
  if (overrides.sortingName !== undefined) result.sortingName = overrides.sortingName;
  if (overrides.description !== undefined) result.description = overrides.description;
  if (overrides.genres !== undefined) result.genres = overrides.genres;
  if (overrides.developers !== undefined) result.developers = overrides.developers;
  if (overrides.publishers !== undefined) result.publishers = overrides.publishers;
  if (overrides.categories !== undefined) result.categories = overrides.categories;
  if (overrides.features !== undefined) result.features = overrides.features;
  if (overrides.tags !== undefined) result.tags = overrides.tags;
  if (overrides.releaseDate !== undefined) result.releaseDate = overrides.releaseDate;
  if (overrides.series !== undefined) result.series = overrides.series;
  if (overrides.ageRating !== undefined) result.ageRating = overrides.ageRating;
  if (overrides.region !== undefined) result.region = overrides.region;
  if (overrides.linkedSteamAppId !== undefined) result.linkedSteamAppId = overrides.linkedSteamAppId;
  if (overrides.linkedIgdbId !== undefined) result.linkedIgdbId = overrides.linkedIgdbId;
  if (overrides.coverPath !== undefined) result.coverPath = overrides.coverPath;
  if (overrides.landscapePath !== undefined) result.landscapePath = overrides.landscapePath;
  if (overrides.backgroundPath !== undefined) result.backgroundPath = overrides.backgroundPath;
  if (overrides.logoPath !== undefined) result.logoPath = overrides.logoPath;
  if (overrides.iconPath !== undefined) result.iconPath = overrides.iconPath;

  // Build synthetic SteamAppMetadata from overrides so LibraryGameDetails
  // can read game.metadata?.genres, game.metadata?.developer, etc.
  const hasMetadataOverrides = overrides.name || overrides.description || overrides.genres?.length ||
    overrides.developers?.length || overrides.publishers?.length || overrides.releaseDate || overrides.categories?.length;

  if (hasMetadataOverrides) {
    const existingMeta = (result.metadata ?? {}) as Record<string, unknown>;
    const description = overrides.description ?? null;
    const genres = overrides.genres ?? [];
    const tags = overrides.tags ?? [];
    const mergedGenres = [...genres, ...tags.filter((t) => !genres.includes(t))];
    const categories = overrides.categories ?? [];
    const features = overrides.features ?? [];
    const mergedCategories = [...categories, ...features.filter((f) => !categories.includes(f))];

    result.metadata = {
      ...existingMeta,
      app_id: 0,
      name: overrides.name || existingMeta.name || "Unknown",
      developer: overrides.developers?.join(", ") ?? existingMeta.developer ?? null,
      short_description: description || (existingMeta.short_description ?? null),
      about_the_game: description || (existingMeta.about_the_game ?? null),
      detailed_description: existingMeta.detailed_description ?? null,
      genres: mergedGenres.length > 0 ? mergedGenres : (existingMeta.genres as string[]) ?? [],
      publishers: overrides.publishers ?? (existingMeta.publishers as string[]) ?? [],
      release_date: overrides.releaseDate || (existingMeta.release_date ?? null),
      categories: mergedCategories.length > 0 ? mergedCategories : (existingMeta.categories as string[]) ?? [],
      platforms: (existingMeta.platforms as string[]) ?? [],
      languages: (existingMeta.languages as string[]) ?? [],
      dlc_count: (existingMeta.dlc_count as number) ?? 0,
      dlc_app_ids: (existingMeta.dlc_app_ids as number[]) ?? [],
      screenshots: (existingMeta.screenshots as string[]) ?? [],
      movies: (existingMeta.movies ?? []) as any[],
      resolved: false,
    };
  }

  return result;
}

/**
 * Check if a game has any user-set overrides.
 */
export function hasEpicOverrides(providerGameId: string): boolean {
  const overrides = readEpicOverrides(providerGameId);
  if (!overrides) return false;
  // Has overrides if any meaningful field is set (not just updatedAt)
  const { updatedAt: _, ...rest } = overrides;
  return Object.values(rest).some((v) => v !== undefined && v !== null && v !== "");
}
