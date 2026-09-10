// Module-level pending collection ID store.
// Used to pass a collection ID from a dashboard/sidebar card click
// to the CollectionsPage without a race-prone CustomEvent.

let _pendingId: string | null = null;

export function setPendingCollectionId(id: string) {
  _pendingId = id;
}

export function consumePendingCollectionId(): string | null {
  const id = _pendingId;
  _pendingId = null;
  return id;
}
