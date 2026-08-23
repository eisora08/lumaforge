/**
 * Integration Settings Service — persistence, migration, getters.
 *
 * Persists via existing AppSettings "integrations" field (localStorage).
 * Migration from feature flags on first read.
 */

import {
  IntegrationId,
  IntegrationSettings,
  IntegrationSettingsState,
  INTEGRATION_SCHEMA_VERSION,
  DEFAULT_INTEGRATION_SETTINGS,
} from "../types/integrations";

const STORAGE_KEY = "lumaforge-integration-settings";
const MIGRATION_MARKER = "lumaforge-integrations-migrated-v1";

let _cached: IntegrationSettingsState | null = null;

function readRaw(): IntegrationSettingsState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as IntegrationSettingsState;
  } catch {
    return null;
  }
}

function writeRaw(state: IntegrationSettingsState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function migrateFromFeatureFlags(existing: IntegrationSettingsState | null): IntegrationSettingsState {
  const base: IntegrationSettingsState = {
    ...DEFAULT_INTEGRATION_SETTINGS,
    ...(existing ?? {}),
    integrations: {
      ...DEFAULT_INTEGRATION_SETTINGS.integrations,
      ...(existing?.integrations ?? {}),
    },
  };

  if (existing?.version === INTEGRATION_SCHEMA_VERSION && !localStorage.getItem(MIGRATION_MARKER)) {
    localStorage.setItem(MIGRATION_MARKER, "true");
  }

  base.version = INTEGRATION_SCHEMA_VERSION;
  localStorage.setItem(MIGRATION_MARKER, "true");
  return base;
}

export function loadIntegrationSettings(): IntegrationSettingsState {
  if (_cached) return _cached;
  const raw = readRaw();
  _cached = migrateFromFeatureFlags(raw);
  writeRaw(_cached);
  return _cached;
}

export function getIntegrationSettings(): IntegrationSettingsState {
  if (_cached) return _cached;
  return loadIntegrationSettings();
}

export function getIntegration(id: IntegrationId): IntegrationSettings {
  return getIntegrationSettings().integrations[id];
}

export function isIntegrationEnabled(id: IntegrationId): boolean {
  return getIntegration(id).enabled;
}

export function isIntegrationScanOnStartup(id: IntegrationId): boolean {
  const s = getIntegration(id);
  return s.enabled && s.scanOnStartup;
}

export function isIntegrationBackgroundScan(id: IntegrationId): boolean {
  const s = getIntegration(id);
  return s.enabled && s.backgroundScan;
}

export function isIntegrationSurfaceEnabled(id: IntegrationId, surface: string): boolean {
  const s = getIntegration(id);
  return s.enabled && (s.surfaces as Record<string, boolean>)[surface] === true;
}

export function updateIntegrationSettings(
  id: IntegrationId,
  patch: Partial<Omit<IntegrationSettings, "id" | "updatedAt">>
) {
  const state = getIntegrationSettings();
  const prev = state.integrations[id];
  state.integrations[id] = {
    ...prev,
    ...patch,
    id,
    updatedAt: Date.now(),
  };
  _cached = state;
  writeRaw(state);
}

export function resetIntegrationSettings() {
  _cached = DEFAULT_INTEGRATION_SETTINGS;
  writeRaw(DEFAULT_INTEGRATION_SETTINGS);
}

export function subscribeIntegrationSettings(listener: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      _cached = null;
      listener();
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

export function clearIntegrationCache() {
  _cached = null;
}

// Listen for external restore writes and reload from localStorage
if (typeof window !== "undefined") {
  window.addEventListener("lumaforge-data-changed", (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.key === STORAGE_KEY) {
      _cached = null;
    }
  });
}
