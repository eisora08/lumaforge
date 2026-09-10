/**
 * Emulator Configuration Store
 *
 * Manages user-configured emulator installations and their profiles.
 * Persists to localStorage.
 */

import type { EmulatorConfig, EmulatorProfileConfig } from "../data/emulatorDefinitions/types";
import { getEmulatorById } from "../data/emulatorDefinitions";

// ─── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = "lumaforge-emulator-configs-v2";
const STORAGE_VERSION = 2;

// ─── Types ─────────────────────────────────────────────────────────────

type EmulatorConfigStore = {
  version: number;
  configs: EmulatorConfig[];
};

// ─── Module-level cache ────────────────────────────────────────────────

let _cache: EmulatorConfig[] | null = null;

// ─── Listeners ─────────────────────────────────────────────────────────

type Listener = () => void;
const _listeners = new Set<Listener>();

function notifyListeners(): void {
  _listeners.forEach((fn) => fn());
}

// ─── LocalStorage helpers ──────────────────────────────────────────────

function loadFromStorage(): EmulatorConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as EmulatorConfigStore;
      if (Array.isArray(parsed.configs)) return parsed.configs;
    }
    // Try migrating from v1
    const rawV1 = localStorage.getItem("lumaforge-emulator-configs-v1");
    if (rawV1) {
      const parsed = JSON.parse(rawV1) as { configs?: EmulatorConfig[] };
      if (Array.isArray(parsed.configs)) return parsed.configs;
    }
  } catch {
    // corrupt storage
  }
  return [];
}

function saveToStorage(configs: EmulatorConfig[]): void {
  try {
    const store: EmulatorConfigStore = { version: STORAGE_VERSION, configs };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage full
  }
}

// ─── Profile Helpers ───────────────────────────────────────────────────

/**
 * Create a new custom profile with defaults.
 */
export function createCustomProfile(name: string): EmulatorProfileConfig {
  return {
    id: `#custom_${crypto.randomUUID()}`,
    name,
    type: "custom",
    supportedPlatforms: [],
    supportedFileTypes: [],
    trackingMode: "default",
  };
}

/**
 * Create a built-in profile from a definition profile.
 */
export function createBuiltinProfile(
  profileName: string,
  builtinProfileName: string,
  platforms: string[] = [],
  fileTypes: string[] = [],
): EmulatorProfileConfig {
  return {
    id: `#builtin_${crypto.randomUUID()}`,
    name: profileName,
    type: "builtin",
    builtinProfileName,
    overrideDefaultArgs: false,
    supportedPlatforms: platforms,
    supportedFileTypes: fileTypes,
    trackingMode: "default",
  };
}

/**
 * Deep-clone a profile with a new ID.
 */
export function cloneProfile(profile: EmulatorProfileConfig, suffix: string = " Copy"): EmulatorProfileConfig {
  const prefix = profile.type === "builtin" ? "#builtin_" : "#custom_";
  return {
    ...profile,
    id: `${prefix}${crypto.randomUUID()}`,
    name: `${profile.name}${suffix}`,
    supportedPlatforms: [...profile.supportedPlatforms],
    supportedFileTypes: [...profile.supportedFileTypes],
  };
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Get all emulator configurations.
 */
export function getAllEmulatorConfigs(): EmulatorConfig[] {
  if (_cache !== null) return _cache;
  _cache = loadFromStorage();
  return _cache;
}

/**
 * Get a single emulator config by ID.
 */
export function getEmulatorConfig(id: string): EmulatorConfig | undefined {
  return getAllEmulatorConfigs().find((c) => c.id === id);
}

/**
 * Create a new emulator config with defaults.
 */
export function createEmulatorConfig(
  definitionId: string,
  name: string,
  installDir: string
): EmulatorConfig {
  const def = getEmulatorById(definitionId);
  const profiles = def?.profiles.map((p) =>
    createBuiltinProfile(p.name, p.name, p.platforms, p.imageExtensions)
  ) ?? [];
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    definitionId,
    name,
    installDir,
    profiles,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Save an emulator configuration.
 */
export function saveEmulatorConfig(config: EmulatorConfig): void {
  const configs = getAllEmulatorConfigs();
  const existing = configs.findIndex((c) => c.id === config.id);

  let newConfigs: EmulatorConfig[];
  if (existing >= 0) {
    newConfigs = configs.map((c, i) => i === existing ? { ...config, updatedAt: Date.now() } : c);
  } else {
    newConfigs = [...configs, config];
  }

  _cache = newConfigs;
  saveToStorage(newConfigs);
  notifyListeners();
}

/**
 * Update an existing emulator config.
 */
export function updateEmulatorConfig(
  id: string,
  updates: Partial<Omit<EmulatorConfig, "id" | "createdAt">>
): void {
  const configs = getAllEmulatorConfigs();
  const existing = configs.findIndex((c) => c.id === id);
  if (existing < 0) return;

  const newConfigs = configs.map((c, i) =>
    i === existing ? { ...c, ...updates, updatedAt: Date.now() } : c
  );
  _cache = newConfigs;
  saveToStorage(newConfigs);
  notifyListeners();
}

/**
 * Delete an emulator configuration.
 */
export function deleteEmulatorConfig(id: string): void {
  const configs = getAllEmulatorConfigs();
  const filtered = configs.filter((c) => c.id !== id);

  if (filtered.length === configs.length) return;

  _cache = filtered;
  saveToStorage(filtered);
  notifyListeners();
}

/**
 * Deep-clone an emulator config with new IDs.
 */
export function copyEmulatorConfig(config: EmulatorConfig, suffix: string = " Copy"): EmulatorConfig {
  return {
    ...config,
    id: crypto.randomUUID(),
    name: `${config.name}${suffix}`,
    profiles: config.profiles.map((p) => cloneProfile(p)),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Check if an emulator definition has any configured instances.
 */
export function isEmulatorConfigured(definitionId: string): boolean {
  return getAllEmulatorConfigs().some((c) => c.definitionId === definitionId);
}

/**
 * Check if any emulator config exists.
 */
export function hasActiveEmulatorConfig(): boolean {
  return getAllEmulatorConfigs().length > 0;
}

/**
 * Subscribe to changes.
 */
export function onEmulatorConfigChange(listener: Listener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/**
 * Force reload from storage.
 */
export function reloadEmulatorConfigs(): void {
  _cache = null;
  notifyListeners();
}

// ─── Auto-detection helpers ────────────────────────────────────────────

/**
 * Common installation paths for popular emulators.
 */
const COMMON_INSTALL_PATHS: Record<string, string[]> = {
  retroarch: [
    "C:\\RetroArch\\retroarch.exe",
    "C:\\Program Files\\RetroArch\\retroarch.exe",
    "%LOCALAPPDATA%\\RetroArch\\retroarch.exe",
  ],
  dolphin: [
    "C:\\Program Files\\Dolphin\\Dolphin.exe",
    "%LOCALAPPDATA%\\Dolphin\\Dolphin.exe",
  ],
  pcsx2: [
    "C:\\Program Files\\PCSX2\\pcsx2-qt.exe",
    "%LOCALAPPDATA%\\PCSX2\\pcsx2-qt.exe",
  ],
  ppsspp: [
    "C:\\Program Files\\PPSSPP\\PPSSPPWindows64.exe",
    "%LOCALAPPDATA%\\PPSSPP\\PPSSPPWindows64.exe",
  ],
  cemu: [
    "C:\\Cemu\\Cemu.exe",
    "%LOCALAPPDATA%\\Cemu\\Cemu.exe",
  ],
  duckstation: [
    "C:\\Program Files\\DuckStation\\duckstation-qt.exe",
    "%LOCALAPPDATA%\\DuckStation\\duckstation-qt.exe",
  ],
  rpcs3: [
    "C:\\Program Files\\RPCS3\\rpcs3.exe",
    "%LOCALAPPDATA%\\RPCS3\\rpcs3.exe",
  ],
};

export function getCommonInstallPaths(definitionId: string): string[] {
  return COMMON_INSTALL_PATHS[definitionId] ?? [];
}
