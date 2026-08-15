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

  // 2. achievements.ini (OnlineFix)
  const iniData = await readAchievementsIni(savePath, appId);
  if (iniData) return iniData;

  // 3. stats.bin (Goldberg)
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
