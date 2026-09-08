/**
 * Emulator definitions - Emulators
 *
 * Popular emulators with their profiles.
 * Based on Playnite's emulator definitions but adapted for LumaForge.
 */

import { EmulatorDefinition } from "./types";

export const emulatorDefinitions: EmulatorDefinition[] = [
  // ==================== Multi-Platform ====================
  {
    id: "retroarch",
    name: "RetroArch",
    website: "https://www.retroarch.com/",
    profiles: [
      // Nintendo
      {
        name: "FCEUmm (NES)",
        startupArguments: '-L ".\\cores\\fceumm_libretro.dll" "{ImagePath}"',
        platforms: ["nintendo_nes"],
        imageExtensions: ["nes", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\fceumm_libretro.dll"],
      },
      {
        name: "Mesen (NES)",
        startupArguments: '-L ".\\cores\\mesen_libretro.dll" "{ImagePath}"',
        platforms: ["nintendo_nes"],
        imageExtensions: ["nes", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\mesen_libretro.dll"],
      },
      {
        name: "Nestopia (NES)",
        startupArguments: '-L ".\\cores\\nestopia_libretro.dll" "{ImagePath}"',
        platforms: ["nintendo_nes"],
        imageExtensions: ["nes", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\nestopia_libretro.dll"],
      },
      {
        name: "Snes9x (SNES)",
        startupArguments: '-L ".\\cores\\snes9x_libretro.dll" "{ImagePath}"',
        platforms: ["nintendo_super_nes"],
        imageExtensions: ["sfc", "smc", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\snes9x_libretro.dll"],
      },
      {
        name: "bsnes (SNES)",
        startupArguments: '-L ".\\cores\\bsnes_libretro.dll" "{ImagePath}"',
        platforms: ["nintendo_super_nes"],
        imageExtensions: ["sfc", "smc", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\bsnes_libretro.dll"],
      },
      {
        name: "Mesen-S (SNES)",
        startupArguments: '-L ".\\cores\\mesen-s_libretro.dll" "{ImagePath}"',
        platforms: ["nintendo_super_nes"],
        imageExtensions: ["sfc", "smc", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\mesen-s_libretro.dll"],
      },
      {
        name: "Mupen64Plus (N64)",
        startupArguments: '-L ".\\cores\\mupen64plus_next_libretro.dll" "{ImagePath}"',
        platforms: ["nintendo_64"],
        imageExtensions: ["z64", "n64", "v64", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\mupen64plus_next_libretro.dll"],
      },
      {
        name: "ParaLLEl N64 (N64)",
        startupArguments: '-L ".\\cores\\parallel_n64_libretro.dll" "{ImagePath}"',
        platforms: ["nintendo_64"],
        imageExtensions: ["z64", "n64", "v64", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\parallel_n64_libretro.dll"],
      },
      {
        name: "MGBA (GBA)",
        startupArguments: '-L ".\\cores\\mgba_libretro.dll" "{ImagePath}"',
        platforms: ["nintendo_gameboyadvance"],
        imageExtensions: ["gba", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\mgba_libretro.dll"],
      },
      {
        name: "VisualBoyAdvance-M (GBA)",
        startupArguments: '-L ".\\cores\\vbam_libretro.dll" "{ImagePath}"',
        platforms: ["nintendo_gameboyadvance"],
        imageExtensions: ["gba", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\vbam_libretro.dll"],
      },
      {
        name: "Gambatte (GB/GBC)",
        startupArguments: '-L ".\\cores\\gambatte_libretro.dll" "{ImagePath}"',
        platforms: ["nintendo_gameboy", "nintendo_gameboycolor"],
        imageExtensions: ["gb", "gbc", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\gambatte_libretro.dll"],
      },
      {
        name: "SameBoy (GB/GBC)",
        startupArguments: '-L ".\\cores\\sameboy_libretro.dll" "{ImagePath}"',
        platforms: ["nintendo_gameboy", "nintendo_gameboycolor"],
        imageExtensions: ["gb", "gbc", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\sameboy_libretro.dll"],
      },
      {
        name: "MelonDS (DS)",
        startupArguments: '-L ".\\cores\\melonDS_libretro.dll" "{ImagePath}"',
        platforms: ["nintendo_ds"],
        imageExtensions: ["nds", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\melonDS_libretro.dll"],
      },
      {
        name: "DeSmuME (DS)",
        startupArguments: '-L ".\\cores\\desmume_libretro.dll" "{ImagePath}"',
        platforms: ["nintendo_ds"],
        imageExtensions: ["nds", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\desmume_libretro.dll"],
      },
      {
        name: "Citra (3DS)",
        startupArguments: '-L ".\\cores\\citra_libretro.dll" "{ImagePath}"',
        platforms: ["nintendo_3ds"],
        imageExtensions: ["3ds", "3dsx", "cia", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\citra_libretro.dll"],
      },
      {
        name: "Genesis Plus GX (Sega)",
        startupArguments: '-L ".\\cores\\genesis_plus_gx_libretro.dll" "{ImagePath}"',
        platforms: ["sega_genesis", "sega_mastersystem", "sega_gamegear", "sega_cd"],
        imageExtensions: ["gen", "md", "sms", "gg", "iso", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\genesis_plus_gx_libretro.dll"],
      },
      {
        name: "FBA (Arcade)",
        startupArguments: '-L ".\\cores\\fbalpha2012_libretro.dll" "{ImagePath}"',
        platforms: ["arcade_fbneo"],
        imageExtensions: ["zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\fbalpha2012_libretro.dll"],
      },
      {
        name: "MAME (Arcade)",
        startupArguments: '-L ".\\cores\\mame_libretro.dll" "{ImagePath}"',
        platforms: ["arcade_mame"],
        imageExtensions: ["zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\mame_libretro.dll"],
      },
      {
        name: "Beetle PSX (PlayStation)",
        startupArguments: '-L ".\\cores\\mednafen_psx_libretro.dll" "{ImagePath}"',
        platforms: ["sony_playstation"],
        imageExtensions: ["bin", "cue", "iso", "pbp", "chd", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\mednafen_psx_libretro.dll"],
      },
      {
        name: "Beetle Saturn (Saturn)",
        startupArguments: '-L ".\\cores\\mednafen_saturn_libretro.dll" "{ImagePath}"',
        platforms: ["sega_saturn"],
        imageExtensions: ["bin", "cue", "iso", "chd", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\mednafen_saturn_libretro.dll"],
      },
      {
        name: "Beetle PCE (TurboGrafx)",
        startupArguments: '-L ".\\cores\\mednafen_pce_libretro.dll" "{ImagePath}"',
        platforms: ["nec_turbografx_16", "nec_turbografx_cd", "nec_supergrafx"],
        imageExtensions: ["pce", "sgx", "cue", "chd", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\mednafen_pce_libretro.dll"],
      },
      {
        name: "FBNeo (Neo Geo)",
        startupArguments: '-L ".\\cores\\fbneo_libretro.dll" "{ImagePath}"',
        platforms: ["snk_neogeo_aes"],
        imageExtensions: ["zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\fbneo_libretro.dll"],
      },
      {
        name: "Beetle NeoPop (NGP/NGPC)",
        startupArguments: '-L ".\\cores\\mednafen_ngp_libretro.dll" "{ImagePath}"',
        platforms: ["snk_neogeopocket", "snk_neogeopocket_color"],
        imageExtensions: ["ngp", "ngc", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\mednafen_ngp_libretro.dll"],
      },
      {
        name: "Mednafen WonderSwan",
        startupArguments: '-L ".\\cores\\mednafen_wswan_libretro.dll" "{ImagePath}"',
        platforms: ["bandai_wonderswan", "bandai_wonderswan_color"],
        imageExtensions: ["ws", "wsc", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\mednafen_wswan_libretro.dll"],
      },
      {
        name: "VICE (Commodore)",
        startupArguments: '-L ".\\cores\\vice_libretro.dll" "{ImagePath}"',
        platforms: ["commodore_64", "commodore_vic20"],
        imageExtensions: ["d64", "d71", "d80", "g64", "p00", "x64", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\vice_libretro.dll"],
      },
      {
        name: "PUAE (Amiga)",
        startupArguments: '-L ".\\cores\\puae_libretro.dll" "{ImagePath}"',
        platforms: ["commodore_amiga"],
        imageExtensions: ["adf", "adz", "dms", "ipf", "uae", "zip", "7z"],
        startupExecutable: "^retroarch\\.exe$",
        profileFiles: ["cores\\puae_libretro.dll"],
      },
    ],
  },

  // ==================== Nintendo ====================
  {
    id: "dolphin",
    name: "Dolphin",
    website: "https://dolphin-emu.org/",
    profiles: [
      {
        name: "GameCube",
        startupArguments: '--exec="{ImagePath}" --batch',
        platforms: ["nintendo_gamecube"],
        imageExtensions: ["iso", "gcm", "gcz", "ciso", "rvz", "wad", "m3u"],
        startupExecutable: "^Dolphin\\.exe$",
      },
      {
        name: "Wii",
        startupArguments: '--exec="{ImagePath}" --batch',
        platforms: ["nintendo_wii"],
        imageExtensions: ["iso", "wbfs", "gcz", "ciso", "rvz", "wia", "wad", "m3u"],
        startupExecutable: "^Dolphin\\.exe$",
      },
    ],
  },
  {
    id: "cemu",
    name: "Cemu",
    website: "https://cemu.info/",
    profiles: [
      {
        name: "Wii U",
        startupArguments: '-f "{ImagePath}"',
        platforms: ["nintendo_wiiu"],
        imageExtensions: ["wud", "wux", "iso", "rpx", "rpl", "wad", "m3u"],
        startupExecutable: "^Cemu\\.exe$",
      },
    ],
  },
  {
    id: "yuzu",
    name: "Yuzu",
    website: "https://yuzu-emu.org/",
    profiles: [
      {
        name: "Switch",
        startupArguments: '"{ImagePath}" -f',
        platforms: ["nintendo_switch"],
        imageExtensions: ["nca", "nso", "nsp", "xci", "zip"],
        startupExecutable: "^yuzu\\.exe$",
      },
    ],
  },
  {
    id: "sudachi",
    name: "Sudachi",
    website: "https://sudachi-emu.com/",
    profiles: [
      {
        name: "Switch",
        startupArguments: '"{ImagePath}" -f',
        platforms: ["nintendo_switch"],
        imageExtensions: ["nca", "nso", "nsp", "xci", "zip"],
        startupExecutable: "^Sudachi\\.exe$",
      },
    ],
  },

  // ==================== PlayStation ====================
  {
    id: "duckstation",
    name: "DuckStation",
    website: "https://github.com/stenzek/duckstation",
    profiles: [
      {
        name: "PlayStation",
        startupArguments: '"{ImagePath}" -fullscreen',
        platforms: ["sony_playstation"],
        imageExtensions: ["bin", "cue", "iso", "pbp", "chd", "m3u"],
        startupExecutable: "^duckstation-qt\\.exe$",
      },
    ],
  },
  {
    id: "pcsx2",
    name: "PCSX2",
    website: "https://pcsx2.net/",
    profiles: [
      {
        name: "PlayStation 2 (QT)",
        startupArguments: '-fullscreen -slowboot -- {ImagePath}',
        platforms: ["sony_playstation2"],
        imageExtensions: ["iso", "bin", "mdf", "nrg", "img", "gz", "cso", "chd", "m3u"],
        startupExecutable: "^pcsx2-qt\\.exe$",
      },
      {
        name: "PlayStation 2 (Legacy)",
        startupArguments: '"{ImagePath}" --nogui --fullboot --fullscreen',
        platforms: ["sony_playstation2"],
        imageExtensions: ["iso", "bin", "mdf", "nrg", "img", "gz", "cso", "chd", "m3u"],
        startupExecutable: "^pcsx2x64\\.exe$",
      },
    ],
  },
  {
    id: "rpcs3",
    name: "RPCS3",
    website: "https://rpcs3.net/",
    profiles: [
      {
        name: "PlayStation 3",
        startupArguments: '"{ImagePath}" --no-gui --fullscreen',
        platforms: ["sony_playstation3"],
        imageExtensions: ["iso", "bin", "pkg", "edat", "self", "m3u"],
        startupExecutable: "^rpcs3\\.exe$",
      },
    ],
  },
  {
    id: "ppsspp",
    name: "PPSSPP",
    website: "https://www.ppsspp.org/",
    profiles: [
      {
        name: "PSP (64-bit)",
        startupArguments: '"{ImagePath}" --pause-menu-exit --fullscreen',
        platforms: ["sony_psp"],
        imageExtensions: ["iso", "cso", "pbp", "chd"],
        startupExecutable: "^PPSSPPWindows64\\.exe$",
      },
      {
        name: "PSP (32-bit)",
        startupArguments: '"{ImagePath}" --pause-menu-exit --fullscreen',
        platforms: ["sony_psp"],
        imageExtensions: ["iso", "cso", "pbp", "chd"],
        startupExecutable: "^PPSSPPWindows\\.exe$",
      },
    ],
  },
  {
    id: "vita3k",
    name: "Vita3K",
    website: "https://vita3k.org/",
    profiles: [
      {
        name: "PlayStation Vita",
        startupArguments: '"{ImagePath}"',
        platforms: ["sony_vita"],
        imageExtensions: ["vpk", "iso", "bin"],
        startupExecutable: "^Vita3K\\.exe$",
      },
    ],
  },

  // ==================== Sega ====================
  {
    id: "redream",
    name: "Redream",
    website: "https://redream.io/",
    profiles: [
      {
        name: "Dreamcast",
        startupArguments: '"{ImagePath}"',
        platforms: ["sega_dreamcast"],
        imageExtensions: ["cdi", "gdi", "chd", "iso", "m3u"],
        startupExecutable: "^redream\\.exe$",
      },
    ],
  },
  {
    id: "flycast",
    name: "Flycast",
    website: "https://github.com/flyinghead/flycast",
    profiles: [
      {
        name: "Dreamcast",
        startupArguments: '"{ImagePath}"',
        platforms: ["sega_dreamcast"],
        imageExtensions: ["cdi", "gdi", "chd", "iso", "m3u"],
        startupExecutable: "^flycast\\.exe$",
      },
    ],
  },
  {
    id: "blastem",
    name: "BlastEm",
    website: "https://www.retrodev.com/blastem/",
    profiles: [
      {
        name: "Genesis",
        startupArguments: '"{ImagePath}"',
        platforms: ["sega_genesis"],
        imageExtensions: ["bin", "gen", "md", "smd", "zip"],
        startupExecutable: "^blastem\\.exe$",
      },
    ],
  },

  // ==================== Microsoft ====================
  {
    id: "xemu",
    name: "xemu",
    website: "https://xemu.app/",
    profiles: [
      {
        name: "Xbox",
        startupArguments: '"{ImagePath}"',
        platforms: ["xbox"],
        imageExtensions: ["iso", "xbe", "xex"],
        startupExecutable: "^xemu\\.exe$",
      },
    ],
  },
  {
    id: "xenia",
    name: "Xenia",
    website: "https://xenia.jp/",
    profiles: [
      {
        name: "Xbox 360",
        startupArguments: '"{ImagePath}"',
        platforms: ["xbox360"],
        imageExtensions: ["iso", "xex", "xecs", "m3u"],
        startupExecutable: "^xenia\\.exe$",
      },
    ],
  },

  // ==================== Other ====================
  {
    id: "dosbox",
    name: "DOSBox",
    website: "https://www.dosbox.com/",
    profiles: [
      {
        name: "DOS",
        startupArguments: '"{ImagePath}"',
        platforms: ["pc_dos"],
        imageExtensions: ["exe", "bat", "com", "iso", "cue", "zip"],
        startupExecutable: "^dosbox\\.exe$",
      },
    ],
  },
  {
    id: "scummvm",
    name: "ScummVM",
    website: "https://www.scummvm.org/",
    profiles: [
      {
        name: "DOS/Windows",
        startupArguments: '"{ImagePath}"',
        platforms: ["pc_dos", "pc_windows"],
        imageExtensions: ["exe", "bat", "com", "iso", "cue", "zip"],
        startupExecutable: "^scummvm\\.exe$",
      },
    ],
  },
];

/**
 * Get emulator definition by ID
 */
export function getEmulatorById(id: string): EmulatorDefinition | undefined {
  return emulatorDefinitions.find((e) => e.id === id);
}

/**
 * Get emulators that support a specific platform
 */
export function getEmulatorsForPlatform(platformId: string): EmulatorDefinition[] {
  return emulatorDefinitions.filter((e) =>
    e.profiles.some((p) => p.platforms.includes(platformId))
  );
}

/**
 * Get all supported file extensions for an emulator
 */
export function getExtensionsForEmulator(emulatorId: string): string[] {
  const emulator = getEmulatorById(emulatorId);
  if (!emulator) return [];

  const extensions = new Set<string>();
  for (const profile of emulator.profiles) {
    for (const ext of profile.imageExtensions) {
      extensions.add(ext);
    }
  }
  return Array.from(extensions);
}

/**
 * Get all emulator definitions
 */
export function getAllEmulatorDefinitions(): EmulatorDefinition[] {
  return emulatorDefinitions;
}
