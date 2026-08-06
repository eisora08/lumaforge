// ---------------------------------------------------------------------------
// Curated fallback catalog — a small hand-picked set of known high-quality
// Steam games organized by section. Used ONLY when providers (IGDB/RAWG)
// fail or return empty data. No network, no scraping, no Store search.
//
// Each entry explicitly declares which sections it belongs to via the
// `sections` field, preventing identical games across Featured/Top Picks/
// New & Noteworthy. Genre rails still use genre membership.
// ---------------------------------------------------------------------------

import type { StoreCatalogGame, StoreCatalogSection } from "./storeCatalogProvider";

const DEBUG_CURATED_CATALOG = false;

type CuratedEntry = {
  appId: string;
  title: string;
  genres: string[];
  /** Explicit section membership — each game appears in exactly the sections listed. */
  sections: string[];
};

const SECTION_TITLES: Record<string, string> = {
  "featured": "Featured",
  "top-picks": "Top Picks",
  "new-noteworthy": "New & Noteworthy",
};

/**
 * Curated game entries.
 *
 * "Featured" = editorial picks — broadly acclaimed, diverse, stable order.
 * "Top Picks" = quality/ranking — highest-rated across genres.
 * "New & Noteworthy" = recent releases (2023+) that are critically acclaimed.
 *
 * Each game is assigned to specific sections to prevent duplicates.
 * Individual genre-* rails are deprecated — genres are now served by the
 * single "Browse by Genre" mosaic section.
 */
const CURATED_GAMES: CuratedEntry[] = [
  // ── Featured (editorial picks, stable order, 8 games) ──
  { appId: "292030", title: "The Witcher 3: Wild Hunt", genres: ["RPG", "Adventure", "Action"], sections: ["featured"] },
  { appId: "1174180", title: "Red Dead Redemption 2", genres: ["Action", "Adventure"], sections: ["featured"] },
  { appId: "1245620", title: "Elden Ring", genres: ["RPG", "Action"], sections: ["featured"] },
  { appId: "413150", title: "Stardew Valley", genres: ["Indie", "RPG", "Simulation"], sections: ["featured"] },
  { appId: "620", title: "Portal 2", genres: ["Action", "Puzzle"], sections: ["featured"] },
  { appId: "367520", title: "Hollow Knight", genres: ["Indie", "Action", "Metroidvania"], sections: ["featured"] },
  { appId: "1145360", title: "Hades", genres: ["Indie", "Action", "Rogue-like"], sections: ["featured"] },
  { appId: "1551360", title: "Forza Horizon 5", genres: ["Racing", "Simulation"], sections: ["featured"] },

  // ── Top Picks (quality/ranking, 8 games — distinct from Featured) ──
  { appId: "1091500", title: "Cyberpunk 2077", genres: ["RPG", "Action", "Adventure"], sections: ["top-picks"] },
  { appId: "892970", title: "Valheim", genres: ["Indie", "Survival", "Action"], sections: ["top-picks"] },
  { appId: "105600", title: "Terraria", genres: ["Indie", "Action", "Sandbox", "Adventure"], sections: ["top-picks"] },
  { appId: "250900", title: "The Binding of Isaac: Rebirth", genres: ["Indie", "Rogue-like", "Action"], sections: ["top-picks"] },
  { appId: "730", title: "Counter-Strike 2", genres: ["Action", "Shooter", "Multiplayer"], sections: ["top-picks"] },
  { appId: "814380", title: "Sekiro: Shadows Die Twice", genres: ["Action", "Adventure", "Souls-like"], sections: ["top-picks"] },
  { appId: "359550", title: "Rainbow Six Siege", genres: ["Action", "Shooter"], sections: ["top-picks"] },
  { appId: "255710", title: "Cities: Skylines", genres: ["Simulation", "Strategy"], sections: ["top-picks"] },

  // ── New & Noteworthy (recent acclaimed releases, 8 games — distinct from above) ──
  { appId: "2358720", title: "Black Myth: Wukong", genres: ["Action", "RPG"], sections: ["new-noteworthy"] },
  { appId: "1794680", title: "Vampire Survivors", genres: ["Indie", "Action", "Rogue-like"], sections: ["new-noteworthy"] },
  { appId: "1225140", title: "AC6: Fires of Rubicon", genres: ["Action", "Simulation"], sections: ["new-noteworthy"] },
  { appId: "1289000", title: "Honkai: Star Rail", genres: ["RPG", "Free to Play"], sections: ["new-noteworthy"] },
  { appId: "1113480", title: "Frostpunk 2", genres: ["Strategy", "Simulation"], sections: ["new-noteworthy"] },
  { appId: "1092790", title: "Victoria 3", genres: ["Strategy", "Simulation"], sections: ["new-noteworthy"] },
  { appId: "1172470", title: "Apex Legends", genres: ["Action", "Shooter", "Free to Play"], sections: ["new-noteworthy"] },
  { appId: "864270", title: "BeamNG.drive", genres: ["Simulation", "Racing"], sections: ["new-noteworthy"] },
];

/** Maximum games per curated section. */
const CURATED_MAX_PER_SECTION = 12;

/**
 * Build curated catalog sections from the static game list.
 *
 * Editorial sections (featured, top-picks, new-noteworthy) use explicit
 * per-entry `sections` membership — each game appears only in the sections
 * it was assigned to, preventing duplicate rails.
 *
 * Genre rails use genre membership — a game can appear in multiple genre
/**
 * Build curated catalog sections from static CURATED_GAMES entries.
 * Only editorial sections remain (featured, top-picks, new-noteworthy).
 * Individual genre-* rails are deprecated in favor of the Browse by Genre mosaic.
 */
export function buildCuratedCatalogSections(): StoreCatalogSection[] {
  // Build per-section game lists from explicit membership
  const sectionGames = new Map<string, StoreCatalogGame[]>();
  for (const entry of CURATED_GAMES) {
    for (const sectionId of entry.sections) {
      if (!sectionGames.has(sectionId)) sectionGames.set(sectionId, []);
      const list = sectionGames.get(sectionId)!;
      // Dedupe within section (same appId shouldn't appear twice)
      if (list.some((g) => g.steamAppId === entry.appId)) continue;
      list.push({
        id: `curated-${entry.appId}`,
        title: entry.title,
        source: "curated",
        steamAppId: entry.appId,
        genres: entry.genres,
      });
    }
  }

  // Step 2: Cap and build final sections (editorial only)
  const sections: StoreCatalogSection[] = [];
  for (const [sectionId, games] of sectionGames) {
    if (games.length === 0) continue;
    const capped = games.slice(0, CURATED_MAX_PER_SECTION);
    sections.push({
      sectionId,
      title: SECTION_TITLES[sectionId] ?? sectionId,
      games: capped,
      updatedAt: Date.now(),
      provider: "curated",
      stale: false,
    });
  }

  // Consistent ordering: featured → top-picks → new-noteworthy
  const priorityOrder = ["featured", "top-picks", "new-noteworthy"];
  sections.sort((a, b) => {
    const ai = priorityOrder.indexOf(a.sectionId);
    const bi = priorityOrder.indexOf(b.sectionId);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  if (DEBUG_CURATED_CATALOG) {
    for (const sec of sections) {
      const titles = sec.games.map((g) => g.title).join(", ");
      console.log(`[STORE_CATALOG][CURATED_SECTION] sectionId=${sec.sectionId} count=${sec.games.length} games=[${titles}]`);
    }
  }

  return sections;
}
