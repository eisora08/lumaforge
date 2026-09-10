import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  loadCollections,
  getCachedCollections,
  getRootCollections,
  getSubCollections,
  getCollectionById,
  createCollection as createCollectionService,
  updateCollection as updateCollectionService,
  deleteCollection as deleteCollectionService,
  loadCollectionItems,
  getCachedCollectionItems,
  isGameInCollection,
  getCollectionsForGame,
  addGameToCollection as addGameToCollectionService,
  removeGameFromCollection as removeGameFromCollectionService,
  toggleGameInCollection as toggleGameInCollectionService,
  subscribeCollections,
  initCollectionsDataChangeListener,
} from "../services/collectionsService";
import type { Collection, CollectionItem } from "../services/tauri";

type CollectionsState = {
  collections: Collection[];
  getRootCollections: () => Collection[];
  getSubCollections: (parentId: string) => Collection[];
  getCollectionById: (id: string) => Collection | undefined;
  createCollection: (name: string, parentId?: string | null, color?: string | null, coverPath?: string | null) => Promise<Collection | null>;
  updateCollection: (id: string, changes: { name?: string | null; color?: string | null; coverPath?: string | null; parentId?: string | null; position?: number | null }) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  getCollectionItems: (collectionId: string) => Promise<CollectionItem[]>;
  getCachedCollectionItems: (collectionId: string) => CollectionItem[];
  getCachedCollectionGameCount: (collectionId: string) => number;
  isGameInCollection: (collectionId: string, gameId: string) => boolean;
  getCollectionsForGame: (gameId: string) => Collection[];
  addGameToCollection: (collectionId: string, gameId: string) => Promise<CollectionItem | null>;
  removeFromCollection: (collectionId: string, gameId: string) => Promise<boolean>;
  toggleGameInCollection: (collectionId: string, gameId: string) => Promise<boolean>;
  loading: boolean;
};

const CollectionsContext = createContext<CollectionsState | null>(null);

export function CollectionsProvider({ children }: { children: React.ReactNode }) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);

  // Load on mount
  useEffect(() => {
    loadCollections().then((cols) => {
      setCollections(cols);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });

    initCollectionsDataChangeListener();
  }, []);

  // Subscribe to service changes
  useEffect(() => {
    return subscribeCollections(() => {
      setCollections([...getCachedCollections()]);
    });
  }, []);

  const _getRootCollections = useCallback(() => getRootCollections(), [collections]);
  const _getSubCollections = useCallback((parentId: string) => getSubCollections(parentId), [collections]);
  const _getCollectionById = useCallback((id: string) => getCollectionById(id), [collections]);

  const _createCollection = useCallback(async (name: string, parentId?: string | null, color?: string | null, coverPath?: string | null) => {
    const col = await createCollectionService(name, parentId, color, coverPath);
    if (col) setCollections([...getCachedCollections()]);
    return col;
  }, []);

  const _updateCollection = useCallback(async (id: string, changes: { name?: string | null; color?: string | null; coverPath?: string | null; parentId?: string | null; position?: number | null }) => {
    await updateCollectionService(id, changes);
    setCollections([...getCachedCollections()]);
  }, []);

  const _deleteCollection = useCallback(async (id: string) => {
    await deleteCollectionService(id);
    setCollections([...getCachedCollections()]);
  }, []);

  const _getCollectionItems = useCallback(async (collectionId: string) => {
    return loadCollectionItems(collectionId);
  }, []);

  const _getCachedCollectionItems = useCallback((collectionId: string) => {
    return getCachedCollectionItems(collectionId);
  }, []);

  const _isGameInCollection = useCallback((collectionId: string, gameId: string) => {
    return isGameInCollection(collectionId, gameId);
  }, []);

  const _getCollectionsForGame = useCallback((gameId: string) => {
    return getCollectionsForGame(gameId);
  }, []);

  const _addGameToCollection = useCallback(async (collectionId: string, gameId: string) => {
    const item = await addGameToCollectionService(collectionId, gameId);
    return item;
  }, []);

  const _removeFromCollection = useCallback(async (collectionId: string, gameId: string) => {
    const result = await removeGameFromCollectionService(collectionId, gameId);
    return result;
  }, []);

  const _toggleGameInCollection = useCallback(async (collectionId: string, gameId: string) => {
    const result = await toggleGameInCollectionService(collectionId, gameId);
    return result;
  }, []);

  const _getCachedCollectionGameCount = useCallback((collectionId: string) => {
    return getCachedCollectionItems(collectionId).length;
  }, [collections]);

  const ctxValue = useMemo(
    () => ({
      collections,
      getRootCollections: _getRootCollections,
      getSubCollections: _getSubCollections,
      getCollectionById: _getCollectionById,
      createCollection: _createCollection,
      updateCollection: _updateCollection,
      deleteCollection: _deleteCollection,
      getCollectionItems: _getCollectionItems,
      getCachedCollectionItems: _getCachedCollectionItems,
      isGameInCollection: _isGameInCollection,
      getCollectionsForGame: _getCollectionsForGame,
      addGameToCollection: _addGameToCollection,
      removeFromCollection: _removeFromCollection,
      toggleGameInCollection: _toggleGameInCollection,
      getCachedCollectionGameCount: _getCachedCollectionGameCount,
      loading,
    }),
    [collections, loading],
  );

  return <CollectionsContext.Provider value={ctxValue}>{children}</CollectionsContext.Provider>;
}

export function useCollections(): CollectionsState {
  const ctx = useContext(CollectionsContext);
  if (!ctx) throw new Error("useCollections must be used within CollectionsProvider");
  return ctx;
}
