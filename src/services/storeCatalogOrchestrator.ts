// ---------------------------------------------------------------------------
// StoreCatalogOrchestrator — cache-first, multi-provider background refresh.
// Sits between provider fetchers and the Store page, providing:
//   - cached sections on disk (no network for first paint)
//   - background refresh via configured providers (RAWG, IGDB, etc.)
//   - per-section REPLACEMENT when provider data meets thresholds
//   - fallback to steamdb when no provider is configured or data is weak
// Does NOT block the Store from rendering; the existing steamdb-based
// discoverSections pipeline remains the primary source until enriched
// sections arrive.
// ---------------------------------------------------------------------------

import type {
  StoreCatalogGame,
  StoreCatalogSection,
  StoreCatalogCache,
  CatalogProviderId,
  CatalogProviderStatus,
} from "./storeCatalogProvider";
import {
  STORE_CATALOG_CACHE_VERSION,
  STORE_CATALOG_STALE_MS,
  MAX_SECTION_GAMES,
  SECTION_MINIMUMS,
  normalizeCatalogSectionId,
} from "./storeCatalogProvider";
import { scoreAndSortGames, averageDiscoverScore, SECTION_REPLACE_MIN_AVG, type ScoringContext } from "./storeCatalogScoring";
import type { StoreDiscoverSection } from "./storeDiscoverCache";

const DEBUG_CATALOG_ORCHESTRATOR = false;
const DEBUG_SECTION_DECISION = false; // Phase 13: was true, gated to reduce log spam
const DEBUG_STORE_CATALOG = false;

// ── Section-specific caps (max games per section in Discover) ──
const SECTION_CAPS: Record<string, number> = {
  "featured": 8,
  "top-picks": 8,
  "new-noteworthy": 8,
  "lua-ready-picks": 8,
  "popular-genres": 20,
};

/** Priority order for cross-section dedupe (lower = higher priority). */
const SECTION_PRIORITY: Record<string, number> = {
  "featured": 0,
  "top-picks": 1,
  "new-noteworthy": 2,
  "lua-ready-picks": 3,
  "popular-genres": 5,
};

function getSectionCap(sectionId: string): number {
  return SECTION_CAPS[sectionId] ?? 12;
}

function getSectionPriority(sectionId: string): number {
  return SECTION_PRIORITY[sectionId] ?? 10;
}

// ── Types ──

export type CatalogOrchestratorState = {
  cachedSections: StoreCatalogSection[];
  isRefreshing: boolean;
  lastRefreshAt: number;
  lastRefreshError: string | null;
  providers: CatalogProviderStatus[];
};

export type CatalogInitOptions = {
  rawgApiKey?: string;
  igdbClientId?: string;
  igdbClientSecret?: string;
};

// ── Module-level state ──
let _state: CatalogOrchestratorState = {
  cachedSections: [],
  isRefreshing: false,
  lastRefreshAt: 0,
  lastRefreshError: null,
  providers: [],
};
let _initialized = false;
let _refreshAbort: AbortController | null = null;

// ── Listeners for Store.tsx re-render on enrichment ──
type Listener = (sections: StoreCatalogSection[]) => void;
const _listeners = new Set<Listener>();

function notifyListeners() {
  for (const fn of _listeners) {
    try { fn(_state.cachedSections); } catch { /* swallow */ }
  }
}

export function subscribeCatalogSections(fn: Listener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

/** Read-only snapshot of the current orchestrator state. */
export function getCatalogState(): Readonly<CatalogOrchestratorState> {
  return _state;
}

/** Read-only snapshot of the current cached sections. */
export function getCachedCatalogSections(): StoreCatalogSection[] {
  return _state.cachedSections;
}

// ── Section ID → section type mapping (provider-agnostic) ──
const SECTION_ENDPOINT_MAP: Record<string, ScoringContext["sectionType"]> = {
  "new-noteworthy": "new-noteworthy",
  "top-picks": "top-rated",
  "featured": "featured",
};

const SECTION_TITLES: Record<string, string> = {
  "new-noteworthy": "New & Noteworthy",
  "top-picks": "Top Picks",
  "featured": "Featured",
};

// ── Tauri disk cache helpers ──

async function readDiskCache(): Promise<StoreCatalogCache | null> {
  try {
    const { readStoreCatalogSectionsCache } = await import("./tauri");
    const raw = await readStoreCatalogSectionsCache();
    if (!raw || typeof raw !== "object") return null;
    const cache = raw as StoreCatalogCache;
    if (cache.version !== STORE_CATALOG_CACHE_VERSION) {
      if (DEBUG_CATALOG_ORCHESTRATOR) {
        console.log(`[CATALOG_ORCH] disk cache version mismatch: ${cache.version} vs ${STORE_CATALOG_CACHE_VERSION} — ignoring`);
      }
      return null;
    }
    return cache;
  } catch (err) {
    if (DEBUG_CATALOG_ORCHESTRATOR) console.log("[CATALOG_ORCH] disk cache read error:", err);
    return null;
  }
}

async function writeDiskCache(cache: StoreCatalogCache): Promise<void> {
  try {
    const { writeStoreCatalogSectionsCache } = await import("./tauri");
    await writeStoreCatalogSectionsCache(cache as unknown);
    if (DEBUG_CATALOG_ORCHESTRATOR) {
      console.log(`[CATALOG_ORCH] disk cache written sections=${cache.sections.length} games=${cache.allGames.length}`);
    }
  } catch (err) {
    if (DEBUG_CATALOG_ORCHESTRATOR) console.log("[CATALOG_ORCH] disk cache write error:", err);
  }
}

// ── Build sections from provider data ──

function buildSectionsFromProvider(
  providerSections: Map<string, StoreCatalogGame[]>,
  provider: CatalogProviderId,
  opts: { scoringContext: ScoringContext },
): StoreCatalogSection[] {
  const sections: StoreCatalogSection[] = [];

  for (const [tag, games] of providerSections) {
    if (!games || games.length === 0) continue;

    // Normalize provider ID to canonical Store section ID
    const normalizedId = normalizeCatalogSectionId(tag);
    const ctx: ScoringContext = {
      ...opts.scoringContext,
      sectionType: SECTION_ENDPOINT_MAP[normalizedId] ?? "more-to-explore",
    };
    const scored = scoreAndSortGames([...games], ctx).slice(0, MAX_SECTION_GAMES);

    sections.push({
      sectionId: normalizedId,
      title: SECTION_TITLES[normalizedId] ?? SECTION_TITLES[tag] ?? tag,
      games: scored,
      updatedAt: Date.now(),
      provider,
      stale: false,
    });
  }

  return sections;
}

// ── Core refresh logic ──

async function doRefresh(options: CatalogInitOptions): Promise<StoreCatalogSection[]> {
  if (_state.isRefreshing) {
    if (DEBUG_CATALOG_ORCHESTRATOR) console.log("[CATALOG_ORCH] refresh already in progress — skipping");
    return _state.cachedSections;
  }

  _state = { ..._state, isRefreshing: true, lastRefreshError: null };
  _refreshAbort = new AbortController();

  try {
    const startMs = Date.now();
    const allSections: StoreCatalogSection[] = [];
    const providerStatuses: CatalogProviderStatus[] = [];
    const sourceStats: Record<string, number> = { rawg: 0, igdb: 0, steamspy: 0, steamdb: 0, curated: 0, total: 0 };

    // ── Try IGDB first (higher quality data) ──
    if (options.igdbClientId && options.igdbClientSecret) {
      try {
        const { fetchIgdbCatalogSections, countIgdbGames } = await import("./igdbCatalogService");
        const igdbSections = await fetchIgdbCatalogSections(options.igdbClientId, options.igdbClientSecret);
        const igdbCount = countIgdbGames(igdbSections);

        if (igdbCount > 0) {
          const sections = buildSectionsFromProvider(igdbSections, "igdb", {
            scoringContext: { sectionType: "featured", now: Date.now() },
          });
          allSections.push(...sections);
          sourceStats.igdb = igdbCount;
          sourceStats.total += igdbCount;
          providerStatuses.push({ id: "igdb", configured: true, available: true, lastRefreshAt: Date.now(), gameCount: igdbCount });

          if (DEBUG_CATALOG_ORCHESTRATOR) {
            console.log(`[CATALOG_ORCH] IGDB refresh sections=${sections.length} games=${igdbCount}`);
          }
        } else {
          providerStatuses.push({ id: "igdb", configured: true, available: false, lastError: "No games returned" });
        }
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        providerStatuses.push({ id: "igdb", configured: true, available: false, lastError: msg });
        if (DEBUG_CATALOG_ORCHESTRATOR) console.log(`[CATALOG_ORCH] IGDB refresh failed: ${msg}`);
      }
    } else {
      providerStatuses.push({ id: "igdb", configured: false, available: false });
    }

    // ── Try RAWG (more games, broader catalog) ──
    if (options.rawgApiKey) {
      try {
        const { fetchRawgCatalogSections, countRawgGames } = await import("./rawgCatalogService");
        const rawgSections = await fetchRawgCatalogSections(options.rawgApiKey);
        const rawgCount = countRawgGames(rawgSections);

        if (rawgCount > 0) {
          const sections = buildSectionsFromProvider(rawgSections, "rawg", {
            scoringContext: { sectionType: "featured", now: Date.now() },
          });

          // Merge: IGDB sections take priority, RAWG fills gaps
          const igdbSectionIds = new Set(allSections.map((s) => s.sectionId));
          for (const section of sections) {
            if (!igdbSectionIds.has(section.sectionId)) {
              allSections.push(section);
            }
          }

          sourceStats.rawg = rawgCount;
          sourceStats.total += rawgCount;
          providerStatuses.push({ id: "rawg", configured: true, available: true, lastRefreshAt: Date.now(), gameCount: rawgCount });

          if (DEBUG_CATALOG_ORCHESTRATOR) {
            console.log(`[CATALOG_ORCH] RAWG refresh sections=${sections.length} games=${rawgCount}`);
          }
        } else {
          providerStatuses.push({ id: "rawg", configured: true, available: false, lastError: "No games returned" });
        }
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        providerStatuses.push({ id: "rawg", configured: true, available: false, lastError: msg });
        if (DEBUG_CATALOG_ORCHESTRATOR) console.log(`[CATALOG_ORCH] RAWG refresh failed: ${msg}`);
      }
    } else {
      providerStatuses.push({ id: "rawg", configured: false, available: false });
    }

    // ── Curated fallback when providers fail ──
    const hasProviderData = allSections.length > 0 && sourceStats.total > 0;
    if (!hasProviderData) {
      try {
        const { buildCuratedCatalogSections } = await import("./storeCuratedCatalog");
        const curatedSections = buildCuratedCatalogSections();
        if (curatedSections.length > 0) {
          allSections.push(...curatedSections);
          const curatedCount = curatedSections.reduce((sum, s) => sum + s.games.length, 0);
          sourceStats.curated = curatedCount;
          sourceStats.total += curatedCount;
          providerStatuses.push({ id: "curated", configured: false, available: true, gameCount: curatedCount });

          if (DEBUG_CATALOG_ORCHESTRATOR) {
            console.log(`[CATALOG_ORCH] curated fallback sections=${curatedSections.length} games=${curatedCount}`);
          }
        }
      } catch (err: any) {
        if (DEBUG_CATALOG_ORCHESTRATOR) console.log(`[CATALOG_ORCH] curated fallback failed: ${err?.message ?? err}`);
      }
    }

    // ── Always add steamdb/curated stubs ──
    providerStatuses.push({ id: "steamdb", configured: true, available: true });
    if (!providerStatuses.some((p) => p.id === "curated")) {
      providerStatuses.push({ id: "curated", configured: false, available: false });
    }
    providerStatuses.push({ id: "steamspy", configured: false, available: false });

    const elapsedMs = Date.now() - startMs;

    // Deduplicate games across sections
    const seen = new Set<string>();
    const allGames: StoreCatalogGame[] = [];
    for (const section of allSections) {
      for (const game of section.games) {
        if (seen.has(game.id)) continue;
        seen.add(game.id);
        allGames.push(game);
      }
    }

    // Write to disk cache — no truncation: full provider catalog retained
    const cache: StoreCatalogCache = {
      version: STORE_CATALOG_CACHE_VERSION,
      builtAt: Date.now(),
      sections: allSections,
      allGames,
      providers: providerStatuses,
      sourceStats: {
        rawg: sourceStats.rawg ?? 0,
        igdb: sourceStats.igdb ?? 0,
        steamspy: 0,
        steamdb: 0,
        curated: 0,
        total: sourceStats.total ?? 0,
      },
    };
    await writeDiskCache(cache);

    _state = {
      ..._state,
      cachedSections: allSections,
      isRefreshing: false,
      lastRefreshAt: Date.now(),
      providers: providerStatuses,
    };

    if (DEBUG_CATALOG_ORCHESTRATOR) {
      console.log(`[CATALOG_ORCH] refresh complete sections=${allSections.length} games=${sourceStats.total} elapsedMs=${elapsedMs}`);
    }

    notifyListeners();
    return allSections;
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    _state = { ..._state, isRefreshing: false, lastRefreshError: msg };
    if (DEBUG_CATALOG_ORCHESTRATOR) console.log(`[CATALOG_ORCH] refresh failed: ${msg}`);
    return _state.cachedSections;
  } finally {
    _refreshAbort = null;
  }
}

// ── Initialization ──

/**
 * Initialize the orchestrator: load disk cache, optionally trigger background refresh.
 * Safe to call multiple times (idempotent).
 */
export async function initCatalogOrchestrator(options: CatalogInitOptions = {}): Promise<void> {
  if (_initialized) {
    return;
  }
  _initialized = true;

  const diskCache = await readDiskCache();
  if (diskCache && diskCache.sections.length > 0 && diskCache.allGames.length > 0) {
    // Filter out deprecated sections from disk cache:
    // - genre-* rails (now served by Browse by Genre mosaic)
    // - featured/new-noteworthy (now served only in hero carousel, not as rail sections)
    const filteredSections = diskCache.sections.filter((s) => {
      if (s.sectionId.startsWith("genre-")) return false;
      if (s.sectionId === "featured" || s.sectionId === "new-noteworthy") return false;
      return true;
    });
    _state = {
      ..._state,
      cachedSections: filteredSections,
      lastRefreshAt: diskCache.builtAt,
      providers: diskCache.providers ?? [],
    };
    if (DEBUG_CATALOG_ORCHESTRATOR) {
      console.log(`[CATALOG_ORCH] loaded from disk sections=${diskCache.sections.length} games=${diskCache.allGames.length} age=${Date.now() - diskCache.builtAt}ms`);
    }
    notifyListeners();
  } else if (diskCache) {
    // Cache exists but is empty/invalid — treat as no cache
    if (DEBUG_STORE_CATALOG) {
      console.log(`[STORE_CATALOG][CACHE_STATUS] catalogCacheSections=${diskCache.sections.length} catalogCacheTotalGames=${diskCache.allGames.length} catalogCacheValid=false reason=empty-cache`);
    }
  }

  // Background refresh if stale or no cache
  const isStale = !diskCache || (Date.now() - diskCache.builtAt) > STORE_CATALOG_STALE_MS;
  const hasAnyProvider = !!(options.rawgApiKey || (options.igdbClientId && options.igdbClientSecret));
  if (isStale && hasAnyProvider) {
    // Defer refresh to avoid blocking Store first paint
    setTimeout(() => doRefresh(options), 3000);
  }
}

/**
 * Force a background refresh (e.g., after API key is configured).
 * Does not block; returns immediately.
 */
export function triggerCatalogRefresh(options: CatalogInitOptions): void {
  setTimeout(() => doRefresh(options), 100);
}

/**
 * Cancel any in-progress provider refresh.
 */
export function cancelCatalogRefresh(): void {
  _refreshAbort?.abort();
  _refreshAbort = null;
}

// ── Per-section minimum check ──

function sectionMeetsMinimum(sectionId: string, gameCount: number): boolean {
  const min = SECTION_MINIMUMS[sectionId];
  if (min === undefined) return true; // No threshold defined → always OK
  return gameCount >= min;
}

function inferSectionType(id: string): "hero" | "featured" | "rail" | "genre" | "more" {
  if (id.startsWith("genre-")) return "genre";
  if (id === "featured" || id === "top-picks") return "featured";
  return "rail";
}

/**
 * Merge enriched catalog sections with steamdb fallback sections.
 *
 * PROVIDER-FIRST with NO-DOWNGRADE: When enriched sections have valid data
 * meeting both count thresholds AND quality gates, they replace steamdb/curated
 * sections. A provider section ONLY replaces an existing curated section if its
 * average quality score is >= the current section's average score.
 *
 * Priority: provider/cache → curated → steamdb fallback.
 * NOT: steamdb → overlay provider.
 *
 * Also enforces:
 *   - steamAppId filter: IGDB-only games without steamAppId are excluded
 *   - Cross-section dedupe: games appear in highest-priority section only
 *   - Section-specific caps: max games per section type
 */
export function mergeEnrichedSections(
  steamdbSections: Array<{
    id: string;
    title: string;
    type?: string;
    source?: string;
    items: Array<{ appId: string; title: string; imageUrl?: string; platforms: string[]; sources: any[] }>;
  }>,
  enrichedSections: StoreCatalogSection[],
): StoreDiscoverSection[] {
  // No enriched data → use steamdb fallback entirely
  if (enrichedSections.length === 0) return steamdbSections as StoreDiscoverSection[];

  // Build normalized lookup: canonical section ID → enriched section
  // Use the section with the most games when multiple providers map to same ID
  const enrichedByNormalizedId = new Map<string, StoreCatalogSection>();
  for (const sec of enrichedSections) {
    const normalizedId = normalizeCatalogSectionId(sec.sectionId);
    const existing = enrichedByNormalizedId.get(normalizedId);
    if (!existing || sec.games.length > existing.games.length) {
      enrichedByNormalizedId.set(normalizedId, sec);
    }
  }

  // Build fallback lookup: section ID → steamdb section
  const fallbackById = new Map<string, typeof steamdbSections[number]>();
  for (const sec of steamdbSections) {
    fallbackById.set(sec.id, sec);
  }

  // Track which enriched sections were consumed
  const consumedEnrichedIds = new Set<string>();

  // Cross-section dedupe: track used appIds across all sections
  const usedAppIds = new Set<string>();

  // Sort steamdb sections by priority (featured first, genres later)
  // Filter deprecated sections: featured/new-noteworthy now served only in hero carousel
  const DEPRECATED_IDS = new Set(["featured", "new-noteworthy"]);
  const sortedSteamdb = [...steamdbSections]
    .filter((s) => !DEPRECATED_IDS.has(s.id))
    .sort((a, b) => getSectionPriority(a.id) - getSectionPriority(b.id));

  const result: StoreDiscoverSection[] = [];

  // Phase 1: For each UI section, use enriched if available and meets threshold + quality gate
  for (const uiSection of sortedSteamdb) {
    const enriched = enrichedByNormalizedId.get(uiSection.id);
    const fallbackCount = uiSection.items.length;

    // Filter provider games: must have steamAppId for Store UI navigation
    const viableProviderGames = enriched
      ? enriched.games.filter((g) => g.steamAppId && g.steamAppId.length > 0)
      : [];
    const viableCount = viableProviderGames.length;

    // Apply section cap
    const cap = getSectionCap(uiSection.id);
    const cappedGames = viableProviderGames.slice(0, cap);

    // Compute quality scores for no-downgrade check
    const [providerAvgScore] = averageDiscoverScore(cappedGames);

    // Check if existing section is curated (has curated source games)
    const isCurrentCurated = uiSection.source === "curated" ||
      uiSection.items.some((item) => item.appId?.startsWith("curated-"));

    // Compute current section's avg score (approximate from steamdb items)
    // For curated sections, approximate with a baseline score
    const currentAvgScore = isCurrentCurated ? 0.45 : 0.25;

    // NO-DOWNGRADE: provider replaces curated ONLY if quality is >= current
    const meetsCountThreshold = sectionMeetsMinimum(uiSection.id, viableCount);
    const meetsQualityGate = providerAvgScore >= currentAvgScore && providerAvgScore >= SECTION_REPLACE_MIN_AVG;
    const shouldReplace = viableCount > 0 && meetsCountThreshold && meetsQualityGate;

    if (shouldReplace) {
      // PROVIDER: use enriched section as primary
      consumedEnrichedIds.add(enriched!.sectionId);

      // Apply cross-section dedupe: only keep games not yet used
      const dedupedGames = cappedGames.filter((g) => {
        if (usedAppIds.has(g.steamAppId!)) return false;
        usedAppIds.add(g.steamAppId!);
        return true;
      });

      if (dedupedGames.length === 0) {
        // All games already used in higher-priority sections — keep fallback
        if (DEBUG_SECTION_DECISION) {
          console.log(`[STORE_CATALOG][REPLACEMENT_DECISION] sectionId=${uiSection.id} decision=fallback reason=all-games-deduped providerAvg=${providerAvgScore.toFixed(3)} currentAvg=${currentAvgScore.toFixed(3)}`);
        }
        result.push(uiSection as StoreDiscoverSection);
        continue;
      }

      const providerItems = dedupedGames.map((game) => ({
        appId: game.steamAppId!,
        title: game.title,
        imageUrl: game.imageUrl ?? game.backgroundImageUrl,
        platforms: [] as string[],
        sources: [] as any[],
      }));

      if (DEBUG_SECTION_DECISION) {
        const firstTitles = providerItems.slice(0, 3).map((g) => g.title).join(", ");
        console.log(`[STORE_CATALOG][REPLACEMENT_DECISION] sectionId=${uiSection.id} fallbackCount=${fallbackCount} providerCount=${viableCount} dedupedCount=${dedupedGames.length} decision=provider providerAvg=${providerAvgScore.toFixed(3)} currentAvg=${currentAvgScore.toFixed(3)} firstTitles=[${firstTitles}]`);
      }

      result.push({
        id: uiSection.id,
        title: enriched!.title || uiSection.title,
        type: inferSectionType(uiSection.id),
        items: providerItems,
        source: "catalog",
      });
    } else {
      // FALLBACK: use steamdb/curated section
      if (DEBUG_SECTION_DECISION && enriched) {
        const reason = viableCount === 0 ? "no-steamappid-games" :
          !meetsCountThreshold ? "below-threshold" :
            !meetsQualityGate ? `quality-downgrade/providerAvg=${providerAvgScore.toFixed(3)}<currentAvg=${currentAvgScore.toFixed(3)}` :
              "unknown";
        console.log(`[STORE_CATALOG][REPLACEMENT_DECISION] sectionId=${uiSection.id} fallbackCount=${fallbackCount} providerCount=${viableCount} decision=fallback reason=${reason}`);
      }

      // Add fallback games to dedupe set
      for (const item of uiSection.items) {
        if (item.appId) usedAppIds.add(item.appId);
      }

      result.push(uiSection as StoreDiscoverSection);
    }
  }

  // Phase 2: Add enriched-only sections not covered by UI sections
  for (const [normalizedId, enriched] of enrichedByNormalizedId) {
    if (consumedEnrichedIds.has(enriched.sectionId)) continue;
    if (fallbackById.has(normalizedId)) continue;
    // Skip deprecated genre-* rails (genres now served by Browse by Genre mosaic)
    if (normalizedId.startsWith("genre-")) continue;
    // Skip featured/new-noteworthy (now served only in hero carousel, not as rail sections)
    if (normalizedId === "featured" || normalizedId === "new-noteworthy") continue;

    // Filter and cap
    const viableGames = enriched.games.filter((g) => g.steamAppId && g.steamAppId.length > 0);
    const cap = getSectionCap(normalizedId);
    const cappedGames = viableGames.slice(0, cap);

    // Quality gate for new sections
    const [providerAvgScore] = averageDiscoverScore(cappedGames);
    if (cappedGames.length === 0 || providerAvgScore < SECTION_REPLACE_MIN_AVG) {
      if (DEBUG_SECTION_DECISION) {
        console.log(`[STORE_CATALOG][REPLACEMENT_DECISION] sectionId=${normalizedId} decision=skip-new reason=${cappedGames.length === 0 ? "no-steamappid-games" : `low-quality avg=${providerAvgScore.toFixed(3)}`}`);
      }
      continue;
    }

    // Cross-section dedupe
    const dedupedGames = cappedGames.filter((g) => {
      if (usedAppIds.has(g.steamAppId!)) return false;
      usedAppIds.add(g.steamAppId!);
      return true;
    });

    if (dedupedGames.length === 0) continue;

    const providerItems = dedupedGames.map((game) => ({
      appId: game.steamAppId!,
      title: game.title,
      imageUrl: game.imageUrl ?? game.backgroundImageUrl,
      platforms: [] as string[],
      sources: [] as any[],
    }));

    if (DEBUG_SECTION_DECISION) {
      const firstTitles = providerItems.slice(0, 3).map((g) => g.title).join(", ");
      console.log(`[STORE_CATALOG][REPLACEMENT_DECISION] sectionId=${normalizedId} providerCount=${viableGames.length} dedupedCount=${dedupedGames.length} decision=provider-only avg=${providerAvgScore.toFixed(3)} firstTitles=[${firstTitles}]`);
    }

    result.push({
      id: normalizedId,
      title: enriched.title,
      type: inferSectionType(normalizedId),
      items: providerItems,
      source: "catalog",
    });
  }

  return result;
}
