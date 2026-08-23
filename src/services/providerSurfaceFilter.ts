/**
 * Shared provider-surface eligibility helper.
 *
 * Central place to check if a provider's games should appear on a given UI surface.
 * Replaces per-component filtering with a single memoized source of truth.
 */

import { LibraryGame } from "../types/libraryGame";
import { IntegrationId, IntegrationSurface } from "../types/integrations";
import { isIntegrationSurfaceEnabled, isIntegrationEnabled } from "./integrationSettingsService";

function gameSourceToIntegration(game: LibraryGame): IntegrationId | null {
  if (game.source === "steam") return "steam";
  if (game.source === "epic") return "epic";
  if (game.source === "lua") return "lua";
  if (!game.appId && game.libraryId?.startsWith("manual:")) return "manual";
  if (game.source === "manual") return "manual";
  return null;
}

export function isIntegrationVisibleOnSurface(
  game: LibraryGame,
  surface: IntegrationSurface,
): boolean {
  const integration = gameSourceToIntegration(game);
  if (!integration) return true;
  return isIntegrationSurfaceEnabled(integration, surface);
}

export function isProviderEnabled(game: LibraryGame): boolean {
  const integration = gameSourceToIntegration(game);
  if (!integration) return true;
  return isIntegrationEnabled(integration);
}

export function filterGamesBySurface<T extends LibraryGame>(
  games: T[],
  surface: IntegrationSurface,
): T[] {
  return games.filter((g) => isIntegrationVisibleOnSurface(g, surface));
}

export function filterEnabledGames<T extends LibraryGame>(games: T[]): T[] {
  return games.filter((g) => isProviderEnabled(g));
}
