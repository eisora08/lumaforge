// ---------------------------------------------------------------------------
// Shared helpers for dashboard catalog sections (Trending, Featured, TopPicks).
// Eliminates ~300 lines of duplication across the 3 components.
// ---------------------------------------------------------------------------

import type { NormalizedCatalogGame } from "../../services/globalCatalogService";
import { mapStoreCatalogGameToCard } from "../../services/globalCatalogService";
import { getBestStoreImage } from "../../services/storeImageCache";
import type { StoreCatalogSection } from "../../services/storeCatalogProvider";

// ── Tool filtering ──

const TOOL_KEYWORDS = [
  "steamworks", "redistributable", "steam cloud", "steamvr",
  "proton", "runtime", "sdk", "tool", "directx", "vcredist",
  "framework", "driver", "utility",
];

export function isToolByTitle(title: string): boolean {
  const lower = title.toLowerCase();
  for (const kw of TOOL_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

// ── Media resolution ──

export function resolveBestMedia(game: NormalizedCatalogGame): string | null {
  if (game.appId) {
    const storeImage = getBestStoreImage(game.appId, ["capsule", "header", "hero"]);
    if (storeImage) return storeImage;
  }
  return game.media.capsuleImageV5 || game.media.headerImage || game.media.libraryHeroImage || game.media.capsuleImage || game.media.backgroundImage || null;
}

// ── Section lookup with curated fallback ──

/**
 * Find a section by ID in the orchestrator cache. When the orchestrator has
 * no data for the requested section (e.g. IGDB returned 0 games for that
 * tag), fall back to the curated catalog for that specific section only.
 *
 * This avoids the "all-or-nothing" gap in the orchestrator where curated
 * data is only used when ALL provider sections are empty.
 */
export async function getCatalogSectionWithFallback(
  sections: StoreCatalogSection[],
  targetSectionId: string,
): Promise<NormalizedCatalogGame[] | null> {
  // 1. Try orchestrator cache first
  const found = sections.find((s) => s.sectionId === targetSectionId);
  if (found && found.games.length > 0) {
    return found.games.map(mapStoreCatalogGameToCard);
  }

  // 2. Orchestrator missing or empty — try curated fallback for this section only
  try {
    const { buildCuratedCatalogSections } = await import("../../services/storeCuratedCatalog");
    const curatedSections = buildCuratedCatalogSections();
    const curated = curatedSections.find((s) => s.sectionId === targetSectionId);
    if (curated && curated.games.length > 0) {
      return curated.games.map(mapStoreCatalogGameToCard);
    }
  } catch {
    // curated import failed — graceful fallthrough
  }

  return null;
}

// ── Common filter + sort + cap pipeline ──

/**
 * Filter out tools, library-owned games, and games without appId/title.
 * Sort: media-first, then by title. Cap at maxItems.
 */
export function filterAndSortCatalogGames(
  cards: NormalizedCatalogGame[],
  libraryAppIds: Set<string>,
  maxItems: number,
): NormalizedCatalogGame[] {
  const filtered = cards.filter(
    (g) => g.appId && g.title && !libraryAppIds.has(g.appId) && !isToolByTitle(g.title),
  );
  if (filtered.length === 0) return [];

  const withMedia = filtered.filter((g) => resolveBestMedia(g));
  const withoutMedia = filtered.filter((g) => !resolveBestMedia(g));
  return [...withMedia, ...withoutMedia].slice(0, maxItems);
}
