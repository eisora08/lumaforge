/**
 * Shared ownership/install badge derivation.
 *
 * Store-canonical formula:
 * - owned: steam-owned cache
 * - installed: steam-installed (NOT lua-installed)
 * - luaActive: at least one active (non-disabled) Lua script
 * - inLibrary: owned ? !installed : luaActive
 * - badges array computed from the above booleans
 */

export type GameSearchBadgeLabel = "owned" | "installed" | "inLibrary";

export interface GameOwnershipBadgeState {
  owned: boolean;
  installed: boolean;
  luaActive: boolean;
  inLibrary: boolean;
  badges: GameSearchBadgeLabel[];
}

/**
 * Derives ownership badge state from raw booleans.
 *
 * This is the single source of truth for badge computation.
 * All search entry points (Store, Topbar, GlobalSearchResults)
 * must use this function to compute badges consistently.
 */
export function deriveGameOwnershipBadgeState(
  owned: boolean,
  installed: boolean,
  luaActive: boolean,
): GameOwnershipBadgeState {
  const inLibrary = owned ? !installed : luaActive;

  const badges: GameSearchBadgeLabel[] = [];
  if (owned) badges.push("owned");
  if (installed) badges.push("installed");
  if (!installed && inLibrary) badges.push("inLibrary");

  return { owned, installed, luaActive, inLibrary, badges };
}
