import { createContext, useContext, useMemo, useState } from "react";
import type { GameActivityItem, GameUpdateItem } from "../types/gameActivity";

type AddActivityInput = {
  gameId: string;
  appId?: string;
  kind: GameActivityItem["kind"];
  title: string;
  description?: string;
  source: GameActivityItem["source"];
  severity?: GameActivityItem["severity"];
};

type AddUpdateInput = {
  gameId: string;
  appId?: string;
  title: string;
  description?: string;
  kind: GameUpdateItem["kind"];
  status?: GameUpdateItem["status"];
};

type GameActivityContextValue = {
  activities: GameActivityItem[];
  updates: GameUpdateItem[];
  addActivity: (input: AddActivityInput) => void;
  addUpdate: (input: AddUpdateInput) => void;
  clearActivities: () => void;
  clearUpdates: () => void;
};

const STORAGE_KEY_ACTIVITIES = "lumaforge-game-activities";
const STORAGE_KEY_UPDATES = "lumaforge-game-updates";
const MAX_ACTIVITIES = 100;
const MAX_UPDATES = 50;

const ActivityContext = createContext<GameActivityContextValue | null>(null);

function loadFromStorage<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function persistToStorage<T>(key: string, data: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* storage full */
  }
}

export function GameActivityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activities, setActivities] = useState<GameActivityItem[]>(() =>
    loadFromStorage<GameActivityItem>(STORAGE_KEY_ACTIVITIES)
  );
  const [updates, setUpdates] = useState<GameUpdateItem[]>(() =>
    loadFromStorage<GameUpdateItem>(STORAGE_KEY_UPDATES)
  );

  function commitActivities(next: GameActivityItem[]) {
    setActivities(next);
    persistToStorage(STORAGE_KEY_ACTIVITIES, next);
  }

  function commitUpdates(next: GameUpdateItem[]) {
    setUpdates(next);
    persistToStorage(STORAGE_KEY_UPDATES, next);
  }

  function addActivity(input: AddActivityInput) {
    const item: GameActivityItem = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      gameId: input.gameId,
      appId: input.appId,
      kind: input.kind,
      title: input.title,
      description: input.description,
      createdAt: Date.now(),
      source: input.source,
      severity: input.severity,
    };
    const next = [item, ...activities].slice(0, MAX_ACTIVITIES);
    commitActivities(next);
  }

  function addUpdate(input: AddUpdateInput) {
    const item: GameUpdateItem = {
      id: `upd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      gameId: input.gameId,
      appId: input.appId,
      title: input.title,
      description: input.description,
      createdAt: Date.now(),
      kind: input.kind,
      status: input.status,
    };
    const next = [item, ...updates].slice(0, MAX_UPDATES);
    commitUpdates(next);
  }

  function clearActivities() {
    commitActivities([]);
  }

  function clearUpdates() {
    commitUpdates([]);
  }

  const value = useMemo(
    () => ({
      activities,
      updates,
      addActivity,
      addUpdate,
      clearActivities,
      clearUpdates,
    }),
    [activities, updates]
  );

  return (
    <ActivityContext.Provider value={value}>
      {children}
    </ActivityContext.Provider>
  );
}

export function useGameActivity() {
  const ctx = useContext(ActivityContext);
  if (!ctx) {
    throw new Error(
      "useGameActivity must be used within GameActivityProvider"
    );
  }
  return ctx;
}
