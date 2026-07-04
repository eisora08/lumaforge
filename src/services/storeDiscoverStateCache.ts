// ---------------------------------------------------------------------------
// Unified Store Discover state cache — one object, one save/restore.
// Persists all Discover tab state across mount/unmount so re-entering the
// Store instantly shows the exact same view without partial restore artifacts.
// ---------------------------------------------------------------------------

import type { PackageGame } from "../types/package";
import type { StoreSectionModel, CacheStatus } from "./storeDiscoverCache";

export interface DiscoverState {
  fingerprint: string;
  status: CacheStatus;
  featuredGames: PackageGame[];
  dynamicDiscoverSections: StoreSectionModel[];
  allStoreSections: StoreSectionModel[];
  lumaForgeSections: StoreSectionModel[];
  moreToExploreGames: PackageGame[];
  selectedHeroIndex: number;
  builtAt: number;
}

let _discoverState: DiscoverState | null = null;

export function getDiscoverState(): DiscoverState | null {
  return _discoverState;
}

export function setDiscoverState(state: DiscoverState): void {
  _discoverState = state;
}

export function clearDiscoverState(): void {
  _discoverState = null;
}

export function getDiscoverStateVersion(): string {
  return _discoverState ? `${_discoverState.fingerprint}:${_discoverState.builtAt}` : "0";
}

// Validate that a cached state is complete (all required arrays present)
export function isDiscoverStateValid(state: DiscoverState | null): boolean {
  if (!state) return false;
  return (
    (state.status === "complete" || state.status === "partial") &&
    Array.isArray(state.featuredGames) &&
    Array.isArray(state.dynamicDiscoverSections) &&
    Array.isArray(state.allStoreSections) &&
    Array.isArray(state.lumaForgeSections) &&
    Array.isArray(state.moreToExploreGames) &&
    typeof state.selectedHeroIndex === "number" &&
    typeof state.fingerprint === "string" &&
    state.fingerprint.length > 0
  );
}
