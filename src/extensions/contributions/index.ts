/**
 * Extension Contributions — Barrel Export
 *
 * Re-exports all contribution-related types, constants, and functions.
 */

export type {
  ExtensionSurface,
  ExtensionSurfaceContribution,
  ManifestContributionSource,
} from "./types";
export {
  VALID_SURFACES,
} from "./types";

export {
  resolveContributions,
  filterActiveContributions,
  extractManifestContributionSources,
} from "./resolver";
