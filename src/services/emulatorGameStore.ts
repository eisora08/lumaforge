/**
 * Emulator Game Store
 *
 * Manages ROM games in the emulator library.
 * Write-through to games_v2 SQLite table via Tauri commands.
 * localStorage serves as a fast read cache.
 */

import type { EmulatorGameEntry } from "../data/emulatorDefinitions/types";

// ─── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = "lumaforge-emulator-games-v1";
const STORAGE_VERSION = 1;

// ─── Types ─────────────────────────────────────────────────────────────

type EmulatorGameStore = {
  version: number;
  games: EmulatorGameEntry[];
};

// ─── Module-level cache ────────────────────────────────────────────────

let _cache: EmulatorGameEntry[] | null = null;

// ─── Listeners ─────────────────────────────────────────────────────────

type Listener = () => void;
const _listeners = new Set<Listener>();

function notifyListeners(): void {
  _listeners.forEach((fn) => fn());
}

// ─── LocalStorage helpers (read cache) ─────────────────────────────────

function loadFromStorage(): EmulatorGameEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as EmulatorGameStore;
      if (Array.isArray(parsed.games)) return parsed.games;
    }
  } catch {
    // corrupt storage
  }
  return [];
}

function saveToLocalStorage(games: EmulatorGameEntry[]): void {
  try {
    const store: EmulatorGameStore = { version: STORAGE_VERSION, games };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage full
  }
}

// ─── games_v2 write-through helpers ────────────────────────────────────

async function syncToGamesV2(entry: EmulatorGameEntry, op: "upsert" | "delete"): Promise<void> {
  try {
    const { upsertGameV2, deleteGameV2 } = await import("./tauri");
    const { emulatorGameEntryToGameV2 } = await import("./gameV2Mapper");
    if (op === "upsert") {
      await upsertGameV2(emulatorGameEntryToGameV2(entry));
    } else {
      await deleteGameV2(entry.id);
    }
  } catch (e) {
    console.error(`[EmulatorGames][GAMES_V2] op=${op} id=${entry.id} FAILED:`, e);
  }
}

async function syncBatchToGamesV2(games: EmulatorGameEntry[]): Promise<void> {
  try {
    const { batchUpsertGamesV2 } = await import("./tauri");
    const { emulatorGameEntryToGameV2 } = await import("./gameV2Mapper");
    const gamesV2 = games.map(emulatorGameEntryToGameV2);
    if (gamesV2.length > 0) {
      await batchUpsertGamesV2(gamesV2);
    }
  } catch (e) {
    console.error(`[EmulatorGames][GAMES_V2] batch upsert FAILED:`, e);
  }
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Get all emulator games.
 */
export function getAllEmulatorGames(): EmulatorGameEntry[] {
  if (_cache !== null) return _cache;
  _cache = loadFromStorage();
  return _cache;
}

/**
 * Get a single emulator game by ID.
 */
export function getEmulatorGame(id: string): EmulatorGameEntry | undefined {
  const games = getAllEmulatorGames();
  return games.find((g) => g.id === id);
}

/**
 * Get emulator games by platform.
 */
export function getEmulatorGamesByPlatform(platform: string): EmulatorGameEntry[] {
  const games = getAllEmulatorGames();
  return games.filter((g) => g.platform === platform);
}

/**
 * Get emulator games by emulator config.
 */
export function getEmulatorGamesByConfig(emulatorConfigId: string): EmulatorGameEntry[] {
  const games = getAllEmulatorGames();
  return games.filter((g) => g.emulatorConfigId === emulatorConfigId);
}

/**
 * Get favorite emulator games.
 */
export function getFavoriteEmulatorGames(): EmulatorGameEntry[] {
  const games = getAllEmulatorGames();
  return games.filter((g) => g.isFavorite === true);
}

/**
 * Save an emulator game. Writes to localStorage cache + games_v2.
 */
export function saveEmulatorGame(game: EmulatorGameEntry): void {
  const games = getAllEmulatorGames();
  const existing = games.findIndex((g) => g.id === game.id);

  let newGames: EmulatorGameEntry[];
  if (existing >= 0) {
    newGames = games.map((g, i) => i === existing ? { ...game, updatedAt: Date.now() } : g);
  } else {
    newGames = [...games, game];
  }

  _cache = newGames;
  saveToLocalStorage(newGames);
  syncToGamesV2(game, "upsert"); // fire-and-forget
  notifyListeners();
}

/**
 * Save multiple emulator games. Writes to localStorage cache + games_v2.
 */
export function saveEmulatorGames(newGamesInput: EmulatorGameEntry[]): void {
  let games = getAllEmulatorGames();

  for (const game of newGamesInput) {
    const existing = games.findIndex((g) => g.id === game.id);
    if (existing >= 0) {
      games = games.map((g, i) => i === existing ? { ...game, updatedAt: Date.now() } : g);
    } else {
      games = [...games, game];
    }
  }

  _cache = games;
  saveToLocalStorage(games);
  syncBatchToGamesV2(newGamesInput); // fire-and-forget
  notifyListeners();
}

/**
 * Delete an emulator game from localStorage cache + games_v2.
 */
export function deleteEmulatorGame(id: string): void {
  const games = getAllEmulatorGames();
  const filtered = games.filter((g) => g.id !== id);

  if (filtered.length === games.length) return; // not found

  _cache = filtered;
  saveToLocalStorage(filtered);
  syncToGamesV2({ id } as EmulatorGameEntry, "delete"); // fire-and-forget
  notifyListeners();
}

/**
 * Remove an emulator game from the library (context menu action).
 * Deletes from games_v2 and clears cache.
 */
export function removeEmulatorGameFromLibrary(id: string): void {
  const games = getAllEmulatorGames();
  const filtered = games.filter((g) => g.id !== id);

  _cache = filtered;
  saveToLocalStorage(filtered);
  syncToGamesV2({ id } as EmulatorGameEntry, "delete"); // fire-and-forget
  notifyListeners();
}

/**
 * Toggle favorite status.
 */
export function toggleEmulatorGameFavorite(id: string): void {
  const game = getEmulatorGame(id);
  if (!game) return;

  saveEmulatorGame({
    ...game,
    isFavorite: !game.isFavorite,
  });
}

/**
 * Search emulator games by title.
 */
export function searchEmulatorGames(query: string): EmulatorGameEntry[] {
  const games = getAllEmulatorGames();
  const lowerQuery = query.toLowerCase();
  return games.filter((g) => g.title.toLowerCase().includes(lowerQuery));
}

/**
 * Subscribe to changes.
 */
export function onEmulatorGameChange(listener: Listener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/**
 * Force reload from storage.
 */
export function reloadEmulatorGames(): void {
  _cache = null;
  notifyListeners();
}

/**
 * Get emulator game statistics.
 */
export function getEmulatorGameStats(): {
  total: number;
  favorites: number;
  byPlatform: Record<string, number>;
} {
  const games = getAllEmulatorGames();
  const byPlatform: Record<string, number> = {};

  for (const game of games) {
    byPlatform[game.platform] = (byPlatform[game.platform] || 0) + 1;
  }

  return {
    total: games.length,
    favorites: games.filter((g) => g.isFavorite === true).length,
    byPlatform,
  };
}

/**
 * Generate a new emulator game ID with the correct format.
 */
export function generateEmulatorGameId(): string {
  return `emulator:${crypto.randomUUID()}`;
}

// ─── ROM Import Helpers ────────────────────────────────────────────────

/**
 * Supported ROM file extensions.
 */
export const ROM_EXTENSIONS = new Set([
  // Nintendo
  "nes", "fds", "sfc", "smc", "n64", "z64", "v64", "gcm", "iso", "wbfs", "rvz", "wad", "wia", "rpx",
  "gba", "gb", "gbc", "nds", "dsi", "3ds", "cia", "3dsx",
  // Sega
  "gen", "md", "smd", "sms", "gg", "sg", "scd", "bin", "cue", "cdi", "gdi",
  // Sony
  "bin", "cue", "iso", "pbp", "chd", "cso", "pkg", "edat", "self", "vpk",
  // Arcade
  "zip", "7z",
  // NEC
  "pce", "sgx", "cue",
  // SNK
  "ngp", "ngc", "neo",
  // Bandai
  "ws", "wsc",
  // Atari
  "a26", "a52", "a78", "j64", "lnx",
  // Commodore
  "d64", "d71", "d80", "g64", "p00", "x64", "adf", "adz", "dms", "ipf", "uae",
  // Microsoft
  "rom",
  // Misc
  "img", "mdf", "nrg", "gz",
]);

/**
 * Check if a file extension is a supported ROM.
 */
export function isRomFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? ROM_EXTENSIONS.has(ext) : false;
}

/**
 * Extract platform from ROM filename (heuristic).
 */
export function guessPlatformFromFilename(filename: string): string | null {
  const lower = filename.toLowerCase();

  // Nintendo
  if (lower.endsWith(".nes")) return "nintendo_nes";
  if (lower.endsWith(".fds")) return "nintendo_famicom_disk";
  if (lower.endsWith(".sfc") || lower.endsWith(".smc")) return "nintendo_super_nes";
  if (lower.endsWith(".n64") || lower.endsWith(".z64") || lower.endsWith(".v64")) return "nintendo_64";
  if (lower.endsWith(".gcm")) return "nintendo_gamecube";
  if (lower.endsWith(".gba")) return "nintendo_gameboyadvance";
  if (lower.endsWith(".gb")) return "nintendo_gameboy";
  if (lower.endsWith(".gbc")) return "nintendo_gameboycolor";
  if (lower.endsWith(".nds")) return "nintendo_ds";
  if (lower.endsWith(".dsi")) return "nintendo_dsi";
  if (lower.endsWith(".3ds") || lower.endsWith(".cia") || lower.endsWith(".3dsx")) return "nintendo_3ds";
  if (lower.endsWith(".wad") || lower.endsWith(".wbfs") || lower.endsWith(".rvz") || lower.endsWith(".wia")) return "nintendo_wii";
  if (lower.endsWith(".wud") || lower.endsWith(".wux") || lower.endsWith(".rpx") || lower.endsWith(".rpl")) return "nintendo_wiiu";
  if (lower.endsWith(".nca") || lower.endsWith(".nso") || lower.endsWith(".nsp") || lower.endsWith(".xci")) return "nintendo_switch";

  // Sega
  if (lower.endsWith(".gen") || lower.endsWith(".md") || lower.endsWith(".smd")) return "sega_genesis";
  if (lower.endsWith(".sms")) return "sega_mastersystem";
  if (lower.endsWith(".gg")) return "sega_gamegear";
  if (lower.endsWith(".sat")) return "sega_saturn";
  if (lower.endsWith(".gdi") || lower.endsWith(".cdi")) return "sega_dreamcast";
  if (lower.endsWith(".scd")) return "sega_cd";

  // Sony PlayStation
  if (lower.endsWith(".pbp") && !lower.includes("psp")) return "sony_playstation";
  if (lower.endsWith(".cue") || lower.endsWith(".chd")) {
    // Ambiguous — could be PS1 or Saturn, default to PS1
    return "sony_playstation";
  }
  if (lower.endsWith(".iso") || lower.endsWith(".bin")) {
    // Check context clues in filename
    if (lower.includes("ps2") || lower.includes("playstation 2")) return "sony_playstation2";
    if (lower.includes("ps3") || lower.includes("playstation 3")) return "sony_playstation3";
    if (lower.includes("ps4") || lower.includes("playstation 4")) return "sony_playstation4";
    if (lower.includes("psp") || lower.includes("playstation portable")) return "sony_psp";
    if (lower.includes("saturn") || lower.includes("sega")) return "sega_saturn";
    if (lower.includes("gamecube") || lower.includes("nintendo")) return "nintendo_gamecube";
  }
  if (lower.endsWith(".cso") || lower.endsWith(".vpk")) {
    if (lower.endsWith(".vpk")) return "sony_vita";
    return "sony_psp";
  }

  // Arcade
  if (lower.endsWith(".zip") || lower.endsWith(".7z")) {
    // Could be arcade or any platform using archives — default to null
    return null;
  }

  // NEC
  if (lower.endsWith(".pce") || lower.endsWith(".sgx")) return "nec_turbografx_16";

  // SNK
  if (lower.endsWith(".ngp")) return "snk_neogeopocket";
  if (lower.endsWith(".ngc")) return "snk_neogeopocket_color";
  if (lower.endsWith(".neo")) return "snk_neogeo_aes";

  // Bandai
  if (lower.endsWith(".ws")) return "bandai_wonderswan";
  if (lower.endsWith(".wsc")) return "bandai_wonderswan_color";

  // Atari
  if (lower.endsWith(".a26")) return "atari_2600";
  if (lower.endsWith(".a52")) return "atari_5200";
  if (lower.endsWith(".a78")) return "atari_7800";
  if (lower.endsWith(".j64")) return "atari_jaguar";
  if (lower.endsWith(".lnx")) return "atari_lynx";

  // Commodore
  if (lower.endsWith(".d64") || lower.endsWith(".d71") || lower.endsWith(".d80") || lower.endsWith(".g64") || lower.endsWith(".p00") || lower.endsWith(".x64")) return "commodore_64";
  if (lower.endsWith(".adf") || lower.endsWith(".adz") || lower.endsWith(".dms") || lower.endsWith(".ipf") || lower.endsWith(".uae")) return "commodore_amiga";

  // DOS/Windows
  if (lower.endsWith(".exe") || lower.endsWith(".bat") || lower.endsWith(".com")) return "pc_dos";

  return null;
}

/**
 * Extract region from ROM filename (heuristic).
 * Looks for common patterns like "(USA)", "[E]", "(J)", "(Rev 2)", etc.
 */
export function guessRegionFromFilename(filename: string): string | null {
  const regionPatterns: [RegExp, string][] = [
    [/\(usa\)/i, "USA"],
    [/\(eu\)/i, "EUR"],
    [/\(europe\)/i, "EUR"],
    [/\(japan\)/i, "JPN"],
    [/\(j\)/i, "JPN"],
    [/\(u\)/i, "USA"],
    [/\(e\)/i, "EUR"],
    [/\[usa\]/i, "USA"],
    [/\[eu\]/i, "EUR"],
    [/\[japan\]/i, "JPN"],
    [/\[j\]/i, "JPN"],
    [/\[u\]/i, "USA"],
    [/\[e\]/i, "EUR"],
    [/\(world\)/i, "World"],
    [/\(w\)/i, "World"],
    [/\(korea\)/i, "KOR"],
    [/\(brazil\)/i, "BRA"],
    [/\(china\)/i, "CHN"],
    [/\( taiwan \)/i, "TWN"],
    [/\(asia\)/i, "Asia"],
  ];

  for (const [pattern, region] of regionPatterns) {
    if (pattern.test(filename)) return region;
  }
  return null;
}
