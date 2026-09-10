import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  loadPlayQueue,
  getCachedPlayQueue,
  isInPlayQueue,
  addToPlayQueue as addToPlayQueueService,
  removeFromPlayQueue as removeFromPlayQueueService,
  togglePlayQueue as togglePlayQueueService,
  reorderPlayQueue as reorderPlayQueueService,
  clearPlayQueue as clearPlayQueueService,
  subscribePlayQueue,
  initPlayQueueDataChangeListener,
} from "../services/playQueueService";
import type { PlayQueueEntry } from "../services/tauri";

type PlayQueueState = {
  queue: PlayQueueEntry[];
  isInQueue: (gameId: string) => boolean;
  addToQueue: (gameId: string) => Promise<boolean>;
  removeFromQueue: (gameId: string) => Promise<boolean>;
  toggleQueue: (gameId: string) => Promise<boolean>;
  reorderQueue: (gameIds: string[]) => Promise<void>;
  clearQueue: () => Promise<void>;
  loading: boolean;
};

const PlayQueueContext = createContext<PlayQueueState | null>(null);

export function PlayQueueProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<PlayQueueEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Load on mount
  useEffect(() => {
    loadPlayQueue().then((entries) => {
      setQueue(entries);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });

    initPlayQueueDataChangeListener();
  }, []);

  // Subscribe to service changes
  useEffect(() => {
    return subscribePlayQueue(() => {
      setQueue([...getCachedPlayQueue()]);
    });
  }, []);

  const isInQueue = useCallback(
    (gameId: string) => isInPlayQueue(gameId),
    [queue],
  );

  const addToQueue = useCallback(async (gameId: string) => {
    const result = await addToPlayQueueService(gameId);
    return result;
  }, []);

  const removeFromQueue = useCallback(async (gameId: string) => {
    const result = await removeFromPlayQueueService(gameId);
    return result;
  }, []);

  const toggleQueue = useCallback(async (gameId: string) => {
    const result = await togglePlayQueueService(gameId);
    return result;
  }, []);

  const reorderQueue = useCallback(async (gameIds: string[]) => {
    await reorderPlayQueueService(gameIds);
  }, []);

  const clearQueue = useCallback(async () => {
    await clearPlayQueueService();
  }, []);

  const ctxValue = useMemo(
    () => ({
      queue,
      isInQueue,
      addToQueue,
      removeFromQueue,
      toggleQueue,
      reorderQueue,
      clearQueue,
      loading,
    }),
    [queue, isInQueue, addToQueue, removeFromQueue, toggleQueue, reorderQueue, clearQueue, loading],
  );

  return <PlayQueueContext.Provider value={ctxValue}>{children}</PlayQueueContext.Provider>;
}

export function usePlayQueue(): PlayQueueState {
  const ctx = useContext(PlayQueueContext);
  if (!ctx) throw new Error("usePlayQueue must be used within PlayQueueProvider");
  return ctx;
}
