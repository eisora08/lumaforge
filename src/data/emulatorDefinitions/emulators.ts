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
  // ─── HIGH PRIORITY: Switch alternatives ─────────────────────────────
  {
    id: "ryujinx",
    name: "Ryujinx",
    website: "https://github.com/Ryujinx/Ryujinx",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_switch"],
        imageExtensions: ["xci", "nsp", "nca", "nso", "nro"],
        startupExecutable: "^Ryujinx\\.exe$",
        profileFiles: ["Ryujinx.dll"],
      },
      {
        name: "Avalonia",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_switch"],
        imageExtensions: ["xci", "nsp", "nca", "nso", "nro"],
        startupExecutable: "^Ryujinx\\.Ava\\.exe$",
        profileFiles: ["Ryujinx.Ava.dll"],
      },
    ],
  },
  {
    id: "citron",
    name: "Citron",
    website: "https://git.sr.ht/~sammy1/citron",
    profiles: [
      {
        name: "Default",
        startupArguments: '-f -g "{ImagePath}"',
        platforms: ["nintendo_switch"],
        imageExtensions: ["nso", "nro", "nca", "xci", "nsp"],
        startupExecutable: "^citron\\.exe$",
      },
    ],
  },
  {
    id: "eden",
    name: "Eden",
    website: "https://eden-emu.dev/",
    profiles: [
      {
        name: "Default",
        startupArguments: '-f -g "{ImagePath}"',
        platforms: ["nintendo_switch"],
        imageExtensions: ["nso", "nro", "nca", "xci", "nsp"],
        startupExecutable: "^eden\\.exe$",
      },
    ],
  },
  {
    id: "suyu",
    name: "Suyu",
    website: "https://suyu.dev/",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_switch"],
        imageExtensions: ["nso", "nro", "nca", "xci", "nsp"],
        startupExecutable: "^suyu\\.exe$",
      },
    ],
  },
  // ─── HIGH PRIORITY: PS4 ────────────────────────────────────────────
  {
    id: "shadps4",
    name: "shadPS4",
    website: "https://github.com/shadps4-emu/shadPS4",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImagePath}"',
        platforms: ["sony_playstation4"],
        imageExtensions: ["self"],
        startupExecutable: "^shadPS4\\.exe$",
      },
    ],
  },
  // ─── HIGH PRIORITY: 3DS ────────────────────────────────────────────
  {
    id: "lime3ds",
    name: "Lime3DS",
    website: "https://github.com/Lime3DS/Lime3DS",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_3ds"],
        imageExtensions: ["3ds", "3dsx", "cci", "cxi", "elf", "cia"],
        startupExecutable: "^Lime3DS\\.exe$",
      },
    ],
  },
  // ─── HIGH PRIORITY: DS ─────────────────────────────────────────────
  {
    id: "melonds",
    name: "melonDS",
    website: "http://melonds.kuribo64.net/",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImagePath}" -f',
        platforms: ["nintendo_ds", "nintendo_dsi"],
        imageExtensions: ["nds", "zip"],
        startupExecutable: "^melonDS\\.exe$",
      },
    ],
  },
  {
    id: "desmume",
    name: "DeSmuME",
    website: "https://desmume.org/",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_ds"],
        imageExtensions: ["nds", "zip", "7z", "rar", "gz"],
        startupExecutable: "^DeSmuME.*\\.exe$",
      },
    ],
  },
  // ─── HIGH PRIORITY: SNES ───────────────────────────────────────────
  {
    id: "snes9x",
    name: "Snes9X",
    website: "http://www.snes9x.com/",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImagePath}" -fullscreen',
        platforms: ["nintendo_super_nes"],
        imageExtensions: ["zip", "gz", "jma", "sfc", "smc"],
        startupExecutable: "^snes9x.*\\.exe$",
      },
    ],
  },
  // ─── HIGH PRIORITY: GBA / GB / GBC ────────────────────────────────
  {
    id: "mgba",
    name: "mGBA",
    website: "https://mgba.io/",
    profiles: [
      {
        name: "Nintendo Game Boy",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_gameboy"],
        imageExtensions: ["zip", "7z", "rar", "bin", "gb", "dmg"],
        startupExecutable: "^mGBA\\.exe$",
      },
      {
        name: "Nintendo Game Boy Color",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_gameboycolor"],
        imageExtensions: ["zip", "7z", "rar", "bin", "gbc", "cgb", "sgb"],
        startupExecutable: "^mGBA\\.exe$",
      },
      {
        name: "Nintendo Game Boy Advance",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_gameboyadvance"],
        imageExtensions: ["zip", "7z", "rar", "bin", "elf", "mb", "gba", "agb"],
        startupExecutable: "^mGBA\\.exe$",
      },
    ],
  },
  {
    id: "sameboy",
    name: "SameBoy",
    website: "https://sameboy.github.io/",
    profiles: [
      {
        name: "Nintendo Game Boy",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_gameboy"],
        imageExtensions: ["gb"],
        startupExecutable: "^sameboy\\.exe$",
      },
      {
        name: "Nintendo Game Boy Color",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_gameboycolor"],
        imageExtensions: ["gbc"],
        startupExecutable: "^sameboy\\.exe$",
      },
    ],
  },
  // ─── HIGH PRIORITY: N64 ────────────────────────────────────────────
  {
    id: "project64",
    name: "Project64",
    website: "https://www.pj64-emu.com/",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_64"],
        imageExtensions: ["rom", "n64", "v64", "z64", "jap", "pal", "usa", "zip", "7z"],
        startupExecutable: "^Project64\\.exe$",
      },
    ],
  },
  {
    id: "simple64",
    name: "simple64",
    website: "https://simple64.github.io/",
    profiles: [
      {
        name: "Default",
        startupArguments: '--nogui "{ImagePath}"',
        platforms: ["nintendo_64"],
        imageExtensions: ["n64", "v64", "z64", "rom", "zip", "7z"],
        startupExecutable: "^simple64-gui\\.exe$",
      },
    ],
  },
  // ─── HIGH PRIORITY: NES ────────────────────────────────────────────
  {
    id: "nestopia",
    name: "Nestopia",
    website: "http://nestopia.sourceforge.net/",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_nes"],
        imageExtensions: ["nes", "unf", "fds", "nsf", "zip"],
        startupExecutable: "^nestopia\\.exe$",
      },
    ],
  },
  {
    id: "mesen",
    name: "Mesen",
    website: "https://www.mesen.ca/",
    profiles: [
      {
        name: "NES",
        startupArguments: '/fullscreen "{ImagePath}"',
        platforms: ["nintendo_nes"],
        imageExtensions: ["nes", "fds", "unf", "nsf", "nsfe", "zip", "7z"],
        startupExecutable: "^Mesen\\.exe$",
      },
      {
        name: "SNES",
        startupArguments: '/fullscreen "{ImagePath}"',
        platforms: ["nintendo_super_nes"],
        imageExtensions: ["sfc", "fig", "smc", "spc", "zip"],
        startupExecutable: "^Mesen\\.exe$",
      },
      {
        name: "Game Boy",
        startupArguments: '/fullscreen "{ImagePath}"',
        platforms: ["nintendo_gameboy"],
        imageExtensions: ["gb", "gbs", "zip"],
        startupExecutable: "^Mesen\\.exe$",
      },
      {
        name: "Game Boy Color",
        startupArguments: '/fullscreen "{ImagePath}"',
        platforms: ["nintendo_gameboycolor"],
        imageExtensions: ["gbc", "zip"],
        startupExecutable: "^Mesen\\.exe$",
      },
      {
        name: "PC Engine",
        startupArguments: '/fullscreen "{ImagePath}"',
        platforms: ["nec_turbografx_16"],
        imageExtensions: ["pce", "hes", "zip"],
        startupExecutable: "^Mesen\\.exe$",
      },
      {
        name: "PC Engine CD",
        startupArguments: '/fullscreen "{ImagePath}"',
        platforms: ["nec_turbografx_cd"],
        imageExtensions: ["cue", "zip"],
        startupExecutable: "^Mesen\\.exe$",
      },
      {
        name: "PC Engine SuperGrafx",
        startupArguments: '/fullscreen "{ImagePath}"',
        platforms: ["nec_supergrafx"],
        imageExtensions: ["pce", "sgx", "zip"],
        startupExecutable: "^Mesen\\.exe$",
      },
    ],
  },
  // ─── MEDIUM PRIORITY ─────────────────────────────────────────────
  {
    id: "ymir",
    name: "Ymir",
    website: "https://github.com/StrikerX3/Ymir",
    profiles: [
      {
        name: "Default",
        startupArguments: '-d "{ImagePath}" -f',
        platforms: ["sega_saturn"],
        imageExtensions: ["chd", "cue", "ccd", "mdf", "iso"],
        startupExecutable: "^ymir-sdl3\\.exe$",
      },
    ],
  },
  {
    id: "mednafen",
    name: "Mednafen",
    website: "https://mednafen.github.io/",
    profiles: [
      {
        name: "Apple II",
        startupArguments: '"{ImagePath}"',
        platforms: ["pc_dos"],
        imageExtensions: ["d13", "sk", "do", "po", "woz", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "Atari Lynx",
        startupArguments: '"{ImagePath}"',
        platforms: ["atari_lynx"],
        imageExtensions: ["lnx", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "NEC TurboGrafx 16",
        startupArguments: '"{ImagePath}"',
        platforms: ["nec_turbografx_16"],
        imageExtensions: ["pce", "zip", "m3u"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "NEC TurboGrafx-CD",
        startupArguments: '"{ImagePath}"',
        platforms: ["nec_turbografx_cd"],
        imageExtensions: ["cue", "ccd", "chd", "m3u"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "NEC PC-FX",
        startupArguments: '"{ImagePath}"',
        platforms: ["nec_pcfx"],
        imageExtensions: ["cue", "ccd", "chd", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "Nintendo Entertainment System",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_nes"],
        imageExtensions: ["nes", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "Nintendo Game Boy",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_gameboy"],
        imageExtensions: ["gb", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "Nintendo Game Boy Color",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_gameboycolor"],
        imageExtensions: ["gbc", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "Nintendo Game Boy Advance",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_gameboyadvance"],
        imageExtensions: ["gba", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "Nintendo Virtual Boy",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_virtualboy"],
        imageExtensions: ["vb", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "PC Engine SuperGrafx",
        startupArguments: '"{ImagePath}"',
        platforms: ["nec_supergrafx"],
        imageExtensions: ["sgx", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "Sega Game Gear",
        startupArguments: '"{ImagePath}"',
        platforms: ["sega_gamegear"],
        imageExtensions: ["sgg", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "Sega Genesis",
        startupArguments: '"{ImagePath}"',
        platforms: ["sega_genesis"],
        imageExtensions: ["gen", "md", "bin", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "Sega Master System",
        startupArguments: '"{ImagePath}"',
        platforms: ["sega_mastersystem"],
        imageExtensions: ["sms", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "Sega Saturn",
        startupArguments: '"{ImagePath}"',
        platforms: ["sega_saturn"],
        imageExtensions: ["chd", "iso", "bin", "cue", "m3u"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "SNK Neo Geo Pocket",
        startupArguments: '"{ImagePath}"',
        platforms: ["snk_neogeopocket"],
        imageExtensions: ["ngp", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "SNK Neo Geo Pocket Color",
        startupArguments: '"{ImagePath}"',
        platforms: ["snk_neogeopocket_color"],
        imageExtensions: ["ngc", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "Sony PlayStation",
        startupArguments: '"{ImagePath}"',
        platforms: ["sony_playstation"],
        imageExtensions: ["chd", "cue", "ccd", "mds", "m3u"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "Super Nintendo Entertainment System",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_super_nes"],
        imageExtensions: ["smc", "sfc", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "Bandai WonderSwan",
        startupArguments: '"{ImagePath}"',
        platforms: ["bandai_wonderswan"],
        imageExtensions: ["ws", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
      {
        name: "Bandai WonderSwan Color",
        startupArguments: '"{ImagePath}"',
        platforms: ["bandai_wonderswan_color"],
        imageExtensions: ["wsc", "zip"],
        startupExecutable: "^mednafen\\.exe$",
      },
    ],
  },
  {
    id: "mame",
    name: "MAME",
    website: "https://www.mamedev.org/",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImageNameNoExt}"',
        platforms: ["arcade_mame"],
        imageExtensions: ["zip"],
        startupExecutable: "^mame\\.exe$",
      },
    ],
  },
  {
    id: "bigpemu",
    name: "BigPEmu",
    website: "https://www.richwhitehouse.com/jaguar/",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImagePath}"',
        platforms: ["atari_jaguar"],
        imageExtensions: ["j64", "cof", "rom", "jag", "abs", "zip", "cue", "cdi"],
        startupExecutable: "^BigPEmu\\.exe$",
      },
    ],
  },
  {
    id: "kegafusion",
    name: "Kega Fusion",
    website: "https://www.carpeludum.com/kega-fusion/",
    profiles: [
      {
        name: "Sega Genesis",
        startupArguments: '"{ImagePath}" -auto -fullscreen',
        platforms: ["sega_genesis"],
        imageExtensions: ["bin", "smd", "md", "raw", "gen", "zip"],
        startupExecutable: "^Fusion\\.exe$",
      },
      {
        name: "Sega 32X",
        startupArguments: '"{ImagePath}" -auto -fullscreen',
        platforms: ["sega_32x"],
        imageExtensions: ["32x", "raw", "zip"],
        startupExecutable: "^Fusion\\.exe$",
      },
      {
        name: "Sega CD",
        startupArguments: '"{ImagePath}" -auto -fullscreen',
        platforms: ["sega_cd"],
        imageExtensions: ["cue", "bin", "iso", "raw", "zip"],
        startupExecutable: "^Fusion\\.exe$",
      },
      {
        name: "Sega Master System",
        startupArguments: '"{ImagePath}" -auto -fullscreen',
        platforms: ["sega_mastersystem"],
        imageExtensions: ["sms", "sg", "sc", "mv", "bin", "raw", "zip"],
        startupExecutable: "^Fusion\\.exe$",
      },
      {
        name: "Sega Game Gear",
        startupArguments: '"{ImagePath}" -auto -fullscreen',
        platforms: ["sega_gamegear"],
        imageExtensions: ["bin", "gg", "raw", "zip"],
        startupExecutable: "^Fusion\\.exe$",
      },
    ],
  },
  {
    id: "cxbx-reloaded",
    name: "Cxbx-Reloaded",
    website: "https://cxbx-reloaded.co.uk",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImagePath}"',
        platforms: ["xbox"],
        imageExtensions: ["xbe"],
        startupExecutable: "^cxbx\\.exe$",
      },
    ],
  },
  {
    id: "supermodel",
    name: "Supermodel",
    website: "https://github.com/trzy/Supermodel",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImagePath}" -fullscreen',
        platforms: ["arcade_mame"],
        imageExtensions: ["zip"],
        startupExecutable: "^supermodel\\.exe$",
      },
    ],
  },
  {
    id: "fs-uae",
    name: "FS-UAE",
    website: "https://fs-uae.net/",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImagePath}"',
        platforms: ["commodore_amiga"],
        imageExtensions: [
          "iso", "ccd", "cue", "chd", "mds", "nrg", "adf", "adz",
          "gz", "dms", "ipf", "scp", "fdi", "lha", "lzx",
        ],
        startupExecutable: "^fs-uae\\.exe$",
      },
    ],
  },
  {
    id: "winuae",
    name: "WinUAE",
    website: "http://www.winuae.net/",
    profiles: [
      {
        name: "Default",
        startupArguments: '-s use_gui=no -s gfx_fullscreen_amiga=true -0 "{ImagePath}"',
        platforms: ["commodore_amiga"],
        imageExtensions: [
          "iso", "ccd", "cue", "chd", "mds", "nrg", "adf", "adz",
          "gz", "dms", "ipf", "scp", "fdi", "lha",
        ],
        startupExecutable: "^winuae.*\\.exe$",
      },
      {
        name: "Amiga CD32",
        startupArguments: '-s use_gui=no -s gfx_fullscreen_amiga=true -s quickstart=cd32,0 -cdimage="{ImagePath}"',
        platforms: ["commodore_amiga_cd32"],
        imageExtensions: ["cue", "chd", "iso", "ccd", "mds", "nrg"],
        startupExecutable: "^winuae.*\\.exe$",
      },
      {
        name: "Amiga 500",
        startupArguments: '-s use_gui=no -s gfx_fullscreen_amiga=true -s quickstart=a500,0 -0 "{ImagePath}"',
        platforms: ["commodore_amiga"],
        imageExtensions: ["adf", "adz", "gz", "dms", "ipf", "scp", "fdi", "lha"],
        startupExecutable: "^winuae.*\\.exe$",
      },
      {
        name: "Amiga 1200",
        startupArguments: '-s use_gui=no -s gfx_fullscreen_amiga=true -s quickstart=a1200,0 -0 "{ImagePath}"',
        platforms: ["commodore_amiga"],
        imageExtensions: [
          "iso", "ccd", "cue", "chd", "mds", "nrg", "adf", "adz",
          "gz", "dms", "ipf", "scp", "fdi", "lha",
        ],
        startupExecutable: "^winuae.*\\.exe$",
      },
    ],
  },
  {
    id: "bizhawk",
    name: "BizHawk",
    website: "http://tasvideos.org/Bizhawk.html",
    profiles: [
      {
        name: "Atari 2600",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["atari_2600"],
        imageExtensions: ["a26", "zip", "rar", "7z", "gz", "bin"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Atari 7800",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["atari_7800"],
        imageExtensions: ["a78", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Atari Jaguar",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["atari_jaguar"],
        imageExtensions: ["j64", "jag", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Atari Lynx",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["atari_lynx"],
        imageExtensions: ["lnx", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Coleco ColecoVision",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["coleco_vision"],
        imageExtensions: ["col", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Commodore 64",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["commodore_64"],
        imageExtensions: ["prg", "d64", "g64", "crt", "tap", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "GCE Vectrex",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["gce_vectrex"],
        imageExtensions: ["vec", "zip"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Mattel Intellivision",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["mattel_intellivision"],
        imageExtensions: ["int", "bin", "rom", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "NEC PC-FX",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["nec_pcfx"],
        imageExtensions: ["ccd", "chd", "cue", "toc"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "NEC TurboGrafx 16",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["nec_turbografx_16"],
        imageExtensions: ["pce", "cue", "ccd", "mds", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "NEC TurboGrafx-CD",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["nec_turbografx_cd"],
        imageExtensions: ["cue", "ccd", "mds"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Nintendo DS/DSi",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["nintendo_ds", "nintendo_dsi"],
        imageExtensions: ["nds", "zip"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Nintendo Entertainment System",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["nintendo_nes"],
        imageExtensions: ["nes", "fds", "unf", "nsf", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Nintendo Game Boy",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["nintendo_gameboy"],
        imageExtensions: ["gb", "sgb", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Nintendo Game Boy Color",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["nintendo_gameboycolor"],
        imageExtensions: ["gbc", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Nintendo Game Boy Advance",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["nintendo_gameboyadvance"],
        imageExtensions: ["gba", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Nintendo Virtual Boy",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["nintendo_virtualboy"],
        imageExtensions: ["vb", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Nintendo 3DS",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["nintendo_3ds"],
        imageExtensions: ["3ds", "3dsx", "cia", "cxi"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Nintendo 64",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["nintendo_64"],
        imageExtensions: ["z64", "v64", "n64", "zip"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "PC Engine SuperGrafx",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["nec_supergrafx"],
        imageExtensions: ["sgx", "zip", "rar", "7z", "gz", "pce"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Sega Game Gear",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["sega_gamegear"],
        imageExtensions: ["gg", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "SG-1000",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["sega_sg1000"],
        imageExtensions: ["sg1000", "sg", "zip"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Sega Genesis",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["sega_genesis"],
        imageExtensions: ["gen", "md", "smd", "32x", "bin", "cue", "ccd", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Sega 32X",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["sega_32x"],
        imageExtensions: ["32x"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Sega CD",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["sega_cd"],
        imageExtensions: ["chd", "cue", "ccd"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Sega Master System",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["sega_mastersystem"],
        imageExtensions: ["sms", "gg", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Sega Saturn",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["sega_saturn"],
        imageExtensions: ["iso", "bin", "cue"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "SNK Neo Geo Pocket",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["snk_neogeopocket"],
        imageExtensions: ["ngp", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "SNK Neo Geo Pocket Color",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["snk_neogeopocket_color"],
        imageExtensions: ["ngc", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Sony PlayStation",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["sony_playstation"],
        imageExtensions: ["cue", "ccd", "mds", "m3u"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Super Nintendo Entertainment System",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["nintendo_super_nes"],
        imageExtensions: ["smc", "sfc", "xml", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "WonderSwan",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["bandai_wonderswan"],
        imageExtensions: ["ws", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "WonderSwan Color",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["bandai_wonderswan_color"],
        imageExtensions: ["wsc", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
      {
        name: "Sinclair ZX Spectrum",
        startupArguments: '"{ImagePath}" --fullscreen',
        platforms: ["sinclair_zxspectrum"],
        imageExtensions: ["tzx", "tap", "dsk", "pzx", "csw", "wav", "zip", "rar", "7z", "gz"],
        startupExecutable: "^EmuHawk\\.exe$",
      },
    ],
  },
  {
    id: "ruffle",
    name: "Ruffle",
    website: "https://ruffle.rs/",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImagePath}"',
        platforms: ["pc_windows"],
        imageExtensions: ["swf"],
        startupExecutable: "^ruffle\\.exe$",
      },
    ],
  },
  {
    id: "epsxe",
    name: "ePSXe",
    website: "https://www.epsxe.com/",
    profiles: [
      {
        name: "Default",
        startupArguments: '-nogui -slowboot -loadbin "{ImagePath}"',
        platforms: ["sony_playstation"],
        imageExtensions: ["bin", "iso", "img", "pbp", "zip", "cue"],
        startupExecutable: "^ePSXe\\.exe$",
      },
    ],
  },
  {
    id: "visualboyadvance-m",
    name: "VisualBoyAdvance-M",
    website: "https://vba-m.com/",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImagePath}"',
        platforms: ["nintendo_gameboy", "nintendo_gameboycolor", "nintendo_gameboyadvance"],
        imageExtensions: [
          "zip", "7z", "rar", "bin", "elf", "mb", "gba", "agb",
          "dmg", "gb", "gbc", "cgb", "sgb",
        ],
        startupExecutable: "^visualboyadvance-m\\.exe$",
      },
    ],
  },
  {
    id: "model2emulator",
    name: "Model 2 Emulator",
    website: "https://segaretro.org/Model_2_Emulator",
    profiles: [
      {
        name: "Default",
        startupArguments: '"{ImageNameNoExt}"',
        platforms: ["arcade_mame"],
        imageExtensions: ["zip"],
        startupExecutable: "^emulator_multicpu\\.exe$",
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
