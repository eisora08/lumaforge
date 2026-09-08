/**
 * Emulator Scanner Service
 *
 * Scans directories for emulator executables and ROM files.
 * Based on Playnite's emulator scanning system.
 */

import { scanDirectoryRecursive, fileExists, type ScannedFile } from "./tauri";
import { emulatorDefinitions, getEmulatorById } from "../data/emulatorDefinitions/emulators";
import type { EmulatorDefinition } from "../data/emulatorDefinitions/types";
import { getEmulatorConfig } from "./emulatorConfigStore";
import {
  isRomFile,
  guessPlatformFromFilename,
  guessRegionFromFilename,
  generateEmulatorGameId,
} from "./emulatorGameStore";
import type { EmulatorGameEntry } from "../data/emulatorDefinitions/types";

// ─── Types ─────────────────────────────────────────────────────────────

export type DetectedEmulator = {
  definitionId: string;
  definitionName: string;
  detectedExePath: string;
  detectedDir: string;
  matchedProfiles: {
    name: string;
    startupArguments: string;
    profileFiles: string[];
  }[];
};

export type ScannedRom = {
  romPath: string;
  fileName: string;
  fileSize: number;
  platformId: string | null;
  region: string | null;
};

// ─── Emulator Detection ────────────────────────────────────────────────

/**
 * Scan a directory for emulator executables.
 * Matches files against all known emulator definitions.
 */
export async function scanForEmulators(dir: string): Promise<DetectedEmulator[]> {
  const files = await scanDirectoryRecursive(dir, 3);
  const detected: DetectedEmulator[] = [];

  for (const definition of emulatorDefinitions) {
    const matched = matchEmulatorInFiles(definition, files, dir);
    if (matched) {
      detected.push(matched);
    }
  }

  return detected;
}

function matchEmulatorInFiles(
  definition: EmulatorDefinition,
  files: ScannedFile[],
  _scanDir: string
): DetectedEmulator | null {
  const matchedProfiles: DetectedEmulator["matchedProfiles"] = [];
  let detectedExePath = "";
  let detectedDir = "";

  for (const profile of definition.profiles) {
    const exeRegex = new RegExp(profile.startupExecutable, "i");

    for (const file of files) {
      if (file.is_dir) continue;
      if (!exeRegex.test(file.name)) continue;

      // Check if required profileFiles exist
      const fileDir = file.path.replace(/[\\/][^\\/]+$/, "");
      const profileFilesOk = !profile.profileFiles?.length || profile.profileFiles.every((pf) => {
        const requiredPath = fileDir + "\\" + pf;
        return files.some((f) => f.path.toLowerCase() === requiredPath.toLowerCase());
      });

      if (!profileFilesOk) continue;

      // Check if this profile is already matched
      if (matchedProfiles.some((mp) => mp.name === profile.name)) continue;

      matchedProfiles.push({
        name: profile.name,
        startupArguments: profile.startupArguments,
        profileFiles: profile.profileFiles ?? [],
      });

      if (!detectedExePath) {
        detectedExePath = file.path;
        detectedDir = fileDir;
      }
    }
  }

  if (matchedProfiles.length === 0) return null;

  return {
    definitionId: definition.id,
    definitionName: definition.name,
    detectedExePath,
    detectedDir,
    matchedProfiles,
  };
}

// ─── ROM Scanning ──────────────────────────────────────────────────────

/**
 * Scan a directory for ROM files.
 * Uses supported extensions from the emulator config profile or falls back to global list.
 */
export async function scanForRoms(
  dir: string,
  options: {
    emulatorDefinitionId?: string;
    emulatorProfileName?: string;
    emulatorConfigId?: string;
    emulatorProfileId?: string;
    scanSubfolders?: boolean;
    supportedExtensions?: string[];
  } = {}
): Promise<ScannedRom[]> {
  const maxDepth = options.scanSubfolders !== false ? 10 : 1;
  const files = await scanDirectoryRecursive(dir, maxDepth);

  // Determine supported extensions — priority: explicit > config profile > definition profile
  let extensions: Set<string> | null = null;
  let installDir: string | null = null;

  if (options.supportedExtensions) {
    extensions = new Set(options.supportedExtensions.map((e) => e.toLowerCase()));
  } else if (options.emulatorConfigId && options.emulatorProfileId) {
    // Look up the user-configured profile's supportedFileTypes from the config store
    const config = getEmulatorConfig(options.emulatorConfigId);
    if (config) {
      installDir = config.installDir;
      const profile = config.profiles.find((p) => p.id === options.emulatorProfileId);
      if (profile && profile.supportedFileTypes.length > 0) {
        extensions = new Set(profile.supportedFileTypes.map((e) => e.toLowerCase().replace(/^\./, "")));
      }
    }
  }

  // Fallback: use definition's built-in profile imageExtensions
  if (!extensions && options.emulatorDefinitionId && options.emulatorProfileName) {
    const def = getEmulatorById(options.emulatorDefinitionId);
    if (def) {
      const profile = def.profiles.find((p) => p.name === options.emulatorProfileName);
      if (profile) {
        extensions = new Set(profile.imageExtensions.map((e) => e.toLowerCase()));
      }
    }
  }

  const roms: ScannedRom[] = [];

  for (const file of files) {
    if (file.is_dir) continue;

    // Skip files inside the emulator's own install directory
    if (installDir && file.path.toLowerCase().startsWith(installDir.toLowerCase())) continue;

    const ext = file.name.split(".").pop()?.toLowerCase();

    // If we have specific extensions from the profile, use ONLY those
    if (extensions) {
      if (!ext || !extensions.has(ext)) continue;
    } else {
      // No profile extensions specified — fall back to global isRomFile check
      if (!isRomFile(file.name)) continue;
    }

    // Skip .bin files that look like PlayStation disc images (large files without context)
    if (ext === "bin" && file.size > 100_000_000) {
      const cuePath = file.path.replace(/\.[^.]+$/, ".cue");
      const hasCue = files.some(
        (f) => !f.is_dir && f.path.toLowerCase() === cuePath.toLowerCase()
      );
      if (!hasCue) continue;
    }

    const platformId = guessPlatformFromFilename(file.name);
    const region = guessRegionFromFilename(file.name);

    roms.push({
      romPath: file.path,
      fileName: file.name,
      fileSize: file.size,
      platformId,
      region,
    });
  }

  return roms;
}

// ─── ROM Import ────────────────────────────────────────────────────────

/**
 * Convert scanned ROMs into EmulatorGameEntry objects.
 */
export function createEmulatorGameEntries(
  roms: ScannedRom[],
  options: {
    emulatorConfigId?: string;
    emulatorProfileId?: string;
    defaultPlatform?: string;
    scanPath?: string;
  } = {}
): EmulatorGameEntry[] {
  const now = Date.now();

  return roms.map((rom) => ({
    id: generateEmulatorGameId(),
    title: cleanRomName(rom.fileName),
    platform: rom.platformId ?? options.defaultPlatform ?? "unknown",
    romPath: rom.romPath,
    emulatorConfigId: options.emulatorConfigId,
    emulatorProfileId: options.emulatorProfileId,
    fileSize: rom.fileSize,
    region: rom.region ?? undefined,
    isInstalled: true,
    scanPath: options.scanPath,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Clean ROM filename for display.
 * Removes extension and common patterns.
 */
function cleanRomName(fileName: string): string {
  // Remove extension
  const name = fileName.replace(/\.[^.]+$/, "");

  // Remove common ROM tags
  const cleaned = name
    .replace(/\([^)]*\)/g, "") // (USA), (Rev 2), etc.
    .replace(/\[[^\]]*\]/g, "") // [E], [NTSC-U], etc.
    .replace(/_+/g, " ") // underscores to spaces
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();

  return cleaned || fileName;
}

// ─── Utility ───────────────────────────────────────────────────────────

/**
 * Validate that an emulator config points to a valid installation.
 */
export async function validateEmulatorConfig(
  exePath: string,
  installDir: string
): Promise<{ valid: boolean; error?: string }> {
  const exeExists = await fileExists(exePath);
  if (!exeExists) {
    return { valid: false, error: `Executable not found: ${exePath}` };
  }

  const dirExists = await fileExists(installDir);
  if (!dirExists) {
    return { valid: false, error: `Installation directory not found: ${installDir}` };
  }

  return { valid: true };
}

/**
 * Get all unique extensions supported by a set of emulator definitions.
 */
export function getSupportedExtensions(definitionIds: string[]): string[] {
  const exts = new Set<string>();
  for (const id of definitionIds) {
    const def = getEmulatorById(id);
    if (!def) continue;
    for (const profile of def.profiles) {
      for (const ext of profile.imageExtensions) {
        exts.add(ext.toLowerCase());
      }
    }
  }
  return Array.from(exts);
}
