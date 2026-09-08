/**
 * Scan Configuration Store
 *
 * Manages persistent auto-scan configurations for ROM importing.
 * Based on Playnite's GameScannerConfig system.
 */

import type { ScanConfiguration } from "../data/emulatorDefinitions/types";

// ─── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = "lumaforge-scan-configs-v1";
const STORAGE_VERSION = 1;

// ─── Types ─────────────────────────────────────────────────────────────

type ScanConfigStore = {
  version: number;
  configs: ScanConfiguration[];
};

// ─── Module-level cache ────────────────────────────────────────────────

let _cache: ScanConfiguration[] | null = null;

// ─── Listeners ─────────────────────────────────────────────────────────

type Listener = () => void;
const _listeners = new Set<Listener>();

function notifyListeners(): void {
  _listeners.forEach((fn) => fn());
}

// ─── LocalStorage helpers ──────────────────────────────────────────────

function loadFromStorage(): ScanConfiguration[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ScanConfigStore;
      if (Array.isArray(parsed.configs)) return parsed.configs;
    }
  } catch {
    // corrupt storage
  }
  return [];
}

function saveToStorage(configs: ScanConfiguration[]): void {
  try {
    const store: ScanConfigStore = { version: STORAGE_VERSION, configs };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage full
  }
}

// ─── Defaults ──────────────────────────────────────────────────────────

const DEFAULT_SCAN_CONFIG: Omit<ScanConfiguration, "id" | "createdAt" | "updatedAt"> = {
  name: "Config",
  emulatorId: "",
  profileId: "",
  directory: "",
  playActionSettings: "scanner",
  crcExcludeFileTypes: ["*.chd"],
  excludeOnlineFiles: false,
  useSimplifiedScan: false,
  importWithRelativePaths: true,
  scanSubfolders: true,
  scanInsideArchives: true,
  mergeRelatedFiles: true,
  includeInGlobalUpdate: true,
  excludedFiles: [],
  excludedDirectories: [],
};

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Get all scan configurations.
 */
export function getAllScanConfigs(): ScanConfiguration[] {
  if (_cache !== null) return _cache;
  _cache = loadFromStorage();
  return _cache;
}

/**
 * Get a single scan config by ID.
 */
export function getScanConfig(id: string): ScanConfiguration | undefined {
  return getAllScanConfigs().find((c) => c.id === id);
}

/**
 * Get scan configs for a specific emulator.
 */
export function getScanConfigsByEmulator(emulatorId: string): ScanConfiguration[] {
  return getAllScanConfigs().filter((c) => c.emulatorId === emulatorId);
}

/**
 * Create a new scan configuration with defaults.
 */
export function createScanConfig(overrides?: Partial<Omit<ScanConfiguration, "id" | "createdAt" | "updatedAt">>): ScanConfiguration {
  const now = Date.now();
  return {
    ...DEFAULT_SCAN_CONFIG,
    ...overrides,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Save a scan configuration.
 */
export function saveScanConfig(config: ScanConfiguration): void {
  const configs = getAllScanConfigs();
  const existing = configs.findIndex((c) => c.id === config.id);

  let newConfigs: ScanConfiguration[];
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
 * Update a scan configuration.
 */
export function updateScanConfig(
  id: string,
  updates: Partial<Omit<ScanConfiguration, "id" | "createdAt">>
): void {
  const configs = getAllScanConfigs();
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
 * Delete a scan configuration.
 */
export function deleteScanConfig(id: string): void {
  const configs = getAllScanConfigs();
  const filtered = configs.filter((c) => c.id !== id);

  if (filtered.length === configs.length) return;

  _cache = filtered;
  saveToStorage(filtered);
  notifyListeners();
}

/**
 * Deep-clone a scan config with a new ID.
 */
export function copyScanConfig(config: ScanConfiguration, suffix: string = " Copy"): ScanConfiguration {
  return {
    ...config,
    id: crypto.randomUUID(),
    name: `${config.name}${suffix}`,
    crcExcludeFileTypes: [...config.crcExcludeFileTypes],
    excludedFiles: [...config.excludedFiles],
    excludedDirectories: [...config.excludedDirectories],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Get scan configs that should run during global update.
 */
export function getGlobalScanConfigs(): ScanConfiguration[] {
  return getAllScanConfigs().filter((c) => c.includeInGlobalUpdate);
}

/**
 * Subscribe to changes.
 */
export function onScanConfigChange(listener: Listener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/**
 * Force reload from storage.
 */
export function reloadScanConfigs(): void {
  _cache = null;
  notifyListeners();
}
