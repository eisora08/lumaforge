import type { SteamStoreSearchItem } from "../../types/steamStoreSearch";
import type { StoreSearchDropdownItem } from "../../components/packages/PackagesToolbar";
import type {
  GameSearchResult,
  GameSearchOwnershipState,
  EnrichedGameSearchResult,
} from "./gameSearchTypes";
import { deriveGameOwnershipBadgeState } from "./gameSearchOwnership";

/**
 * Maps raw SteamStoreSearchItem to normalized GameSearchResult.
 * This only extracts data from the search provider — no ownership enrichment.
 */
export function mapSteamStoreSearchItemToGameSearchResult(
  item: SteamStoreSearchItem
): GameSearchResult {
  return {
    appId: String(item.app_id),
    title: item.name,
    imageUrl: item.image_url || undefined,
    priceLabel: item.price_label || undefined,
    discountLabel: item.discount_label || undefined,
    source: "steam-store",
    raw: item,
  };
}

/**
 * Enriches a GameSearchResult with ownership/install state.
 *
 * Badge derivation follows Store search's canonical formula:
 * - owned: steam-owned cache
 * - installed: steam-installed (NOT lua-installed)
 * - inLibrary: owned ? !installed : luaActive
 * - badges array computed from the above booleans
 */
export function enrichGameSearchResult(
  result: GameSearchResult,
  state: GameSearchOwnershipState
): EnrichedGameSearchResult {
  const owned = Boolean(state.owned);
  const installed = Boolean(state.installed);
  const luaActive = Boolean(state.luaActive);
  const { inLibrary, badges } = deriveGameOwnershipBadgeState(owned, installed, luaActive);

  return {
    ...result,
    owned,
    installed,
    inLibrary,
    badges,
  };
}

/**
 * Bridges EnrichedGameSearchResult to the existing StoreSearchDropdownItem
 * type used by the PackagesToolbar dropdown rendering.
 */
export function mapEnrichedGameSearchResultToStoreSearchDropdownItem(
  result: EnrichedGameSearchResult
): StoreSearchDropdownItem {
  return {
    appId: result.appId,
    title: result.title,
    subtitle: `AppID ${result.appId}`,
    imageUrl: result.imageUrl,
    priceLabel: result.priceLabel,
    discountLabel: result.discountLabel,
    owned: result.owned,
    installed: result.installed,
    inLibrary: result.inLibrary,
  };
}
