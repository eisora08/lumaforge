/**
 * Emulator definitions - Platforms
 *
 * Gaming platforms/console that can be emulated.
 * Based on Playnite's Platforms.yaml but adapted for LumaForge.
 */

import { EmulatorPlatform } from "./types";

export const emulatorPlatforms: EmulatorPlatform[] = [
  // ==================== Nintendo ====================
  {
    id: "nintendo_nes",
    name: "Nintendo Entertainment System",
    shortName: "NES",
    igdbId: 18,
    databases: ["Nintendo - Nintendo Entertainment System"],
    emulatorIds: ["retroarch", "mesen", "fceux", "nestopia", "higan"],
  },
  {
    id: "nintendo_famicom_disk",
    name: "Nintendo Family Computer Disk System",
    shortName: "FDS",
    igdbId: 51,
    databases: ["Nintendo - Family Computer Disk System"],
    emulatorIds: ["retroarch", "fceux"],
  },
  {
    id: "nintendo_super_nes",
    name: "Super Nintendo Entertainment System",
    shortName: "SNES",
    igdbId: 19,
    databases: ["Nintendo - Super Nintendo Entertainment System"],
    emulatorIds: ["retroarch", "snes9x", "bsnes", "mesen-s"],
  },
  {
    id: "nintendo_64",
    name: "Nintendo 64",
    shortName: "N64",
    igdbId: 4,
    databases: ["Nintendo - Nintendo 64", "Nintendo - Nintendo 64DD"],
    emulatorIds: ["retroarch", "project64", "simple64", "ares"],
  },
  {
    id: "nintendo_gamecube",
    name: "Nintendo GameCube",
    shortName: "GCN",
    igdbId: 21,
    databases: ["Nintendo - GameCube"],
    emulatorIds: ["dolphin", "retroarch"],
  },
  {
    id: "nintendo_wii",
    name: "Nintendo Wii",
    shortName: "Wii",
    igdbId: 5,
    databases: ["Nintendo - Wii", "Nintendo - Wii (Digital)"],
    emulatorIds: ["dolphin", "retroarch"],
  },
  {
    id: "nintendo_wiiu",
    name: "Nintendo Wii U",
    shortName: "Wii U",
    igdbId: 41,
    databases: ["Nintendo - Wii U", "Nintendo - Wii U (Digital)"],
    emulatorIds: ["cemu", "decaf-emu"],
  },
  {
    id: "nintendo_switch",
    name: "Nintendo Switch",
    shortName: "Switch",
    igdbId: 130,
    emulatorIds: ["eden", "sudachi"],
  },
  {
    id: "nintendo_gameboy",
    name: "Nintendo Game Boy",
    shortName: "GB",
    igdbId: 33,
    databases: ["Nintendo - Game Boy"],
    emulatorIds: ["retroarch", "mgba", "sameboy", "gambatte", "bgb", "visualboyadvance-m"],
  },
  {
    id: "nintendo_gameboycolor",
    name: "Nintendo Game Boy Color",
    shortName: "GBC",
    igdbId: 22,
    databases: ["Nintendo - Game Boy Color"],
    emulatorIds: ["retroarch", "mgba", "sameboy", "gambatte", "bgb", "visualboyadvance-m"],
  },
  {
    id: "nintendo_gameboyadvance",
    name: "Nintendo Game Boy Advance",
    shortName: "GBA",
    igdbId: 24,
    databases: ["Nintendo - Game Boy Advance"],
    emulatorIds: ["retroarch", "mgba", "visualboyadvance-m", "nanoboyadvance", "higan"],
  },
  {
    id: "nintendo_ds",
    name: "Nintendo DS",
    shortName: "DS",
    igdbId: 20,
    databases: ["Nintendo - Nintendo DS", "Nintendo - Nintendo DS (Download Play)"],
    emulatorIds: ["retroarch", "melonds", "desmume", "melonDS"],
  },
  {
    id: "nintendo_dsi",
    name: "Nintendo DSi",
    shortName: "DSi",
    igdbId: 159,
    databases: ["Nintendo - Nintendo DSi", "Nintendo - Nintendo DSi (Digital)"],
    emulatorIds: ["melonds"],
  },
  {
    id: "nintendo_3ds",
    name: "Nintendo 3DS",
    shortName: "3DS",
    igdbId: 37,
    databases: ["Nintendo - Nintendo 3DS", "Nintendo - Nintendo 3DS (Digital)"],
    emulatorIds: ["citra", "azahar", "lime3ds"],
  },
  {
    id: "nintendo_virtualboy",
    name: "Nintendo Virtual Boy",
    shortName: "VB",
    igdbId: 87,
    databases: ["Nintendo - Virtual Boy"],
    emulatorIds: ["retroarch", "mednafen"],
  },
  {
    id: "nintendo_gameandwatch",
    name: "Nintendo Game & Watch",
    shortName: "G&W",
    emulatorIds: ["retroarch"],
  },

  // ==================== Sega ====================
  {
    id: "sega_genesis",
    name: "Sega Genesis",
    shortName: "Genesis",
    igdbId: 29,
    databases: ["Sega - Mega Drive - Genesis"],
    emulatorIds: ["retroarch", "blastem", "ares", "kegafusion"],
  },
  {
    id: "sega_mastersystem",
    name: "Sega Master System",
    shortName: "SMS",
    igdbId: 64,
    databases: ["Sega - Master System - Mark III"],
    emulatorIds: ["retroarch", "ares", "kegafusion"],
  },
  {
    id: "sega_gamegear",
    name: "Sega Game Gear",
    shortName: "GG",
    igdbId: 35,
    databases: ["Sega - Game Gear"],
    emulatorIds: ["retroarch", "ares", "kegafusion"],
  },
  {
    id: "sega_cd",
    name: "Sega CD",
    shortName: "Sega CD",
    igdbId: 78,
    databases: ["Sega - Mega-CD - Sega CD"],
    emulatorIds: ["retroarch", "ares", "kegafusion"],
  },
  {
    id: "sega_32x",
    name: "Sega 32X",
    shortName: "32X",
    igdbId: 30,
    databases: ["Sega - 32X"],
    emulatorIds: ["retroarch", "ares"],
  },
  {
    id: "sega_saturn",
    name: "Sega Saturn",
    shortName: "Saturn",
    igdbId: 32,
    databases: ["Sega - Saturn"],
    emulatorIds: ["retroarch", "mednafen", "yabause"],
  },
  {
    id: "sega_dreamcast",
    name: "Sega Dreamcast",
    shortName: "Dreamcast",
    igdbId: 23,
    databases: ["Sega - Dreamcast"],
    emulatorIds: ["retroarch", "flycast", "redream", "demul"],
  },
  {
    id: "sega_sg1000",
    name: "Sega SG-1000",
    shortName: "SG-1000",
    igdbId: 84,
    databases: ["Sega - SG-1000"],
    emulatorIds: ["retroarch", "ares"],
  },

  // ==================== Sony ====================
  {
    id: "sony_playstation",
    name: "Sony PlayStation",
    shortName: "PS1",
    igdbId: 7,
    databases: ["Sony - PlayStation"],
    emulatorIds: ["retroarch", "duckstation", "mednafen", "pcsxr-pgxp", "epsxe"],
  },
  {
    id: "sony_playstation2",
    name: "Sony PlayStation 2",
    shortName: "PS2",
    igdbId: 8,
    databases: ["Sony - PlayStation 2"],
    emulatorIds: ["pcsx2", "retroarch"],
  },
  {
    id: "sony_playstation3",
    name: "Sony PlayStation 3",
    shortName: "PS3",
    igdbId: 9,
    databases: ["Sony - PlayStation 3", "Sony - PlayStation 3 (PSN)"],
    emulatorIds: ["rpcs3"],
  },
  {
    id: "sony_playstation4",
    name: "Sony PlayStation 4",
    shortName: "PS4",
    igdbId: 48,
    emulatorIds: ["shadps4"],
  },
  {
    id: "sony_psp",
    name: "Sony PlayStation Portable",
    shortName: "PSP",
    igdbId: 38,
    databases: ["Sony - PlayStation Portable", "Sony - PlayStation Portable (PSN)"],
    emulatorIds: ["ppsspp", "retroarch"],
  },
  {
    id: "sony_vita",
    name: "Sony PlayStation Vita",
    shortName: "Vita",
    igdbId: 46,
    databases: ["Sony - PlayStation Vita", "Sony - PlayStation Vita (PSN)"],
    emulatorIds: ["vita3k"],
  },

  // ==================== Microsoft ====================
  {
    id: "xbox",
    name: "Microsoft Xbox",
    shortName: "Xbox",
    igdbId: 11,
    databases: ["Microsoft - Xbox"],
    emulatorIds: ["xemu", "cxbx-reloaded", "retroarch"],
  },
  {
    id: "xbox360",
    name: "Microsoft Xbox 360",
    shortName: "Xbox 360",
    igdbId: 12,
    emulatorIds: ["xenia"],
  },

  // ==================== NEC ====================
  {
    id: "nec_turbografx_16",
    name: "NEC TurboGrafx-16",
    shortName: "TG-16",
    igdbId: 86,
    databases: ["NEC - PC Engine - TurboGrafx 16"],
    emulatorIds: ["retroarch", "mednafen", "ares", "mesen"],
  },
  {
    id: "nec_turbografx_cd",
    name: "NEC TurboGrafx-CD",
    shortName: "TG-CD",
    igdbId: 150,
    databases: ["NEC - PC Engine CD - TurboGrafx-CD"],
    emulatorIds: ["retroarch", "mednafen", "ares", "mesen"],
  },
  {
    id: "nec_supergrafx",
    name: "NEC SuperGrafx",
    shortName: "SuperGrafx",
    igdbId: 128,
    databases: ["NEC - PC Engine SuperGrafx"],
    emulatorIds: ["retroarch", "mednafen", "ares"],
  },
  {
    id: "nec_pcfx",
    name: "NEC PC-FX",
    shortName: "PC-FX",
    igdbId: 274,
    databases: ["NEC - PC-FX"],
    emulatorIds: ["retroarch", "mednafen"],
  },
  {
    id: "nec_pc98",
    name: "NEC PC-98",
    shortName: "PC-98",
    igdbId: 149,
    databases: ["NEC - PC-98"],
    emulatorIds: ["retroarch"],
  },

  // ==================== SNK ====================
  {
    id: "snk_neogeo_aes",
    name: "SNK Neo Geo AES",
    shortName: "Neo Geo",
    igdbId: 80,
    emulatorIds: ["retroarch", "ares"],
  },
  {
    id: "snk_neogeo_cd",
    name: "SNK Neo Geo CD",
    shortName: "Neo Geo CD",
    igdbId: 136,
    databases: ["SNK - Neo Geo CD"],
    emulatorIds: ["retroarch"],
  },
  {
    id: "snk_neogeopocket",
    name: "SNK Neo Geo Pocket",
    shortName: "NGP",
    igdbId: 119,
    databases: ["SNK - Neo Geo Pocket"],
    emulatorIds: ["retroarch", "mednafen"],
  },
  {
    id: "snk_neogeopocket_color",
    name: "SNK Neo Geo Pocket Color",
    shortName: "NGPC",
    igdbId: 120,
    databases: ["SNK - Neo Geo Pocket Color"],
    emulatorIds: ["retroarch", "mednafen"],
  },

  // ==================== Atari ====================
  {
    id: "atari_2600",
    name: "Atari 2600",
    shortName: "2600",
    igdbId: 59,
    databases: ["Atari - 2600"],
    emulatorIds: ["retroarch", "stella", "ares"],
  },
  {
    id: "atari_5200",
    name: "Atari 5200",
    shortName: "5200",
    igdbId: 66,
    databases: ["Atari - 5200"],
    emulatorIds: ["retroarch", "altirra"],
  },
  {
    id: "atari_7800",
    name: "Atari 7800",
    shortName: "7800",
    igdbId: 60,
    databases: ["Atari - 7800"],
    emulatorIds: ["retroarch"],
  },
  {
    id: "atari_jaguar",
    name: "Atari Jaguar",
    shortName: "Jaguar",
    igdbId: 62,
    databases: ["Atari - Jaguar"],
    emulatorIds: ["retroarch", "virtualjaguar"],
  },
  {
    id: "atari_lynx",
    name: "Atari Lynx",
    shortName: "Lynx",
    igdbId: 61,
    databases: ["Atari - Lynx"],
    emulatorIds: ["retroarch", "mednafen"],
  },
  {
    id: "atari_st",
    name: "Atari ST/STE",
    shortName: "ST",
    igdbId: 63,
    databases: ["Atari - ST"],
    emulatorIds: ["retroarch"],
  },

  // ==================== Commodore ====================
  {
    id: "commodore_64",
    name: "Commodore 64",
    shortName: "C64",
    igdbId: 15,
    databases: ["Commodore - 64"],
    emulatorIds: ["retroarch", "vice"],
  },
  {
    id: "commodore_amiga",
    name: "Commodore Amiga",
    shortName: "Amiga",
    igdbId: 16,
    databases: ["Commodore - Amiga"],
    emulatorIds: ["retroarch", "fs-uae", "winuae"],
  },
  {
    id: "commodore_amiga_cd32",
    name: "Commodore Amiga CD32",
    shortName: "CD32",
    igdbId: 15,
    databases: ["Commodore - Amiga CD32"],
    emulatorIds: ["retroarch", "winuae"],
  },
  {
    id: "commodore_vic20",
    name: "Commodore VIC-20",
    shortName: "VIC-20",
    igdbId: 71,
    databases: ["Commodore - VIC-20"],
    emulatorIds: ["retroarch", "vice"],
  },

  // ==================== Microsoft ====================
  {
    id: "microsoft_msx",
    name: "Microsoft MSX",
    shortName: "MSX",
    igdbId: 27,
    databases: ["Microsoft - MSX"],
    emulatorIds: ["retroarch", "blueMSX"],
  },
  {
    id: "microsoft_msx2",
    name: "Microsoft MSX2",
    shortName: "MSX2",
    igdbId: 53,
    databases: ["Microsoft - MSX2"],
    emulatorIds: ["retroarch", "blueMSX"],
  },

  // ==================== Sinclair ====================
  {
    id: "sinclair_zxspectrum",
    name: "Sinclair ZX Spectrum",
    shortName: "ZX Spectrum",
    igdbId: 26,
    databases: ["Sinclair - ZX Spectrum"],
    emulatorIds: ["retroarch", "fuse"],
  },

  // ==================== Arcade ====================
  {
    id: "arcade_mame",
    name: "Arcade (MAME)",
    shortName: "MAME",
    igdbId: 52,
    emulatorIds: ["retroarch", "mame"],
  },
  {
    id: "arcade_fbneo",
    name: "Arcade (FinalBurn Neo)",
    shortName: "FBNeo",
    emulatorIds: ["retroarch", "fbneo"],
  },

  // ==================== Other ====================
  {
    id: "philips_cdi",
    name: "Philips CD-i",
    shortName: "CD-i",
    igdbId: 117,
    emulatorIds: [],
  },
  {
    id: "3do",
    name: "3DO Interactive Multiplayer",
    shortName: "3DO",
    igdbId: 50,
    emulatorIds: ["retroarch"],
  },
  {
    id: "bandai_wonderswan",
    name: "Bandai WonderSwan",
    shortName: "WonderSwan",
    igdbId: 57,
    databases: ["Bandai - WonderSwan"],
    emulatorIds: ["retroarch", "mednafen"],
  },
  {
    id: "bandai_wonderswan_color",
    name: "Bandai WonderSwan Color",
    shortName: "WSC",
    igdbId: 123,
    databases: ["Bandai - WonderSwan Color"],
    emulatorIds: ["retroarch", "mednafen"],
  },
  {
    id: "coleco_vision",
    name: "ColecoVision",
    shortName: "ColecoVision",
    igdbId: 68,
    databases: ["Coleco - ColecoVision"],
    emulatorIds: ["retroarch", "ares"],
  },
  {
    id: "gce_vectrex",
    name: "GCE Vectrex",
    shortName: "Vectrex",
    igdbId: 67,
    databases: ["GCE - Vectrex"],
    emulatorIds: ["retroarch"],
  },
  {
    id: "mattel_intellivision",
    name: "Mattel Intellivision",
    shortName: "Intellivision",
    igdbId: 67,
    databases: ["Mattel - Intellivision"],
    emulatorIds: ["retroarch"],
  },
  {
    id: "pc_dos",
    name: "PC (DOS)",
    shortName: "DOS",
    igdbId: 13,
    databases: ["DOS"],
    emulatorIds: ["dosbox", "scummvm"],
  },
  {
    id: "pc_windows",
    name: "PC (Windows)",
    shortName: "Windows",
    igdbId: 6,
    emulatorIds: [],
  },
];

/**
 * Get platform by ID
 */
export function getPlatformById(id: string): EmulatorPlatform | undefined {
  return emulatorPlatforms.find((p) => p.id === id);
}

/**
 * Get platforms for a specific emulator
 */
export function getPlatformsForEmulator(emulatorId: string): EmulatorPlatform[] {
  return emulatorPlatforms.filter((p) => p.emulatorIds.includes(emulatorId));
}

/**
 * Get popular platforms (for quick access)
 */
export function getPopularPlatforms(): EmulatorPlatform[] {
  const popularIds = [
    "nintendo_nes",
    "nintendo_super_nes",
    "nintendo_64",
    "nintendo_gamecube",
    "nintendo_wii",
    "nintendo_gameboy",
    "nintendo_gameboycolor",
    "nintendo_gameboyadvance",
    "nintendo_ds",
    "nintendo_3ds",
    "nintendo_switch",
    "sega_genesis",
    "sega_dreamcast",
    "sony_playstation",
    "sony_playstation2",
    "sony_playstation3",
    "sony_psp",
    "sony_vita",
    "xbox",
    "xbox360",
  ];
  return emulatorPlatforms.filter((p) => popularIds.includes(p.id));
}
