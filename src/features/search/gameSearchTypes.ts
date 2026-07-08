import type { SteamStoreSearchItem } from "../../types/steamStoreSearch";
import type { GameSearchBadgeLabel } from "./gameSearchOwnership";

export type GameSearchSource = "steam-store";

/**
 * Normalized search result from any provider.
 * Contains only data from the search provider — no ownership/install enrichment.
 */
export interface GameSearchResult {
  appId: string;
  title: string;
  imageUrl?: string;
  priceLabel?: string;
  discountLabel?: string;
  source: GameSearchSource;
  /** Original source item preserved for backward compat */
  raw: SteamStoreSearchItem;
}

/**
 * Ownership/install state provided by the caller.
 * Each search entry point computes these from its own data sources.
 */
export interface GameSearchOwnershipState {
  owned?: boolean;
  installed?: boolean;
  luaActive?: boolean;
}

/**
 * A search result enriched with ownership state and computed badge labels.
 * Badge derivation follows Store search's canonical formula.
 */
export interface EnrichedGameSearchResult extends GameSearchResult {
  owned: boolean;
  installed: boolean;
  inLibrary: boolean;
  badges: GameSearchBadgeLabel[];
}
