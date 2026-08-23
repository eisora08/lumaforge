/**
 * Crack Achievement Reader
 *
 * Reads achievement data from crack-specific save directories:
 * - GSE/RUNE/CODEX: achievements.json
 * - OnlineFix: achievements.ini
 * - Goldberg: stats.bin
 *
 * Based on reference: Achievements-1.2.2/utils/achievement-data.js
 */

import type { GameAchievement } from "../types/gameAchievements";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrackAchievementData {
  achievements: GameAchievement[];
  total: number;
  unlocked: number;
  source: string;
}

export interface CrackAchievement extends GameAchievement {
  progress?: number;
  maxProgress?: number;
}

// ---------------------------------------------------------------------------
// Main reader
// ---------------------------------------------------------------------------

export async function readCrackAchievements(
  savePath: string,
  appId: string,
): Promise<CrackAchievementData | null> {
  // Try each format in order of prevalence

  // 1. achievements.json (GSE/RUNE/CODEX — most common)
  const jsonData = await readAchievementsJson(savePath, appId);
  if (jsonData) return jsonData;

  // 2. Tenoke user_stats.ini — Rust parser (UTF-8, custom INI format)
  const tenokeStats = await readTenokeUserStats(savePath, appId);
  if (tenokeStats) return tenokeStats;

  // 3. OnlineFix Stats/achievements.ini — Rust parser (UTF-16 aware)
  const ofxStats = await readOnlinefixStatsIni(savePath, appId);
  if (ofxStats) return ofxStats;

  // 4. achievements.ini (classic — CODEX/OnlineFix at root level)
  const iniData = await readAchievementsIni(savePath, appId);
  if (iniData) return iniData;

  // 5. tenoke.ini (Tenoke — legacy, next to steam_api64.dll)
  const tenokeData = await readTenokeIni(savePath, appId);
  if (tenokeData) return tenokeData;

  // 6. stats.bin (Goldberg)
  const binData = await readStatsBin(savePath, appId);
  if (binData) return binData;

  return null;
}

// ---------------------------------------------------------------------------
// achievements.json reader (GSE/RUNE/CODEX)
// ---------------------------------------------------------------------------

async function readAchievementsJson(
  savePath: string,
  appId: string,
): Promise<CrackAchievementData | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const jsonPath = `${savePath}\\achievements.json`;

    try {
      const content = await invoke<string>("read_text_file", { path: jsonPath });
      return parseAchievementsJson(content, appId, "gse-json");
    } catch {
      // Try subdirectory: savePath/<appId>/achievements.json
      const subPath = `${savePath}\\${appId}\\achievements.json`;
      try {
        const content = await invoke<string>("read_text_file", { path: subPath });
        return parseAchievementsJson(content, appId, "gse-json");
      } catch {
        return null;
      }
    }
  } catch (err) {
    console.warn(`[ACH][CRACK] Failed to invoke read_text_file for ${appId}:`, err);
    return null;
  }
}

function parseAchievementsJson(
  content: string,
  appId: string,
  source: string,
): CrackAchievementData | null {
  try {
    // GSE/RUNE format: { "api_name": { "earned": true/false, "earned_time": 123, ... } }
    // Or: { "Achieved": 1, "Time": 123, "Name": "..." } per section
    const data = JSON.parse(content);

    const achievements: GameAchievement[] = [];
    let unlocked = 0;

    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      // Flat object format: { "ACH_NAME": { earned: true, ... } }
      for (const [apiName, entry] of Object.entries(data)) {
        if (typeof entry !== "object" || entry === null) continue;
        const e = entry as Record<string, unknown>;
        const earned = e.earned === true || e.achieved === true || e.Achieved === 1;
        const earnedTime = typeof e.earned_time === "number" ? e.earned_time
          : typeof e.Time === "number" ? e.Time
          : typeof e.unlock_time === "number" ? e.unlock_time
          : undefined;

        achievements.push({
          id: apiName,
          apiName,
          name: (e.name as string) || (e.Name as string) || apiName,
          description: (e.description as string) || undefined,
          unlocked: !!earned,
          unlockTime: earnedTime && earnedTime > 0
            ? (earnedTime < 1000000000000 ? earnedTime * 1000 : earnedTime)
            : undefined,
        });
        if (earned) unlocked++;
      }
    } else if (Array.isArray(data)) {
      // Array format: [{ api_name: "...", earned: true, ... }]
      for (const entry of data) {
        if (typeof entry !== "object" || entry === null) continue;
        const e = entry as Record<string, unknown>;
        const apiName = (e.api_name as string) || (e.name as string) || (e.Name as string) || "";
        if (!apiName) continue;
        const earned = e.earned === true || e.achieved === true || e.Achieved === 1;
        const earnedTime = typeof e.earned_time === "number" ? e.earned_time
          : typeof e.Time === "number" ? e.Time
          : typeof e.unlock_time === "number" ? e.unlock_time
          : undefined;

        achievements.push({
          id: apiName,
          apiName,
          name: (e.name as string) || (e.Name as string) || apiName,
          description: (e.description as string) || undefined,
          unlocked: !!earned,
          unlockTime: earnedTime && earnedTime > 0
            ? (earnedTime < 1000000000000 ? earnedTime * 1000 : earnedTime)
            : undefined,
        });
        if (earned) unlocked++;
      }
    }

    if (achievements.length === 0) return null;

    console.log(`[ACH][CRACK] Parsed achievements.json for ${appId}: ${unlocked}/${achievements.length} source=${source}`);
    return {
      achievements,
      total: achievements.length,
      unlocked,
      source,
    };
  } catch (err) {
    console.warn(`[ACH][CRACK] Failed to parse achievements.json for ${appId}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// achievements.ini reader (OnlineFix)
// ---------------------------------------------------------------------------

async function readAchievementsIni(
  savePath: string,
  appId: string,
): Promise<CrackAchievementData | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const iniPath = `${savePath}\\achievements.ini`;

    try {
      const content = await invoke<string>("read_text_file", { path: iniPath });
      return parseAchievementsIni(content, appId);
    } catch {
      return null;
    }
  } catch (err) {
    console.warn(`[ACH][CRACK] Failed to invoke read_text_file for ini ${appId}:`, err);
    return null;
  }
}

function parseAchievementsIni(
  content: string,
  appId: string,
): CrackAchievementData | null {
  try {
    const achievements: CrackAchievement[] = [];
    let unlocked = 0;
    let currentSection = "";

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#")) continue;

      // Section header: [ACHIEVEMENT_NAME]
      const sectionMatch = trimmed.match(/^\[(.+)\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        continue;
      }

      // Key=value pair
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.substring(0, eqIdx).trim().toLowerCase();
      const value = trimmed.substring(eqIdx + 1).trim();

      if (key === "achieved" || key === "unlocked") {
        const earned = value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
        if (currentSection && !achievements.find(a => a.apiName === currentSection)) {
          achievements.push({
            id: currentSection,
            apiName: currentSection,
            name: currentSection,
            unlocked: earned,
          });
          if (earned) unlocked++;
        }
      }

      // Parse CurProgress / MaxProgress for progress tracking
      if (currentSection) {
        const ach = achievements.find(a => a.apiName === currentSection);
        if (ach) {
          if (key === "curprogress" || key === "progress") {
            const num = Number(value);
            if (Number.isFinite(num)) (ach as CrackAchievement).progress = num;
          } else if (key === "maxprogress" || key === "max_progress" || key === "max") {
            const num = Number(value);
            if (Number.isFinite(num)) (ach as CrackAchievement).maxProgress = num;
          } else if (key === "unlocktime" || key === "unlock_time" || key === "time") {
            const num = Number(value);
            if (Number.isFinite(num) && num > 0) {
              ach.unlockTime = num < 10_000_000_000 ? num * 1000 : num;
            }
          }
        }
      }
    }

    if (achievements.length === 0) return null;

    console.log(`[ACH][CRACK] Parsed achievements.ini for ${appId}: ${unlocked}/${achievements.length}`);
    return {
      achievements,
      total: achievements.length,
      unlocked,
      source: "ini",
    };
  } catch (err) {
    console.warn(`[ACH][CRACK] Failed to parse achievements.ini for ${appId}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// tenoke.ini reader (Tenoke — same INI format as OnlineFix, different filename)
// tenoke.ini lives next to steam_api64.dll in the game's install directory
// ---------------------------------------------------------------------------

async function readTenokeIni(
  savePath: string,
  appId: string,
): Promise<CrackAchievementData | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const iniPath = `${savePath}\\tenoke.ini`;

    try {
      const content = await invoke<string>("read_text_file", { path: iniPath });
      const result = parseAchievementsIni(content, appId);
      if (result) {
        result.source = "tenoke-ini";
        console.log(`[ACH][CRACK] Parsed tenoke.ini for ${appId}: ${result.unlocked}/${result.total}`);
      }
      return result;
    } catch {
      return null;
    }
  } catch (err) {
    console.warn(`[ACH][CRACK] Failed to invoke read_text_file for tenoke.ini ${appId}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tenoke user_stats.ini reader — uses Rust parser
// ---------------------------------------------------------------------------

async function readTenokeUserStats(
  savePath: string,
  appId: string,
): Promise<CrackAchievementData | null> {
  try {
    const { parseTenokeUserStats } = await import("./tauri");

    // Try direct: savePath/user_stats.ini
    const directPath = `${savePath}\\user_stats.ini`;
    let result = await parseTenokeUserStats(directPath);
    if (result) return convertRustResult(result, "tenoke-user-stats", appId);

    // Try nested: savePath/SteamData/user_stats.ini
    const nestedPath = `${savePath}\\SteamData\\user_stats.ini`;
    result = await parseTenokeUserStats(nestedPath);
    if (result) return convertRustResult(result, "tenoke-user-stats", appId);

    return null;
  } catch (err) {
    console.warn(`[ACH][CRACK] Failed to parse tenoke user_stats.ini for ${appId}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// OnlineFix Stats/achievements.ini reader — uses Rust parser (UTF-16 aware)
// ---------------------------------------------------------------------------

async function readOnlinefixStatsIni(
  savePath: string,
  appId: string,
): Promise<CrackAchievementData | null> {
  try {
    const { parseOnlinefixAchievementsIni } = await import("./tauri");

    // Try: savePath/Stats/achievements.ini
    const statsPath = `${savePath}\\Stats\\achievements.ini`;
    const result = await parseOnlinefixAchievementsIni(statsPath);
    if (result) return convertRustResult(result, "onlinefix-stats-ini", appId);

    return null;
  } catch (err) {
    console.warn(`[ACH][CRACK] Failed to parse OnlineFix achievements.ini for ${appId}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Convert Rust CrackAchievementsResult to CrackAchievementData
// ---------------------------------------------------------------------------

function convertRustResult(
  result: { entries: Array<{ api_name: string; earned: boolean; earned_time: number; progress?: number; max_progress?: number }>; format: string; file_path: string },
  source: string,
  appId: string,
): CrackAchievementData | null {
  if (!result.entries || result.entries.length === 0) return null;

  const achievements: CrackAchievement[] = [];
  let unlocked = 0;

  for (const entry of result.entries) {
    achievements.push({
      id: entry.api_name,
      apiName: entry.api_name,
      name: entry.api_name,
      unlocked: entry.earned,
      unlockTime: entry.earned_time > 0 ? entry.earned_time : undefined,
      progress: entry.progress,
      maxProgress: entry.max_progress,
    });
    if (entry.earned) unlocked++;
  }

  console.log(`[ACH][CRACK] Parsed ${result.format} for ${appId}: ${unlocked}/${achievements.length} source=${source} file=${result.file_path}`);
  return {
    achievements,
    total: achievements.length,
    unlocked,
    source,
  };
}

// ---------------------------------------------------------------------------
// stats.bin reader (Goldberg) — requires Tauri command for binary read
// ---------------------------------------------------------------------------

async function readStatsBin(
  _savePath: string,
  _appId: string,
): Promise<CrackAchievementData | null> {
  // Goldberg stats.bin requires binary file reading via Tauri command
  // Not implemented yet — JSON and INI cover the majority of cracked games
  return null;
}
