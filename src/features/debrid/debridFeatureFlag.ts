/**
 * Debrid Games Library integration feature flags.
 *
 * Flags are production-ready. Runtime gating checks settings.debridApiKey
 * to determine if Debrid is actually usable.
 */

/** Master gate for Debrid game library import. */
export const DEBRID_LIBRARY_ENABLED = true;

/** Gate for Debrid game launch via Hydra streaming/extraction. Requires DEBRID_LIBRARY_ENABLED. */
export const DEBRID_LAUNCH_ENABLED = true;

/** Gate for Debrid install flow (download + extract + post-install state). Requires DEBRID_LIBRARY_ENABLED. */
export const DEBRID_INSTALL_ENABLED = true;

/** Gate for Debrid repack discovery on the Store details page. */
export const DEBRID_STORE_ENABLED = true;

/** Diagnostics gate. Set to true for verbose console logging. */
export const DEBUG_DEBRID_LIBRARY = false;

/** Diagnostics gate for Debrid launch/extraction path. */
export const DEBUG_DEBRID_LAUNCH = false;

/** Diagnostics gate for Debrid install flow. */
export const DEBUG_DEBRID_INSTALL = false;

/**
 * Runtime check: Debrid is usable when an API key is configured.
 * Import settings via dynamic import to avoid circular deps.
 */
export async function isDebridApiKeyConfigured(): Promise<boolean> {
  try {
    const { loadSettings } = await import("../../context/SettingsContext");
    const s = loadSettings();
    const cfg = s.debridProviders;
    return !!(cfg?.torboxApiKey || cfg?.realDebridApiKey || cfg?.allDebridApiKey || cfg?.premiumizeApiKey);
  } catch {
    return false;
  }
}

/** Synchronous version for call sites that already have settings. */
export function isDebridApiKeyConfiguredSync(cfg: { torboxApiKey?: string; realDebridApiKey?: string; allDebridApiKey?: string; premiumizeApiKey?: string }): boolean {
  return !!(cfg?.torboxApiKey || cfg?.realDebridApiKey || cfg?.allDebridApiKey || cfg?.premiumizeApiKey);
}
