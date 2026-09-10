import {
  getAllCollections as getAllCollectionsBackend,
  getCollectionItems as getCollectionItemsBackend,
  createCollection as createCollectionBackend,
  updateCollection as updateCollectionBackend,
  deleteCollection as deleteCollectionBackend,
  addGameToCollection as addGameToCollectionBackend,
  removeGameFromCollection as removeGameFromCollectionBackend,
  reorderCollectionItems as reorderCollectionItemsBackend,
} from "./tauri";
import type { Collection, CollectionItem } from "./tauri";
import { subscribeDataChanges } from "./dataChangeBus";

// ---------------------------------------------------------------------------
// Collections — service layer with localStorage + Tauri persistence.
// ---------------------------------------------------------------------------

const COLLECTIONS_STORAGE_KEY = "lumaforge-collections-v1";
const COLLECTION_ITEMS_STORAGE_KEY = "lumaforge-collection-items-v1";

// In-memory cache
let cachedCollections: Collection[] = [];
let cachedCollectionItems: Map<string, CollectionItem[]> = new Map();
let loadPromise: Promise<Collection[]> | null = null;

// Listeners
type CollectionsListener = () => void;
const _listeners = new Set<CollectionsListener>();

function notifyListeners(): void {
  for (const fn of _listeners) {
    try { fn(); } catch {}
  }
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function loadCollectionsFromLocalStorage(): Collection[] {
  try {
    const raw = localStorage.getItem(COLLECTIONS_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch {
    return [];
  }
}

function saveCollectionsToLocalStorage(collections: Collection[]): void {
  try {
    localStorage.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify(collections));
  } catch {}
}

function loadCollectionItemsFromLocalStorage(collectionId: string): CollectionItem[] {
  try {
    const raw = localStorage.getItem(COLLECTION_ITEMS_STORAGE_KEY);
    if (!raw) return [];
    const map = JSON.parse(raw);
    if (typeof map !== "object" || map === null) return [];
    return Array.isArray(map[collectionId]) ? map[collectionId] : [];
  } catch {
    return [];
  }
}

function saveCollectionItemsToLocalStorage(collectionId: string, items: CollectionItem[]): void {
  try {
    const raw = localStorage.getItem(COLLECTION_ITEMS_STORAGE_KEY);
    const map = typeof raw === "string" ? JSON.parse(raw) : {};
    map[collectionId] = items;
    localStorage.setItem(COLLECTION_ITEMS_STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

// ---------------------------------------------------------------------------
// Public API — Collections
// ---------------------------------------------------------------------------

export async function loadCollections(forceRefresh = false): Promise<Collection[]> {
  if (cachedCollections.length > 0 && !forceRefresh) return cachedCollections;
  if (loadPromise && !forceRefresh) return loadPromise;

  loadPromise = getAllCollectionsBackend().then((collections) => {
    cachedCollections = collections;
    saveCollectionsToLocalStorage(collections);
    loadPromise = null;
    return collections;
  }).catch(() => {
    const local = loadCollectionsFromLocalStorage();
    cachedCollections = local;
    loadPromise = null;
    return local;
  });

  return loadPromise;
}

export function getCachedCollections(): Collection[] {
  return cachedCollections;
}

export function getRootCollections(): Collection[] {
  return cachedCollections
    .filter((c) => c.parentId === null)
    .sort((a, b) => a.position - b.position);
}

export function getSubCollections(parentId: string): Collection[] {
  return cachedCollections
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => a.position - b.position);
}

export function getCollectionById(id: string): Collection | undefined {
  return cachedCollections.find((c) => c.id === id);
}

export async function createCollection(
  name: string,
  parentId?: string | null,
  color?: string | null,
  coverPath?: string | null,
): Promise<Collection | null> {
  const collection = await createCollectionBackend(name, parentId, color, coverPath);
  if (!collection) return null;

  cachedCollections = [...cachedCollections, collection].sort((a, b) => a.position - b.position);
  saveCollectionsToLocalStorage(cachedCollections);
  notifyListeners();
  return collection;
}

export async function updateCollection(
  id: string,
  changes: { name?: string | null; color?: string | null; coverPath?: string | null; parentId?: string | null; position?: number | null },
): Promise<void> {
  await updateCollectionBackend(id, changes.name, changes.color, changes.coverPath, changes.parentId, changes.position);

  cachedCollections = cachedCollections.map((c) =>
    c.id === id
      ? {
          ...c,
          ...(changes.name !== undefined && { name: changes.name ?? c.name }),
          ...(changes.color !== undefined && { color: changes.color }),
          ...(changes.coverPath !== undefined && { coverPath: changes.coverPath }),
          ...(changes.parentId !== undefined && { parentId: changes.parentId }),
          ...(changes.position !== undefined && { position: changes.position ?? c.position }),
          updatedAt: Math.floor(Date.now() / 1000),
        }
      : c,
  );
  saveCollectionsToLocalStorage(cachedCollections);
  notifyListeners();
}

export async function deleteCollection(id: string): Promise<void> {
  await deleteCollectionBackend(id);

  // Remove collection and all its sub-collections from cache
  const idsToRemove = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of cachedCollections) {
      if (c.parentId && idsToRemove.has(c.parentId) && !idsToRemove.has(c.id)) {
        idsToRemove.add(c.id);
        changed = true;
      }
    }
  }

  cachedCollections = cachedCollections.filter((c) => !idsToRemove.has(c.id));
  saveCollectionsToLocalStorage(cachedCollections);

  // Remove cached items for deleted collections
  for (const cid of idsToRemove) {
    cachedCollectionItems.delete(cid);
  }

  notifyListeners();
}

// ---------------------------------------------------------------------------
// Public API — Collection Items
// ---------------------------------------------------------------------------

export async function loadCollectionItems(collectionId: string, forceRefresh = false): Promise<CollectionItem[]> {
  if (!forceRefresh && cachedCollectionItems.has(collectionId)) {
    return cachedCollectionItems.get(collectionId)!;
  }

  try {
    const items = await getCollectionItemsBackend(collectionId);
    cachedCollectionItems.set(collectionId, items);
    saveCollectionItemsToLocalStorage(collectionId, items);
    return items;
  } catch {
    const local = loadCollectionItemsFromLocalStorage(collectionId);
    cachedCollectionItems.set(collectionId, local);
    return local;
  }
}

export function getCachedCollectionItems(collectionId: string): CollectionItem[] {
  return cachedCollectionItems.get(collectionId) ?? [];
}

export function isGameInCollection(collectionId: string, gameId: string): boolean {
  const items = cachedCollectionItems.get(collectionId);
  return items?.some((i) => i.gameId === gameId) ?? false;
}

export function getCollectionsForGame(gameId: string): Collection[] {
  return cachedCollections.filter((c) => {
    const items = cachedCollectionItems.get(c.id);
    return items?.some((i) => i.gameId === gameId) ?? false;
  });
}

export async function addGameToCollection(collectionId: string, gameId: string): Promise<CollectionItem | null> {
  const item = await addGameToCollectionBackend(collectionId, gameId);
  if (!item) return null;

  const items = cachedCollectionItems.get(collectionId) ?? [];
  items.push(item);
  items.sort((a, b) => a.position - b.position);
  cachedCollectionItems.set(collectionId, items);
  saveCollectionItemsToLocalStorage(collectionId, items);
  notifyListeners();
  return item;
}

export async function removeGameFromCollection(collectionId: string, gameId: string): Promise<boolean> {
  const items = cachedCollectionItems.get(collectionId);
  if (!items?.some((i) => i.gameId === gameId)) return false;

  await removeGameFromCollectionBackend(collectionId, gameId);
  const updated = items.filter((i) => i.gameId !== gameId);
  cachedCollectionItems.set(collectionId, updated);
  saveCollectionItemsToLocalStorage(collectionId, updated);
  notifyListeners();
  return true;
}

export async function toggleGameInCollection(collectionId: string, gameId: string): Promise<boolean> {
  if (isGameInCollection(collectionId, gameId)) {
    await removeGameFromCollection(collectionId, gameId);
    return false;
  } else {
    return (await addGameToCollection(collectionId, gameId)) !== null;
  }
}

export async function reorderCollectionItems(collectionId: string, gameIds: string[]): Promise<void> {
  await reorderCollectionItemsBackend(collectionId, gameIds);

  const items = gameIds
    .map((id, i) => {
      const existing = cachedCollectionItems.get(collectionId)?.find((e) => e.gameId === id);
      return {
        id: existing?.id ?? 0,
        collectionId,
        gameId: id,
        position: i,
        addedAt: existing?.addedAt ?? Math.floor(Date.now() / 1000),
      };
    });
  cachedCollectionItems.set(collectionId, items);
  saveCollectionItemsToLocalStorage(collectionId, items);
  notifyListeners();
}

// ---------------------------------------------------------------------------
// Subscribe / unsubscribe
// ---------------------------------------------------------------------------

export function subscribeCollections(fn: CollectionsListener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

// ---------------------------------------------------------------------------
// Listen for backend changes (e.g. from another process or restore)
// ---------------------------------------------------------------------------

let _dataChangeUnsub: (() => void) | null = null;

export function initCollectionsDataChangeListener(): void {
  if (_dataChangeUnsub) return;
  _dataChangeUnsub = subscribeDataChanges((type) => {
    if (type === "collections-changed") {
      loadCollections(true).then(() => notifyListeners()).catch(() => {});
    }
  });
}

export function destroyCollectionsDataChangeListener(): void {
  _dataChangeUnsub?.();
  _dataChangeUnsub = null;
}
