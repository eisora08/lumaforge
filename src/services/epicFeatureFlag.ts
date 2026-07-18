/**
 * Epic Games Library integration feature flags.
 *
 * Defaults to OFF for production. Enable during local validation.
 * When OFF: Epic entries are never scanned, stored, or merged into LibraryGamesContext.
 * When ON: Epic local scanner runs, eligible entries appear in Library grid.
 */

/** Master gate for Epic local import. */
export const EPIC_LIBRARY_ENABLED = true;

/** Gate for Epic game launch via protocol URI. Requires EPIC_LIBRARY_ENABLED. */
export const EPIC_LAUNCH_ENABLED = true;

/**
 * Gate for Epic direct executable launch fallback.
 * When false (default): protocol failure returns error, no executable fallback.
 * When true: falls back to Command::new(executable) if protocol launch fails.
 * Requires EPIC_LAUNCH_ENABLED.
 *
 * WARNING: Direct launch bypasses Epic authentication, overlay, achievements,
 * and cloud sync. Only enable for games that cannot be launched via protocol.
 */
export const EPIC_DIRECT_LAUNCH_ENABLED = false;

/** Diagnostics gate. Set to true for verbose console logging. */
export const DEBUG_EPIC_LIBRARY = true;

/** Diagnostics gate for Epic launch path. */
export const DEBUG_EPIC_LAUNCH = true;

/**
 * Debug flag for Epic Desktop integration details —
 * provider-aware rendering, media adapter, override store, GameEditDialog mode.
 * Set to true for verbose console logging during development.
 */
export const EPIC_DESKTOP = true;

// ── Temporary startup diagnostic (remove after runtime validation) ──
console.log(
  "[EPIC_BOOT][ACTIVE_FLAGS]",
  JSON.stringify({
    module: "epicFeatureFlag.ts",
    libraryEnabled: EPIC_LIBRARY_ENABLED,
    launchEnabled: EPIC_LAUNCH_ENABLED,
    directEnabled: EPIC_DIRECT_LAUNCH_ENABLED,
    mode: import.meta.env.MODE ?? "unknown",
    timestamp: Date.now(),
  })
);
