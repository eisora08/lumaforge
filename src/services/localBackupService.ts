/**
 * Local Backup Foundation — provider-independent export/restore service.
 *
 * Exports LumaForge-owned JSON data into a versioned, checksummed directory.
 * No cloud transport, no Steam directories, no credentials.
 *
 * Section isolation: each section maps to specific localStorage keys.
 * "settings" captures the FULL lumaforge-settings object — secrets/credentials are STRIPPED from export.
 * "uiPreferences" captures ONLY visual/appearance fields — never steamRoot, API keys, or providers.
 * Restore respects section selection, merges field-by-field for uiPreferences,
 * and validates that all secrets/credentials are preserved unchanged after restore.
 */

// ── Appearance field allowlist (safe for Customization backup) ──

/**
 * Keys from AppSettings that are visual/appearance only.
 * These are safe to export under "uiPreferences" without touching critical paths, API keys, or providers.
 */
export const APPEARANCE_SETTINGS_KEYS: string[] = [
  "compactMode",
  "hideCardLabels",
  "cardCornerRadius",
  "libraryCardArtworkMode",
  "libraryCardSize",
  "libraryGridGap",
  "libraryUseFullWidth",
  "libraryFilterPanelWidth",
  "dashboardCardSize",
  "dashboardFeaturedCardSize",
  "dashboardGridGap",
  "dashboardContentWidth",
  "useExpandedDashboard",
  "libraryLandscapeCardSize",
  "libraryLandscapeGap",
  "maxLandscapeColumns",
  "dashboardHeroEnabled",
  "dashboardHeroAutoRotate",
  "dashboardHeroRotateSeconds",
  "dashboardHeroSources",
  "dashboardHeroMaxSources",
  "dashboardSectionVisibility",
  "dashboardSectionLimits",
  "dashboardDeferredRendering",
  "dashboardInitialVisibleSections",
  "mediaCacheProfile",
  "launchMode",
  "startupWindowMode",
];

/**
 * Settings keys that must NEVER be overwritten by a non-"settings" section.
 * Used for post-restore validation to detect cross-section contamination.
 */
export const PROTECTED_SETTINGS_KEYS: string[] = [
  "steamRoot",
  "luaPath",
  "depotcachePath",
  "tempFolder",
  "apiBaseUrl",
  "apiKey",
  "providers",
  "steamGridDbApiKey",
  "steamWebApiKey",
  "steamId64",
  "steamAccountId",
  "rawgApiKey",
  "igdbClientId",
  "igdbClientSecret",
  "googleSearchApiKey",
  "googleSearchCx",
  "bingSearchApiKey",
  "gameScanFolders",
];

// ── Secret field protection ──

/**
 * Credential and API key fields that must NEVER be exported, overwritten, cleared, or reset
 * during any backup or restore operation. Missing/null values in backups must never be
 * interpreted as "delete this secret".
 */
export const SECRET_FIELDS: string[] = [
  "apiKey",
  "steamWebApiKey",
  "steamId64",
  "steamAccountId",
  "steamGridDbApiKey",
  "rawgApiKey",
  "igdbClientId",
  "igdbClientSecret",
  "googleSearchApiKey",
  "googleSearchCx",
  "bingSearchApiKey",
  "providers",
];

/**
 * Remove secret fields from a parsed settings object before writing to a backup file.
 * Returns a shallow copy without SECRET_FIELDS keys. Does not mutate the input.
 */
export function stripSecrets<T extends Record<string, unknown>>(obj: T): T {
  const stripped = { ...obj };
  for (const key of SECRET_FIELDS) {
    delete (stripped as Record<string, unknown>)[key];
  }
  return stripped;
}

/**
 * Snapshot current secret field values from the live lumaforge-settings JSON.
 * Used before restore to later verify secrets were preserved.
 */
export function snapshotSecrets(): Record<string, string | null> {
  const snapshot: Record<string, string | null> = {};
  const raw = localStorage.getItem("lumaforge-settings");
  try {
    const settings = raw ? JSON.parse(raw) : {};
    for (const key of SECRET_FIELDS) {
      const val = settings[key];
      snapshot[key] = val === undefined ? null : JSON.stringify(val);
    }
  } catch {
    for (const key of SECRET_FIELDS) {
      snapshot[key] = null;
    }
  }
  return snapshot;
}

/**
 * Validate that secret fields were not modified after a restore.
 * Compares current live values against the "before" snapshot.
 */
export function validateSecrets(before: Record<string, string | null>): {
  safe: boolean;
  violations: Array<{ key: string; before: string | null; after: string | null }>;
} {
  const violations: Array<{ key: string; before: string | null; after: string | null }> = [];
  const raw = localStorage.getItem("lumaforge-settings");
  let current: Record<string, unknown> = {};
  try {
    current = raw ? JSON.parse(raw) : {};
  } catch {
    for (const key of SECRET_FIELDS) {
      violations.push({ key, before: before[key], after: "(malformed JSON)" });
    }
    return { safe: false, violations };
  }
  for (const key of SECRET_FIELDS) {
    const afterVal = current[key];
    const afterStr = afterVal === undefined ? null : JSON.stringify(afterVal);
    const beforeStr = before[key];
    if (beforeStr !== afterStr) {
      violations.push({ key, before: beforeStr, after: afterStr });
    }
  }
  return { safe: violations.length === 0, violations };
}

// ── Section types ──

export type BackupSection =
  | "settings"
  | "integrations"
  | "favorites"
  | "manualGames"
  | "playtime"
  | "sessionHistory"
  | "providerOverrides"
  | "profile"
  | "steamAchievementInputs"
  | "customArtwork"
  | "steamLua"
  | "uiPreferences";

export const ALL_BACKUP_SECTIONS: BackupSection[] = [
  "settings",
  "integrations",
  "favorites",
  "manualGames",
  "playtime",
  "sessionHistory",
  "providerOverrides",
  "profile",
  "steamAchievementInputs",
  "customArtwork",
  "steamLua",
  "uiPreferences",
];

export const SECTION_DISPLAY_NAMES: Record<BackupSection, string> = {
  settings: "Settings",
  integrations: "Integration Settings",
  favorites: "Favorites",
  manualGames: "Manual Games",
  playtime: "Playtime",
  sessionHistory: "Session History",
  providerOverrides: "Provider Overrides",
  profile: "User Profile",
  steamAchievementInputs: "Achievement Inputs",
  customArtwork: "Custom Artwork",
  steamLua: "Steam Lua Scripts",
  uiPreferences: "UI Preferences",
};

export const SECTION_DESCRIPTIONS: Record<BackupSection, string> = {
  settings: "Full app settings (paths, API keys, all fields) — secrets/credentials stripped from export",
  integrations: "Provider enable/disable and surface visibility",
  favorites: "Favorited games list",
  manualGames: "Manually added game entries and metadata",
  playtime: "Game session durations and totals",
  sessionHistory: "Historical session records",
  providerOverrides: "Epic and provider-specific overrides",
  profile: "User profile (avatar, banner, display name)",
  steamAchievementInputs: "Launcher achievement input configuration (progress and source files not included)",
  customArtwork: "Planned — custom artwork files are not included yet",
  steamLua: "Planned — Steam Lua files are not included until a validated file allowlist and safe restore flow are available",
  uiPreferences: "Theme, surface mode, and visual settings only — safe, never touches paths or keys",
};

export type SectionAuditStatus = "implemented" | "partial" | "placeholder";

export const SECTION_AUDIT_STATUS: Record<BackupSection, SectionAuditStatus> = {
  settings: "implemented",
  integrations: "implemented",
  favorites: "implemented",
  manualGames: "implemented",
  playtime: "implemented",
  sessionHistory: "implemented",
  providerOverrides: "implemented",
  profile: "implemented",
  steamAchievementInputs: "partial",
  customArtwork: "placeholder",
  steamLua: "placeholder",
  uiPreferences: "implemented",
};

export const SECTION_AUDIT_NOTES: Record<BackupSection, string> = {
  settings: "Exports lumaforge-settings (secrets/credentials stripped), lumaforge-theme, and lumaforge-surface-mode. Restore merges non-secret fields and preserves all existing secrets.",
  integrations: "Exports integration settings (provider enables + surface toggles)",
  favorites: "Exports favorited game IDs",
  manualGames: "Exports manually added game entries from manualGameStore",
  playtime: "Exports session durations, totals, and lastPlayedAt",
  sessionHistory: "Exports session history records",
  providerOverrides: "Exports Epic provider overrides",
  profile: "Exports user profile (avatar, banner, display name)",
  steamAchievementInputs: "Partial — exports launcher achievement input configuration only. Achievement progress, unlocked timestamps, summaries, and Steam source files are not included. Restore changes input configuration only.",
  customArtwork: "Planned — reads game-activities, not real artwork files. No usable payload.",
  steamLua: "Planned — exports only a notification hash, not Lua scripts or manifests. No usable payload.",
  uiPreferences: "Exports only visual fields from lumaforge-settings (28 keys) plus lumaforge-theme and lumaforge-surface-mode. Never touches steamRoot, API keys, or providers.",
};

export const SECTION_READY_COUNT = ALL_BACKUP_SECTIONS.filter((s) => SECTION_AUDIT_STATUS[s] === "implemented").length;
export const SECTION_PARTIAL_COUNT = ALL_BACKUP_SECTIONS.filter((s) => SECTION_AUDIT_STATUS[s] === "partial").length;
export const SECTION_PLACEHOLDER_COUNT = ALL_BACKUP_SECTIONS.filter((s) => SECTION_AUDIT_STATUS[s] === "placeholder").length;

export const READY_BACKUP_SECTIONS: BackupSection[] = ALL_BACKUP_SECTIONS.filter(
  (s) => SECTION_AUDIT_STATUS[s] === "implemented"
);

export const PARTIAL_BACKUP_SECTIONS: BackupSection[] = ALL_BACKUP_SECTIONS.filter(
  (s) => SECTION_AUDIT_STATUS[s] === "partial"
);

export const PLACEHOLDER_BACKUP_SECTIONS: BackupSection[] = ALL_BACKUP_SECTIONS.filter(
  (s) => SECTION_AUDIT_STATUS[s] === "placeholder"
);

// ── Manifest & versioning ──

export type BackupManifest = {
  schemaVersion: number;
  backupId: string;
  createdAt: string;
  appVersion: string;
  deviceId: string;
  sections: Record<BackupSection, boolean>;
  files: Array<{
    relativePath: string;
    section: string;
    size: number;
    checksum: string;
  }>;
  totalSize: number;
  totalFiles: number;
  encryption?: {
    version: number;
    algorithm: string;
    keyId: string;
  };
};

export const BACKUP_SCHEMA_VERSION = 2;
export const BACKUP_APP_VERSION = "0.1.0";

/** @deprecated Use READY_BACKUP_SECTIONS */
export const REAL_BACKUP_SECTIONS: BackupSection[] = READY_BACKUP_SECTIONS;

/** @deprecated Use READY_BACKUP_SECTIONS — partial sections should not be included in backups by default. */
export const INCLUDED_BACKUP_SECTIONS: BackupSection[] = READY_BACKUP_SECTIONS;

// ── Presets ──

export type BackupPreset = {
  id: string;
  name: string;
  description: string;
  sections: BackupSection[];
};

export const BACKUP_PRESETS: BackupPreset[] = [
  {
    id: "essentials",
    name: "Essentials",
    description: "Settings, integrations, favorites, profile, manual games, provider overrides",
    sections: ["settings", "integrations", "favorites", "profile", "manualGames", "providerOverrides"],
  },
  {
    id: "game-activity",
    name: "Game Activity",
    description: "Playtime, session history, and favorites",
    sections: ["playtime", "sessionHistory", "favorites"],
  },
  {
    id: "customization",
    name: "Customization",
    description: "User profile, theme, and visual settings — never touches paths or keys",
    sections: ["profile", "uiPreferences"],
  },
  {
    id: "full",
    name: "Full LumaForge Backup",
    description: `${READY_BACKUP_SECTIONS.length} verified sections. Partial sections excluded until they provide complete data.`,
    sections: [...READY_BACKUP_SECTIONS],
  },
  {
    id: "custom",
    name: "Custom",
    description: "Select specific sections to include",
    sections: [],
  },
];

// ── Result types ──

export type BackupExportResult = {
  success: boolean;
  manifest?: BackupManifest;
  filePath?: string;
  error?: string;
  warnings: string[];
  duration: number;
};

export type BackupPreviewResult = {
  valid: boolean;
  manifest: BackupManifest | null;
  conflicts: string[];
  warnings: string[];
  unsupportedSections: string[];
  error?: string;
  isLegacyV1?: boolean;
  writeSet?: BackupWriteSet;
};

export type BackupRestoreResult = {
  success: boolean;
  restoredSections: string[];
  conflicts: string[];
  rollbackAvailable: boolean;
  safetyBackupPath?: string;
  error?: string;
};

/** Describes exactly what keys/fields a restore will write. */
export type BackupWriteSet = Array<{
  storageKey: string;
  label: string;
  action: "merge" | "replace" | "field-merge";
  fieldsChanged?: string[];
  fieldsPreserved?: string[];
}>;

// ── Internal helpers ──

function generateBackupId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `lf-backup-${ts}-${rand}`;
}

function getDeviceId(): string {
  const key = "lumaforge-device-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `device-${Math.random().toString(36).substring(2, 10)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isPathSafe(relativePath: string): boolean {
  if (relativePath.includes("..")) return false;
  if (relativePath.startsWith("/")) return false;
  if (relativePath.startsWith("\\")) return false;
  if (relativePath.includes("\\") && !relativePath.includes("/")) {
    const normalized = relativePath.replace(/\\/g, "/");
    if (normalized.includes("..")) return false;
  }
  return true;
}

function isExecutablePath(path: string): boolean {
  return /\.(exe|dll|bat|cmd|ps1|msi|com|scr|vbs|js|wsf)$/i.test(path);
}

const BLOCKED_PATHS = [
  "loginusers.vdf",
  "config/config.vdf",
  "config/steam_appid.vdf",
  ".steam/steam.token",
  "config/steam.cfg",
];

function isBlockedPath(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return BLOCKED_PATHS.some((bp) => lower === bp.toLowerCase());
}

const DEBUG_BACKUP_RESTORE = false;

function debugLog(...args: unknown[]) {
  if (DEBUG_BACKUP_RESTORE) console.log("[BACKUP][RESTORE]", ...args);
}

// ── Section data collection ──

function collectLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

type SectionCollector = {
  section: BackupSection;
  collect: () => Promise<Array<{ path: string; data: string }>>;
};

const SECTION_COLLECTORS: SectionCollector[] = [
  {
    section: "settings",
    collect: async () => {
      const files: Array<{ path: string; data: string }> = [];
      const settingsData = collectLocalStorage("lumaforge-settings");
      if (settingsData) {
        // Strip secret/credential fields — they must never be exported
        try {
          const parsed = JSON.parse(settingsData) as Record<string, unknown>;
          const safe = stripSecrets(parsed);
          files.push({ path: "lumaforge/settings.json", data: JSON.stringify(safe) });
        } catch {
          files.push({ path: "lumaforge/settings.json", data: settingsData });
        }
      }
      const themeData = collectLocalStorage("lumaforge-theme");
      if (themeData) files.push({ path: "lumaforge/theme.json", data: themeData });
      const surfaceData = collectLocalStorage("lumaforge-surface-mode");
      if (surfaceData) files.push({ path: "lumaforge/surface-mode.json", data: surfaceData });
      return files;
    },
  },
  {
    section: "integrations",
    collect: async () => {
      const data = collectLocalStorage("lumaforge-integration-settings");
      return data ? [{ path: "lumaforge/integrations.json", data }] : [];
    },
  },
  {
    section: "favorites",
    collect: async () => {
      const data = collectLocalStorage("lumaforge-favorites-v1");
      return data ? [{ path: "lumaforge/favorites.json", data }] : [];
    },
  },
  {
    section: "manualGames",
    collect: async () => {
      const data = collectLocalStorage("lumaforge-manual-games-v1");
      return data ? [{ path: "lumaforge/manual-games.json", data }] : [];
    },
  },
  {
    section: "playtime",
    collect: async () => {
      const data = collectLocalStorage("lumaforge-game-play-stats-v1");
      return data ? [{ path: "lumaforge/playtime.json", data }] : [];
    },
  },
  {
    section: "sessionHistory",
    collect: async () => {
      const data = collectLocalStorage("lumaforge-session-history-v1");
      return data ? [{ path: "lumaforge/session-history.json", data }] : [];
    },
  },
  {
    section: "providerOverrides",
    collect: async () => {
      const data = collectLocalStorage("lumaforge-epic-overrides-v1");
      return data ? [{ path: "lumaforge/provider-overrides.json", data }] : [];
    },
  },
  {
    section: "profile",
    collect: async () => {
      const data = collectLocalStorage("lumaforge-user-profile-v1");
      return data ? [{ path: "lumaforge/profile.json", data }] : [];
    },
  },
  {
    section: "customArtwork",
    collect: async () => {
      const data = collectLocalStorage("lumaforge-game-activities");
      return data ? [{ path: "lumaforge/custom-artwork-manifest.json", data }] : [];
    },
  },
  {
    section: "steamLua",
    collect: async () => {
      const data = collectLocalStorage("lumaforge_lua_scan_notified_hash");
      return data ? [{ path: "steam/lua/manifest.json", data: JSON.stringify({ notifiedHash: data }) }] : [];
    },
  },
  {
    section: "steamAchievementInputs",
    collect: async () => {
      const data = collectLocalStorage("lumaforge-launcher-achievements-v1");
      return data ? [{ path: "steam/achievement-inputs/manifest.json", data }] : [];
    },
  },
  {
    section: "uiPreferences",
    collect: async () => {
      const files: Array<{ path: string; data: string }> = [];
      // Extract ONLY appearance fields from lumaforge-settings
      const settingsRaw = collectLocalStorage("lumaforge-settings");
      if (settingsRaw) {
        try {
          const full = JSON.parse(settingsRaw) as Record<string, unknown>;
          const appearanceOnly: Record<string, unknown> = {};
          for (const key of APPEARANCE_SETTINGS_KEYS) {
            if (key in full) appearanceOnly[key] = full[key];
          }
          appearanceOnly._exportedAt = Date.now();
          files.push({ path: "uiPreferences/appearance.json", data: JSON.stringify(appearanceOnly) });
        } catch {
          // skip malformed settings
        }
      }
      const themeData = collectLocalStorage("lumaforge-theme");
      if (themeData) files.push({ path: "uiPreferences/theme.json", data: themeData });
      const surfaceData = collectLocalStorage("lumaforge-surface-mode");
      if (surfaceData) files.push({ path: "uiPreferences/surface-mode.json", data: surfaceData });
      return files;
    },
  },
];

// ── Export ──

export async function estimateBackupSize(sections: BackupSection[]): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;

  for (const collector of SECTION_COLLECTORS) {
    if (!sections.includes(collector.section)) continue;
    const items = await collector.collect();
    for (const item of items) {
      files++;
      bytes += new TextEncoder().encode(item.data).length;
    }
  }

  return { files, bytes };
}

export async function buildBackupManifest(
  sections: BackupSection[],
  fileEntries: Array<{ relativePath: string; section: string; size: number; checksum: string }>,
): Promise<BackupManifest> {
  const totalSize = fileEntries.reduce((sum, f) => sum + f.size, 0);

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    backupId: generateBackupId(),
    createdAt: new Date().toISOString(),
    appVersion: BACKUP_APP_VERSION,
    deviceId: getDeviceId(),
    sections: Object.fromEntries(
      ALL_BACKUP_SECTIONS.map((s) => [s, sections.includes(s)])
    ) as Record<BackupSection, boolean>,
    files: fileEntries,
    totalSize,
    totalFiles: fileEntries.length,
  };
}

export async function collectBackupData(
  sections: BackupSection[],
): Promise<{
  manifest: BackupManifest;
  files: Array<{ relativePath: string; section: string; data: string }>;
}> {
  const allFiles: Array<{ relativePath: string; section: string; data: string }> = [];
  const fileEntries: Array<{ relativePath: string; section: string; size: number; checksum: string }> = [];

  for (const collector of SECTION_COLLECTORS) {
    if (!sections.includes(collector.section)) continue;
    const items = await collector.collect();
    for (const item of items) {
      if (!isPathSafe(item.path)) continue;
      if (isExecutablePath(item.path)) continue;
      if (isBlockedPath(item.path)) continue;

      allFiles.push({ relativePath: item.path, section: collector.section, data: item.data });
      const checksum = await sha256(item.data);
      fileEntries.push({
        relativePath: item.path,
        section: collector.section,
        size: new TextEncoder().encode(item.data).length,
        checksum,
      });
    }
  }

  const manifest = await buildBackupManifest(sections, fileEntries);
  return { manifest, files: allFiles };
}

export function validateManifestIntegrity(manifest: BackupManifest): { valid: boolean; errors: string[]; isLegacyV1: boolean } {
  const errors: string[] = [];
  let isLegacyV1 = false;

  if (!manifest.schemaVersion) errors.push("Missing schema version");
  if (!manifest.backupId) errors.push("Missing backup ID");
  if (!manifest.createdAt) errors.push("Missing creation date");
  if (!manifest.files || !Array.isArray(manifest.files)) errors.push("Missing files array");

  // Accept v1 (legacy) and v2 (current)
  if (manifest.schemaVersion === 1) {
    isLegacyV1 = true;
  } else if (manifest.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    errors.push(`Unsupported schema version: ${manifest.schemaVersion}`);
  }

  for (const file of manifest.files ?? []) {
    if (!isPathSafe(file.relativePath)) {
      errors.push(`Unsafe path: ${file.relativePath}`);
    }
    if (isExecutablePath(file.relativePath)) {
      errors.push(`Executable file: ${file.relativePath}`);
    }
    if (isBlockedPath(file.relativePath)) {
      errors.push(`Blocked path: ${file.relativePath}`);
    }
  }

  return { valid: errors.length === 0, errors, isLegacyV1 };
}

// ── Restore merge functions ──

function mergeSettings(existing: string, backup: string): string {
  try {
    const a = JSON.parse(existing);
    const b = JSON.parse(backup);
    // Snapshot current secrets BEFORE the merge — they must survive unchanged
    const secretsBefore: Record<string, unknown> = {};
    for (const key of SECRET_FIELDS) {
      if (key in a) secretsBefore[key] = a[key];
    }
    // Merge non-secret fields from backup into existing
    const merged = { ...a, ...b, updatedAt: Math.max(a.updatedAt ?? 0, b.updatedAt ?? 0) };
    // Re-apply current secrets — backup values (including empty strings) are discarded
    for (const key of SECRET_FIELDS) {
      if (key in secretsBefore) {
        merged[key] = secretsBefore[key];
      } else {
        // Secret never existed — ensure it's not set by backup
        delete merged[key];
      }
    }
    return JSON.stringify(merged);
  } catch {
    return backup;
  }
}

function mergeFavorites(existing: string, backup: string): string {
  try {
    const a: string[] = JSON.parse(existing);
    const b: string[] = JSON.parse(backup);
    const merged = [...new Set([...a, ...b])];
    return JSON.stringify(merged);
  } catch {
    return backup;
  }
}

function mergeManualGames(existing: string, backup: string): string {
  try {
    const a = JSON.parse(existing);
    const b = JSON.parse(backup);
    const entriesA = a.entries ?? a;
    const entriesB = b.entries ?? b;
    const byId = new Map<string, unknown>();
    for (const e of entriesA) byId.set(e.id, e);
    for (const e of entriesB) {
      const existing = byId.get(e.id) as { updatedAt?: number } | undefined;
      if (!existing || (e.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
        byId.set(e.id, e);
      }
    }
    return JSON.stringify({ version: 1, entries: Array.from(byId.values()) });
  } catch {
    return backup;
  }
}

function mergePlaytime(existing: string, backup: string): string {
  try {
    const a = JSON.parse(existing);
    const b = JSON.parse(backup);
    const merged = { ...a };
    for (const [key, val] of Object.entries(b.games ?? {})) {
      const existEntry = merged.games?.[key];
      if (!existEntry) {
        merged.games = merged.games ?? {};
        merged.games[key] = val;
      }
    }
    return JSON.stringify(merged);
  } catch {
    return backup;
  }
}

function mergeSessionHistory(existing: string, backup: string): string {
  try {
    const a = JSON.parse(existing);
    const b = JSON.parse(backup);
    const byId = new Map<string, unknown>();
    for (const s of a.sessions ?? []) byId.set(s.sessionId ?? s.id, s);
    for (const s of b.sessions ?? []) {
      if (!byId.has(s.sessionId ?? s.id)) {
        byId.set(s.sessionId ?? s.id, s);
      }
    }
    return JSON.stringify({ sessions: Array.from(byId.values()) });
  } catch {
    return backup;
  }
}

function mergeByField(existing: string, backup: string): string {
  try {
    const a = JSON.parse(existing);
    const b = JSON.parse(backup);
    return JSON.stringify({ ...a, ...b, updatedAt: Math.max(a.updatedAt ?? 0, b.updatedAt ?? 0) });
  } catch {
    return backup;
  }
}

/**
 * Field-level merge for uiPreferences: applies ONLY appearance fields from backup to existing settings.
 * Non-appearance fields (steamRoot, API keys, providers, etc.) are NEVER touched.
 */
export function mergeUiPreferences(existingSettings: string, backupAppearance: string): string {
  try {
    const current = JSON.parse(existingSettings) as Record<string, unknown>;
    const backup = JSON.parse(backupAppearance) as Record<string, unknown>;
    const merged = { ...current };
    for (const key of APPEARANCE_SETTINGS_KEYS) {
      if (key in backup) {
        merged[key] = backup[key];
      }
    }
    merged.updatedAt = Math.max((current.updatedAt as number) ?? 0, (backup._exportedAt as number) ?? 0);
    return JSON.stringify(merged);
  } catch {
    return existingSettings;
  }
}

/**
 * Snapshot current localStorage state for rollback on restore failure.
 * Returns an object mapping storage keys to their current values.
 */
export function createSafetySnapshot(keys: string[]): Record<string, string | null> {
  const snapshot: Record<string, string | null> = {};
  for (const key of keys) {
    snapshot[key] = localStorage.getItem(key);
  }
  return snapshot;
}

/**
 * Apply a safety snapshot to rollback localStorage state.
 */
export function rollbackFromSnapshot(snapshot: Record<string, string | null>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  }
}

/**
 * Compute the exact write set for a restore — what keys will be written and how.
 * Used for preview display so users see exactly what will change.
 */
export function computeWriteSet(
  manifest: BackupManifest,
  fileData: Record<string, string>,
  selectedSections: Set<string>,
): BackupWriteSet {
  const writeSet: BackupWriteSet = [];
  const seenKeys = new Set<string>();

  for (const file of manifest.files) {
    if (!selectedSections.has(file.section)) continue;
    const backupData = fileData[file.relativePath];
    if (!backupData) continue;

    const storageKey = resolveStorageKeyForFilePath(file.relativePath, file.section);
    if (!storageKey || seenKeys.has(`${storageKey}:${file.section}`)) continue;
    seenKeys.add(`${storageKey}:${file.section}`);

    if (file.section === "uiPreferences" && file.relativePath === "uiPreferences/appearance.json") {
      // Field-level merge: show which fields change
      try {
        const current = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Record<string, unknown>;
        const backup = JSON.parse(backupData) as Record<string, unknown>;
        const fieldsChanged: string[] = [];
        const fieldsPreserved: string[] = [];
        for (const key of APPEARANCE_SETTINGS_KEYS) {
          if (key in backup) {
            if (JSON.stringify(current[key]) !== JSON.stringify(backup[key])) {
              fieldsChanged.push(key);
            } else {
              fieldsPreserved.push(key);
            }
          }
        }
        writeSet.push({
          storageKey,
          label: "UI Appearance Settings",
          action: "field-merge",
          fieldsChanged,
          fieldsPreserved,
        });
      } catch {
        writeSet.push({ storageKey, label: "UI Appearance Settings", action: "field-merge" });
      }
    } else if (
      (file.section === "settings" && file.relativePath === "lumaforge/settings.json") ||
      (file.section === "uiPreferences" && false)
    ) {
      writeSet.push({ storageKey, label: storageKey, action: "merge" });
    } else if (file.relativePath.includes("theme")) {
      writeSet.push({ storageKey, label: "Theme", action: "replace" });
    } else if (file.relativePath.includes("surface-mode")) {
      writeSet.push({ storageKey, label: "Surface Mode", action: "replace" });
    } else {
      writeSet.push({ storageKey, label: storageKey, action: "replace" });
    }
  }

  return writeSet;
}

// ── File path → storage key resolution ──

const FILE_PATH_TO_STORAGE_KEY: Record<string, string> = {
  "lumaforge/settings.json": "lumaforge-settings",
  "lumaforge/theme.json": "lumaforge-theme",
  "lumaforge/surface-mode.json": "lumaforge-surface-mode",
  "lumaforge/integrations.json": "lumaforge-integration-settings",
  "lumaforge/favorites.json": "lumaforge-favorites-v1",
  "lumaforge/manual-games.json": "lumaforge-manual-games-v1",
  "lumaforge/playtime.json": "lumaforge-game-play-stats-v1",
  "lumaforge/session-history.json": "lumaforge-session-history-v1",
  "lumaforge/provider-overrides.json": "lumaforge-epic-overrides-v1",
  "lumaforge/profile.json": "lumaforge-user-profile-v1",
  "lumaforge/custom-artwork-manifest.json": "lumaforge-game-activities",
  "steam/lua/manifest.json": "lumaforge_lua_scan_notified_hash",
  "steam/achievement-inputs/manifest.json": "lumaforge-launcher-achievements-v1",
  "uiPreferences/appearance.json": "lumaforge-settings",
  "uiPreferences/theme.json": "lumaforge-theme",
  "uiPreferences/surface-mode.json": "lumaforge-surface-mode",
};

/**
 * Resolve the correct localStorage key for a file path + section combination.
 * This is the single source of truth for where backup files land on restore.
 */
export function resolveStorageKeyForFilePath(relativePath: string, section: string): string | null {
  // Direct lookup for known paths
  const key = FILE_PATH_TO_STORAGE_KEY[relativePath];
  if (key) return key;

  // Fallback: use section-based lookup for unknown paths
  return getLocalStorageKeyForSection(section) || null;
}

/**
 * Restore a single backup file to the correct localStorage key with appropriate merge strategy.
 * This replaces the old section-based restore that wrote all files to the same key.
 */
export function restoreFileToStorage(
  relativePath: string,
  section: string,
  backupData: string,
): void {
  const storageKey = resolveStorageKeyForFilePath(relativePath, section);
  if (!storageKey) {
    debugLog("no storage key for", relativePath, section);
    return;
  }

  if (section === "uiPreferences" && relativePath === "uiPreferences/appearance.json") {
    // Field-level merge: read current settings, apply only appearance fields
    const current = localStorage.getItem(storageKey);
    if (current) {
      const merged = mergeUiPreferences(current, backupData);
      localStorage.setItem(storageKey, merged);
      debugLog("field-merged appearance into", storageKey);
    } else {
      // No existing settings — create minimal object from appearance fields only
      try {
        const appearance = JSON.parse(backupData) as Record<string, unknown>;
        const minimal: Record<string, unknown> = {};
        for (const key of APPEARANCE_SETTINGS_KEYS) {
          if (key in appearance) minimal[key] = appearance[key];
        }
        localStorage.setItem(storageKey, JSON.stringify(minimal));
        debugLog("created minimal settings from appearance", storageKey);
      } catch {
        // skip malformed
      }
    }
  } else if (
    relativePath.includes("theme.json") ||
    relativePath.includes("surface-mode.json")
  ) {
    // Theme and surface-mode: direct replace to their own keys
    localStorage.setItem(storageKey, backupData);
    debugLog("direct-wrote", storageKey, "from", relativePath);
  } else {
    // All other files: merge via section policy
    const existing = localStorage.getItem(storageKey);
    if (existing) {
      const merged = mergeSectionData(section, existing, backupData);
      localStorage.setItem(storageKey, merged);
      debugLog("merged-section", section, "into", storageKey);
    } else {
      // No existing data — strip secrets from backup before writing
      if (section === "settings" && relativePath === "lumaforge/settings.json") {
        try {
          const parsed = JSON.parse(backupData) as Record<string, unknown>;
          const safe = stripSecrets(parsed);
          localStorage.setItem(storageKey, JSON.stringify(safe));
          debugLog("wrote settings (secrets stripped, no existing)", storageKey);
        } catch {
          localStorage.setItem(storageKey, backupData);
          debugLog("wrote settings (unparseable, no secrets strip)", storageKey);
        }
      } else {
        localStorage.setItem(storageKey, backupData);
        debugLog("fresh-write", storageKey, "from", relativePath);
      }
    }
  }
}

// ── Legacy v1 detection ──

/**
 * Detect if a backup manifest is a v1 Legacy where the Customization preset
 * produced a full "settings" section (containing steamRoot, API keys, etc.)
 * that should have been "uiPreferences" (visual fields only).
 */
export function isLegacyV1WithFullSettings(manifest: BackupManifest): boolean {
  if (manifest.schemaVersion !== 1) return false;
  // v1 had no "uiPreferences" section — if "settings" is enabled, it captured everything
  return manifest.sections?.settings === true && !("uiPreferences" in manifest.sections);
}

// ── Restore merge policies ──

export const SECTION_MERGE_POLICIES: Record<string, "merge" | "replace" | "union" | "dedup" | "custom" | "field-merge"> = {
  settings: "merge",
  integrations: "merge",
  favorites: "union",
  manualGames: "custom",
  playtime: "custom",
  sessionHistory: "custom",
  providerOverrides: "merge",
  profile: "merge",
  customArtwork: "merge",
  steamLua: "replace",
  steamAchievementInputs: "replace",
  uiPreferences: "field-merge",
};

export function mergeSectionData(
  section: string,
  existingData: string | null,
  backupData: string,
): string {
  if (!existingData) return backupData;

  switch (section) {
    case "settings":
      return mergeSettings(existingData, backupData);
    case "favorites":
      return mergeFavorites(existingData, backupData);
    case "manualGames":
      return mergeManualGames(existingData, backupData);
    case "playtime":
      return mergePlaytime(existingData, backupData);
    case "sessionHistory":
      return mergeSessionHistory(existingData, backupData);
    case "providerOverrides":
    case "profile":
    case "customArtwork":
      return mergeByField(existingData, backupData);
    case "uiPreferences":
      // Should only be called for non-appearance files; appearance uses mergeUiPreferences
      return mergeByField(existingData, backupData);
    default:
      return backupData;
  }
}

// ── Section → localStorage key mappings ──

export function getLocalStorageKeyForSection(section: string): string {
  const keyMap: Record<string, string> = {
    settings: "lumaforge-settings",
    integrations: "lumaforge-integration-settings",
    favorites: "lumaforge-favorites-v1",
    manualGames: "lumaforge-manual-games-v1",
    playtime: "lumaforge-game-play-stats-v1",
    sessionHistory: "lumaforge-session-history-v1",
    providerOverrides: "lumaforge-epic-overrides-v1",
    profile: "lumaforge-user-profile-v1",
    customArtwork: "lumaforge-game-activities",
    steamLua: "lumaforge_lua_scan_notified_hash",
    steamAchievementInputs: "lumaforge-launcher-achievements-v1",
    uiPreferences: "lumaforge-settings",
  };
  return keyMap[section] ?? "";
}

/**
 * Returns all localStorage keys that belong to a backup section.
 * "settings" → [lumaforge-settings, lumaforge-theme, lumaforge-surface-mode]
 * "uiPreferences" → [lumaforge-settings, lumaforge-theme, lumaforge-surface-mode]
 */
export function getAllLocalStorageKeysForSection(section: string): string[] {
  if (section === "settings" || section === "uiPreferences") {
    return ["lumaforge-settings", "lumaforge-theme", "lumaforge-surface-mode"];
  }
  const key = getLocalStorageKeyForSection(section);
  return key ? [key] : [];
}

/**
 * @deprecated Use restoreFileToStorage for file-path-aware restore.
 * This function is kept for backward compatibility but should not be used for new restore flows.
 */
export function restoreSectionToLocalStorage(section: string, data: string): void {
  const key = getLocalStorageKeyForSection(section);
  if (key) {
    localStorage.setItem(key, data);
  }
}

// ── Protected field validation ──

export type ProtectedFieldValidation = {
  safe: boolean;
  violations: Array<{ key: string; before: string | null; after: string | null }>;
};

/**
 * Validate that protected settings fields were not modified by a restore.
 * Reads the "lumaforge-settings" JSON and checks each protected field within it.
 * Call BEFORE restore to capture "before" state, and AFTER to compare.
 */
export function validateProtectedFields(
  before: Record<string, string | null>,
): ProtectedFieldValidation {
  const violations: Array<{ key: string; before: string | null; after: string | null }> = [];
  // Read the current full settings JSON
  const settingsRaw = localStorage.getItem("lumaforge-settings");
  let current: Record<string, unknown> = {};
  try {
    current = settingsRaw ? JSON.parse(settingsRaw) : {};
  } catch {
    // malformed — treat all fields as changed
    for (const key of PROTECTED_SETTINGS_KEYS) {
      violations.push({ key, before: before[key], after: "(malformed JSON)" });
    }
    return { safe: false, violations };
  }
  for (const key of PROTECTED_SETTINGS_KEYS) {
    const afterVal = current[key];
    const afterStr = afterVal === undefined ? null : JSON.stringify(afterVal);
    const beforeStr = before[key];
    if (beforeStr !== afterStr) {
      violations.push({ key, before: beforeStr, after: afterStr });
    }
  }
  return { safe: violations.length === 0, violations };
}

/**
 * Capture the current state of all protected settings fields.
 * Reads from the "lumaforge-settings" JSON blob, not top-level localStorage keys.
 */
export function snapshotProtectedFields(): Record<string, string | null> {
  const snapshot: Record<string, string | null> = {};
  const settingsRaw = localStorage.getItem("lumaforge-settings");
  try {
    const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
    for (const key of PROTECTED_SETTINGS_KEYS) {
      const val = settings[key];
      snapshot[key] = val === undefined ? null : JSON.stringify(val);
    }
  } catch {
    // If settings is malformed, snapshot the raw string
    for (const key of PROTECTED_SETTINGS_KEYS) {
      snapshot[key] = null;
    }
  }
  return snapshot;
}

// ── Transactional restore ──

/**
 * Perform a safe, section-filtered restore with:
 * 1. Safety snapshot before any writes
 * 2. Section filtering (only restore files from selected sections)
 * 3. File-path-aware storage key resolution
 * 4. Protected field validation after writes
 * 5. Secret field validation after writes (credentials/API keys preserved exactly)
 * 6. Rollback on any validation failure
 */
export function restoreSectionsSafe(
  manifest: BackupManifest,
  fileData: Record<string, string>,
  selectedSections: Set<string>,
): BackupRestoreResult {
  const restoredSections: string[] = [];
  const conflicts: string[] = [];

  // 1. Collect all keys that will be touched
  const allKeys = new Set<string>();
  for (const file of manifest.files) {
    if (!selectedSections.has(file.section)) continue;
    const key = resolveStorageKeyForFilePath(file.relativePath, file.section);
    if (key) allKeys.add(key);
  }

  // 2. Safety snapshot before any writes
  const snapshot = createSafetySnapshot(Array.from(allKeys));
  debugLog("safety snapshot", { keys: Object.keys(snapshot).length });

  // 3. Capture protected fields AND secrets before restore
  const protectedBefore = snapshotProtectedFields();
  const secretsBefore = snapshotSecrets();

  // 4. Apply each file via file-path-aware resolver
  try {
    for (const file of manifest.files) {
      if (!selectedSections.has(file.section)) continue;
      const backupData = fileData[file.relativePath];
      if (!backupData) continue;

      restoreFileToStorage(file.relativePath, file.section, backupData);

      if (!restoredSections.includes(file.section)) {
        restoredSections.push(file.section);
      }
    }

    // 5. Validate protected fields after restore (cross-section contamination only)
    // When "settings" section is explicitly selected, its own merge may change non-secret
    // protected fields (steamRoot, luaPath, etc.) — that's the user's intent. Only check
    // for contamination when a NON-settings section wrote to settings keys.
    const settingsSectionSelected = selectedSections.has("settings");
    if (!settingsSectionSelected) {
      const validation = validateProtectedFields(protectedBefore);
      if (!validation.safe) {
        debugLog("PROTECTED FIELD VIOLATION — rolling back", validation.violations);
        rollbackFromSnapshot(snapshot);
        return {
          success: false,
          restoredSections: [],
          conflicts: validation.violations.map((v) => `Protected field "${v.key}" would be overwritten`),
          rollbackAvailable: true,
          error: `Restore rolled back: ${validation.violations.length} protected field(s) would be overwritten`,
        };
      }
    }

    // 6. Validate secrets (credentials/API keys) after restore
    const secretValidation = validateSecrets(secretsBefore);
    if (!secretValidation.safe) {
      debugLog("SECRET FIELD VIOLATION — rolling back", secretValidation.violations);
      rollbackFromSnapshot(snapshot);
      return {
        success: false,
        restoredSections: [],
        conflicts: secretValidation.violations.map((v) => `Secret field "${v.key}" would be overwritten`),
        rollbackAvailable: true,
        error: `Restore rolled back: ${secretValidation.violations.length} secret/credential field(s) would be overwritten`,
      };
    }

    debugLog("restore complete", { sections: restoredSections });
    return {
      success: true,
      restoredSections,
      conflicts,
      rollbackAvailable: true,
    };
  } catch (err) {
    // Rollback on any error
    debugLog("restore error — rolling back", err);
    rollbackFromSnapshot(snapshot);
    return {
      success: false,
      restoredSections: [],
      conflicts,
      rollbackAvailable: true,
      error: `Restore failed and was rolled back: ${err}`,
    };
  }
}

// ── Restore progress stages ──

export type RestoreProgressStage =
  | "creating-safety-backup"
  | "validating-backup"
  | "preparing-sections"
  | "applying-changes"
  | "refreshing-runtime"
  | "validating-state"
  | "complete"
  | "failed";

export const RESTORE_PROGRESS_STAGES: { stage: RestoreProgressStage; label: string }[] = [
  { stage: "creating-safety-backup", label: "Creating safety backup" },
  { stage: "validating-backup", label: "Validating backup" },
  { stage: "preparing-sections", label: "Preparing selected sections" },
  { stage: "applying-changes", label: "Applying changes" },
  { stage: "refreshing-runtime", label: "Refreshing LumaForge" },
  { stage: "validating-state", label: "Validating restored state" },
  { stage: "complete", label: "Complete" },
];

// ── Restart detection ──

/**
 * Settings fields that may require an app restart to take effect.
 * These are typically path configurations or launch options set once at startup.
 */
export const RESTART_REQUIRED_SETTINGS: Set<string> = new Set([
  "steamRoot",
  "luaPath",
  "depotcachePath",
  "tempFolder",
  "apiBaseUrl",
  "gameScanFolders",
]);

/**
 * Detect if any restored field requires a restart.
 * Reads the backup manifest files + write-set to check if restart-requiring
 * fields were actually changed.
 */
export function detectRestartRequired(
  manifest: BackupManifest,
  fileData: Record<string, string>,
  sectionsToRestore: Set<string>,
): boolean {
  if (!sectionsToRestore.has("settings")) return false;

  const settingsFile = manifest.files.find((f) => f.section === "settings" && f.relativePath.includes("settings"));
  if (!settingsFile) return false;

  const backupData = fileData[settingsFile.relativePath];
  if (!backupData) return false;

  try {
    const backupSettings = JSON.parse(backupData) as Record<string, unknown>;
    const raw = localStorage.getItem("lumaforge-settings");
    const currentSettings = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

    for (const field of RESTART_REQUIRED_SETTINGS) {
      const backupVal = backupSettings[field];
      const currentVal = currentSettings[field];
      if (JSON.stringify(backupVal) !== JSON.stringify(currentVal)) {
        return true;
      }
    }
  } catch {
    // If we can't parse, assume restart needed for safety
    return true;
  }

  return false;
}

// ── Runtime refresh dispatch ──

const RESTORE_REFRESH_EVENT = "lumaforge-data-changed";

export type RestoreRefreshDetail = {
  key: string;
  source: "restore";
};

/**
 * Dispatch a custom event notifying a specific storage key was restored.
 * Each runtime store listens for this event to re-read from localStorage.
 */
export function dispatchRestoreRefresh(storageKey: string): void {
  window.dispatchEvent(
    new CustomEvent(RESTORE_REFRESH_EVENT, {
      detail: { key: storageKey, source: "restore" } as RestoreRefreshDetail,
    }),
  );
}

/**
 * Map BackupSection → localStorage keys that need refresh notification.
 */
export const SECTION_STORAGE_KEYS: Record<string, string[]> = {
  settings: ["lumaforge-settings"],
  uiPreferences: ["lumaforge-theme", "lumaforge-surface-mode", "lumaforge-settings"],
  favorites: ["lumaforge-favorites-v1"],
  manualGames: ["lumaforge-manual-games-v1", "lumaforge-manual-games-json-migrated-v1"],
  playtime: ["lumaforge-playtime-v1"],
  sessionHistory: ["lumaforge-session-history-v1"],
  integrations: ["lumaforge-integration-settings"],
  profile: ["lumaforge-user-profile-v1"],
  providerOverrides: ["lumaforge-epic-overrides-v1"],
};

/**
 * Dispatch refresh events for all storage keys affected by restored sections.
 */
export function dispatchRestoreRefreshForSections(sections: string[]): void {
  const seen = new Set<string>();
  for (const section of sections) {
    const keys = SECTION_STORAGE_KEYS[section] ?? [];
    for (const key of keys) {
      if (!seen.has(key)) {
        seen.add(key);
        dispatchRestoreRefresh(key);
      }
    }
  }
}
