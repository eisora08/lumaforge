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
  "genre-action": "Action",
  "genre-rpg": "RPG",
  "genre-indie": "Indie",
  "genre-adventure": "Adventure",
  "genre-shooter": "Shooter",
  "genre-racing": "Racing",
  "genre-strategy": "Strategy",
  "genre-simulation": "Simulation",
};

/**
 * Curated game entries.
 *
 * "Featured" = editorial picks — broadly acclaimed, diverse, stable order.
 * "Top Picks" = quality/ranking — highest-rated across genres.
 * "New & Noteworthy" = recent releases (2023+) that are critically acclaimed.
 * "genre-*" = genre membership.
 *
 * Each game is assigned to specific sections to prevent duplicates.
 * A game can appear in multiple editorial sections, but the arrays are
 * curated to avoid showing the same 8 games in all three rails.
 */
const CURATED_GAMES: CuratedEntry[] = [
  // ── Featured (editorial picks, stable order, 8 games) ──
  { appId: "292030", title: "The Witcher 3: Wild Hunt", genres: ["RPG", "Adventure", "Action"], sections: ["featured", "genre-rpg", "genre-adventure"] },
  { appId: "1174180", title: "Red Dead Redemption 2", genres: ["Action", "Adventure"], sections: ["featured", "genre-action"] },
  { appId: "1245620", title: "Elden Ring", genres: ["RPG", "Action"], sections: ["featured", "genre-rpg", "genre-action"] },
  { appId: "413150", title: "Stardew Valley", genres: ["Indie", "RPG", "Simulation"], sections: ["featured", "genre-indie", "genre-rpg"] },
  { appId: "620", title: "Portal 2", genres: ["Action", "Puzzle"], sections: ["featured", "genre-action"] },
  { appId: "367520", title: "Hollow Knight", genres: ["Indie", "Action", "Metroidvania"], sections: ["featured", "genre-indie", "genre-action"] },
  { appId: "1145360", title: "Hades", genres: ["Indie", "Action", "Rogue-like"], sections: ["featured", "genre-indie", "genre-action"] },
  { appId: "1551360", title: "Forza Horizon 5", genres: ["Racing", "Simulation"], sections: ["featured", "genre-racing"] },

  // ── Top Picks (quality/ranking, 8 games — distinct from Featured) ──
  { appId: "1091500", title: "Cyberpunk 2077", genres: ["RPG", "Action", "Adventure"], sections: ["top-picks", "genre-rpg", "genre-action"] },
  { appId: "892970", title: "Valheim", genres: ["Indie", "Survival", "Action"], sections: ["top-picks", "genre-indie"] },
  { appId: "105600", title: "Terraria", genres: ["Indie", "Action", "Sandbox", "Adventure"], sections: ["top-picks", "genre-indie", "genre-action"] },
  { appId: "250900", title: "The Binding of Isaac: Rebirth", genres: ["Indie", "Rogue-like", "Action"], sections: ["top-picks", "genre-indie"] },
  { appId: "730", title: "Counter-Strike 2", genres: ["Action", "Shooter", "Multiplayer"], sections: ["top-picks", "genre-shooter"] },
  { appId: "814380", title: "Sekiro: Shadows Die Twice", genres: ["Action", "Adventure", "Souls-like"], sections: ["top-picks", "genre-action", "genre-adventure"] },
  { appId: "359550", title: "Rainbow Six Siege", genres: ["Action", "Shooter"], sections: ["top-picks", "genre-shooter"] },
  { appId: "255710", title: "Cities: Skylines", genres: ["Simulation", "Strategy"], sections: ["top-picks", "genre-simulation", "genre-strategy"] },

  // ── New & Noteworthy (recent acclaimed releases, 8 games — distinct from above) ──
  { appId: "2358720", title: "Black Myth: Wukong", genres: ["Action", "RPG"], sections: ["new-noteworthy", "genre-action"] },
  { appId: "1794680", title: "Vampire Survivors", genres: ["Indie", "Action", "Rogue-like"], sections: ["new-noteworthy", "genre-indie"] },
  { appId: "1225140", title: "AC6: Fires of Rubicon", genres: ["Action", "Simulation"], sections: ["new-noteworthy", "genre-action"] },
  { appId: "1289000", title: "Honkai: Star Rail", genres: ["RPG", "Free to Play"], sections: ["new-noteworthy", "genre-rpg"] },
  { appId: "1113480", title: "Frostpunk 2", genres: ["Strategy", "Simulation"], sections: ["new-noteworthy", "genre-strategy", "genre-simulation"] },
  { appId: "1092790", title: "Victoria 3", genres: ["Strategy", "Simulation"], sections: ["new-noteworthy", "genre-strategy"] },
  { appId: "1172470", title: "Apex Legends", genres: ["Action", "Shooter", "Free to Play"], sections: ["new-noteworthy", "genre-shooter"] },
  { appId: "864270", title: "BeamNG.drive", genres: ["Simulation", "Racing"], sections: ["new-noteworthy", "genre-simulation", "genre-racing"] },

  // ── Genre-only entries (not in editorial sections, only genre rails) ──
  { appId: "570", title: "Dota 2", genres: ["Action", "Strategy", "Multiplayer", "MOBA"], sections: ["genre-action", "genre-strategy"] },
  { appId: "1085660", title: "Destiny 2", genres: ["Action", "Shooter", "MMO"], sections: ["genre-shooter"] },
  { appId: "1599340", title: "Lost Ark", genres: ["RPG", "Action", "MMO"], sections: ["genre-rpg"] },
  { appId: "252490", title: "Rust", genres: ["Action", "Survival", "Multiplayer"], sections: ["genre-action"] },
  { appId: "431960", title: "Wallpaper Engine", genres: ["Utilities"], sections: [] },
  { appId: "1203220", title: "NARAKA: BLADEPOINT", genres: ["Action", "Multiplayer"], sections: ["genre-action"] },
  { appId: "578080", title: "PUBG: BATTLEGROUNDS", genres: ["Action", "Shooter", "Multiplayer", "Survival"], sections: ["genre-shooter"] },
  { appId: "440", title: "Team Fortress 2", genres: ["Action", "Shooter", "Free to Play"], sections: ["genre-shooter"] },
  { appId: "550", title: "Left 4 Dead 2", genres: ["Action", "Shooter"], sections: ["genre-shooter"] },
  { appId: "1240440", title: "Halo Infinite", genres: ["Action", "Shooter"], sections: ["genre-shooter"] },
  { appId: "391540", title: "Undertale", genres: ["Indie", "RPG"], sections: ["genre-indie", "genre-rpg"] },
  { appId: "264710", title: "Poly Bridge", genres: ["Indie", "Simulation"], sections: ["genre-indie"] },
  { appId: "304390", title: "The Beginner's Guide", genres: ["Indie", "Adventure"], sections: ["genre-indie", "genre-adventure"] },
  { appId: "212680", title: "The Stanley Parable", genres: ["Indie", "Adventure"], sections: ["genre-adventure"] },
  { appId: "400", title: "Portal", genres: ["Action", "Puzzle"], sections: ["genre-action", "genre-adventure"] },
  { appId: "108600", title: "Project Zomboid", genres: ["Indie", "Simulation", "Survival"], sections: ["genre-simulation"] },
  { appId: "222880", title: "Crusader Kings II", genres: ["Strategy", "RPG"], sections: ["genre-strategy"] },
  { appId: "394360", title: "Hearts of Iron IV", genres: ["Strategy"], sections: ["genre-strategy"] },
  { appId: "236430", title: "Warhammer 40,000: Dawn of War II", genres: ["Strategy"], sections: ["genre-strategy"] },
  { appId: "1888160", title: "WRC", genres: ["Racing", "Sports"], sections: ["genre-racing"] },
  { appId: "2552230", title: "EA SPORTS WRC", genres: ["Racing", "Sports"], sections: ["genre-racing"] },
  { appId: "1095130", title: "Horizon Chase Turbo", genres: ["Racing", "Indie"], sections: ["genre-racing"] },
  { appId: "1134020", title: "Hot Wheels Unleashed", genres: ["Racing"], sections: ["genre-racing"] },
  { appId: "1321440", title: "Circuit Superstars", genres: ["Racing", "Indie"], sections: ["genre-racing"] },
  { appId: "372000", title: "Torment: Tides of Numenera", genres: ["RPG", "Indie"], sections: ["genre-rpg"] },
  { appId: "362960", title: "Titan Quest Anniversary Edition", genres: ["RPG", "Action"], sections: ["genre-rpg"] },
  { appId: "650700", title: "Remnant: From the Ashes", genres: ["RPG", "Action", "Shooter"], sections: ["genre-rpg"] },
  { appId: "271590", title: "Grand Theft Auto V", genres: ["Action", "Adventure"], sections: ["genre-action", "genre-adventure"] },
  { appId: "1068080", title: "Transport Fever 2", genres: ["Simulation", "Strategy"], sections: ["genre-simulation"] },
  { appId: "262060", title: "Galactic Civilizations III", genres: ["Strategy"], sections: ["genre-strategy"] },
  { appId: "4000", title: "Garry's Mod", genres: ["Simulation", "Sandbox"], sections: ["genre-simulation"] },
  { appId: "1071300", title: "F1 Manager 2024", genres: ["Strategy", "Sports"], sections: ["genre-strategy"] },
  { appId: "204300", title: "CastleStorm - Definitive Edition", genres: ["Strategy", "Indie"], sections: ["genre-strategy"] },
  { appId: "1088790", title: "Enlisted", genres: ["Action", "Shooter", "Free to Play"], sections: ["genre-shooter"] },
  { appId: "478900", title: "Sean's Adventures", genres: ["Action", "FPS"], sections: ["genre-shooter"] },
  { appId: "1250410", title: "Necromunda: Hired Gun", genres: ["Action", "FPS"], sections: ["genre-action"] },
  { appId: "300", title: "DayZ", genres: ["Action", "Survival"], sections: ["genre-action"] },
  { appId: "228760", title: "TrackMania Nations Forever", genres: ["Racing", "Free to Play"], sections: ["genre-racing"] },
  { appId: "1238840", title: "Arma Reforger", genres: ["Action", "Simulation"], sections: ["genre-action"] },
  { appId: "219890", title: "War Thunder", genres: ["Action", "Simulation", "Free to Play"], sections: ["genre-action"] },
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
 * rails if its genres match. Cross-section dedupe prevents the same game
 * from appearing in a genre rail if it already appeared in an editorial rail.
 */
export function buildCuratedCatalogSections(): StoreCatalogSection[] {
  const editorialSectionIds = new Set(["featured", "top-picks", "new-noteworthy"]);

  // Step 1: Build per-section game lists from explicit membership
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

  // Step 2: Sort editorial sections by their curated order (already in correct order above)
  // Genre sections sort by genre match count (more genres = higher quality signal)
  for (const [sectionId, games] of sectionGames) {
    if (!editorialSectionIds.has(sectionId)) {
      // Genre rail: sort by number of matching genres descending, then by title
      games.sort((a, b) => {
        const aGenres = a.genres ?? [];
        const bGenres = b.genres ?? [];
        const aMatch = aGenres.filter((g) => sectionId === `genre-${g.toLowerCase()}`).length;
        const bMatch = bGenres.filter((g) => sectionId === `genre-${g.toLowerCase()}`).length;
        return bMatch - aMatch || a.title.localeCompare(b.title);
      });
    }
  }

  // Step 3: Cross-section dedupe for genre rails — remove games already in editorial sections
  const editorialUsed = new Set<string>();
  for (const secId of editorialSectionIds) {
    const games = sectionGames.get(secId);
    if (games) {
      for (const g of games) {
        if (g.steamAppId) editorialUsed.add(g.steamAppId);
      }
    }
  }
  for (const [sectionId, games] of sectionGames) {
    if (editorialSectionIds.has(sectionId)) continue;
    const deduped = games.filter((g) => {
      if (!g.steamAppId) return true;
      if (editorialUsed.has(g.steamAppId)) return false;
      return true;
    });
    sectionGames.set(sectionId, deduped);
  }

  // Step 4: Cap and build final sections
  const sections: StoreCatalogSection[] = [];
  for (const [sectionId, games] of sectionGames) {
    if (games.length === 0) continue;
    const capped = games.slice(0, CURATED_MAX_PER_SECTION);
    sections.push({
      sectionId,
      title: SECTION_TITLES[sectionId] ?? sectionId.replace(/^genre-/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      games: capped,
      updatedAt: Date.now(),
      provider: "curated",
      stale: false,
    });
  }

  // Ensure consistent section ordering: editorial first (by priority), then genre rails
  const priorityOrder = ["featured", "top-picks", "new-noteworthy", "genre-action", "genre-rpg", "genre-indie", "genre-adventure", "genre-shooter", "genre-racing", "genre-strategy", "genre-simulation"];
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
    // Check for cross-section duplicates
    const allAppIds = new Map<string, string[]>();
    for (const sec of sections) {
      for (const g of sec.games) {
        if (g.steamAppId) {
          const existing = allAppIds.get(g.steamAppId) ?? [];
          existing.push(sec.sectionId);
          allAppIds.set(g.steamAppId, existing);
        }
      }
    }
    const dups = [...allAppIds.entries()].filter(([, secs]) => secs.length > 1);
    if (dups.length > 0) {
      console.log(`[STORE_CATALOG][CURATED_CROSS_DEDUPE] duplicates=${dups.length} ${dups.map(([id, secs]) => `${id}=[${secs.join(",")}]`).join(" | ")}`);
    } else {
      console.log(`[STORE_CATALOG][CURATED_CROSS_DEDUPE] duplicates=0 sections=${sections.length} totalGames=${sections.reduce((s, sec) => s + sec.games.length, 0)}`);
    }
  }

  return sections;
}
