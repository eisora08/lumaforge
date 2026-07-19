/**
 * Extension Compatibility Resolver — Evaluates launcher compatibility for extension manifests.
 *
 * Pure functions. No side effects, no I/O, no network.
 * Checks schema version, minimum/maximum launcher version constraints.
 */

import type { ExtensionManifestV1 } from "../types";

// =============================================================================
// Types
// =============================================================================

export interface CompatibilityResult {
  compatible: boolean;
  reasons: string[];
}

// =============================================================================
// Launcher Version
// =============================================================================

/**
 * Current launcher version (SemVer string).
 * Updated when the launcher ships a new version.
 *
 * For this isolated phase, this is a constant.
 * Production wiring will read from package.json or a build constant.
 */
const LAUNCHER_VERSION = "1.0.0";

/**
 * Get the current launcher version.
 * Exposed as a function for testability.
 */
export function getLauncherVersion(): string {
  return LAUNCHER_VERSION;
}

// =============================================================================
// SemVer Comparison
// =============================================================================

interface ParsedSemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemVer(version: string): ParsedSemVer | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(.+))?$/.exec(version);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareSemVer(a: string, b: string): number {
  const pa = parseSemVer(a);
  const pb = parseSemVer(b);
  if (!pa || !pb) return 0;

  // Compare major.minor.patch
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;

  // Pre-release versions are lower than release
  if (pa.prerelease.length === 0 && pb.prerelease.length > 0) return 1;
  if (pa.prerelease.length > 0 && pb.prerelease.length === 0) return -1;
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;

  // Compare pre-release identifiers
  const len = Math.min(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const aIsNum = /^\d+$/.test(pa.prerelease[i]);
    const bIsNum = /^\d+$/.test(pb.prerelease[i]);
    if (aIsNum && bIsNum) {
      const diff = parseInt(pa.prerelease[i], 10) - parseInt(pb.prerelease[i], 10);
      if (diff !== 0) return diff;
    } else {
      const diff = pa.prerelease[i].localeCompare(pb.prerelease[i]);
      if (diff !== 0) return diff;
    }
  }
  return pa.prerelease.length - pb.prerelease.length;
}

// =============================================================================
// Compatibility Evaluation
// =============================================================================

/**
 * Evaluate whether an extension manifest is compatible with the current launcher.
 *
 * Checks:
 * - Schema version must be 1
 * - Minimum launcher version (if declared) must be <= current launcher version
 * - Maximum launcher version (if declared) must be >= current launcher version
 */
export function evaluateCompatibility(manifest: ExtensionManifestV1): CompatibilityResult {
  const reasons: string[] = [];
  let compatible = true;

  // Schema version check
  if (manifest.schemaVersion !== 1) {
    compatible = false;
    reasons.push(`Unsupported schema version: ${manifest.schemaVersion} (expected 1)`);
  }

  // Minimum launcher version
  if (manifest.minimumLauncherVersion) {
    const current = getLauncherVersion();
    if (compareSemVer(current, manifest.minimumLauncherVersion) < 0) {
      compatible = false;
      reasons.push(
        `Requires launcher >= ${manifest.minimumLauncherVersion}, current is ${current}`
      );
    }
  }

  // Maximum launcher version
  if (manifest.maximumLauncherVersion) {
    const current = getLauncherVersion();
    if (compareSemVer(current, manifest.maximumLauncherVersion) > 0) {
      compatible = false;
      reasons.push(
        `Requires launcher <= ${manifest.maximumLauncherVersion}, current is ${current}`
      );
    }
  }

  return { compatible, reasons };
}
