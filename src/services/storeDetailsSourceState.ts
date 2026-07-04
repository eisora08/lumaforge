// ---------------------------------------------------------------------------
// Module-level Store GameDetails source/provider state cache.
// Persists across mount/unmount so returning to a game's details page
// restores the same selected provider and media state.
// ---------------------------------------------------------------------------

export type StoreDetailsSourceState = {
  appid: string;
  selectedProvider: string | null;
  savedSelectedProvider: string | null;
  providerResults: number;
  hasCatalogMedia: boolean;
  hasSelectedMedia: boolean;
  status: "idle" | "checking" | "ready" | "missing" | "error";
  updatedAt: number;
};

const _detailsStateStore = new Map<string, StoreDetailsSourceState>();

export function getStoreDetailsState(appId: string): StoreDetailsSourceState | undefined {
  return _detailsStateStore.get(appId);
}

export function setStoreDetailsState(appId: string, state: StoreDetailsSourceState): void {
  _detailsStateStore.set(appId, state);
}

export function updateStoreDetailsState(appId: string, partial: Partial<StoreDetailsSourceState>): void {
  const existing = _detailsStateStore.get(appId);
  _detailsStateStore.set(appId, { ...existing as StoreDetailsSourceState, ...partial, appid: appId } as StoreDetailsSourceState);
}

export function buildStoreDetailsState(appId: string, opts: {
  selectedProvider: string | null;
  savedSelectedProvider: string | null;
  providerResults: number;
  hasCatalogMedia: boolean;
  hasSelectedMedia: boolean;
  status: StoreDetailsSourceState["status"];
}): StoreDetailsSourceState {
  return {
    appid: appId,
    selectedProvider: opts.selectedProvider,
    savedSelectedProvider: opts.savedSelectedProvider,
    providerResults: opts.providerResults,
    hasCatalogMedia: opts.hasCatalogMedia,
    hasSelectedMedia: opts.hasSelectedMedia,
    status: opts.status,
    updatedAt: Date.now(),
  };
}

export function getStoreDetailsCacheSize(): number {
  return _detailsStateStore.size;
}

export function getStoreDetailsCacheSnapshot(): Record<string, StoreDetailsSourceState> {
  const snapshot: Record<string, StoreDetailsSourceState> = {};
  for (const [key, state] of _detailsStateStore) {
    snapshot[key] = state;
  }
  return snapshot;
}
