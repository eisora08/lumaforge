import type { AchievementUnlock, PlayerXpEvent, PlayerProfile } from "../types";
import { ACHIEVEMENT_DEFINITIONS, TOTAL_XP_AVAILABLE } from "./achievementDefinitions";

const DEBUG_ACH_STORE = false;
const STORAGE_KEY = "lumaforge-launcher-achievements-v1";
const XP_STORAGE_KEY = "lumaforge-launcher-xp-v1";

type AchievementStoreData = {
  version: number;
  unlocks: AchievementUnlock[];
};

type XpStoreData = {
  version: number;
  events: PlayerXpEvent[];
};

// ─── Persistence ──────────────────────────────────────────────────────

function loadAchievementStore(): AchievementStoreData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AchievementStoreData;
      if (parsed && Array.isArray(parsed.unlocks)) return parsed;
    }
  } catch { /* ignore */ }
  return { version: 1, unlocks: [] };
}

function saveAchievementStore(data: AchievementStoreData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* storage full */ }
}

function loadXpStore(): XpStoreData {
  try {
    const raw = localStorage.getItem(XP_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as XpStoreData;
      if (parsed && Array.isArray(parsed.events)) return parsed;
    }
  } catch { /* ignore */ }
  return { version: 1, events: [] };
}

function saveXpStore(data: XpStoreData): void {
  try {
    localStorage.setItem(XP_STORAGE_KEY, JSON.stringify(data));
  } catch { /* storage full */ }
}

// ─── Module state ─────────────────────────────────────────────────────

let _store = loadAchievementStore();
let _xpStore = loadXpStore();
let _unlockedIds = new Set(_store.unlocks.map((u) => u.achievementId));

type StoreListener = () => void;
const _listeners = new Set<StoreListener>();

function notify(): void {
  _listeners.forEach((fn) => fn());
}

export function subscribeAchievementStore(fn: StoreListener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

// ─── Activity event hook (avoids React context circular dep) ──────────

type UnlockCallback = (achievementId: string, title: string, xp: number, rarity: string) => void;
let _onUnlockCallback: UnlockCallback | null = null;

export function setAchievementUnlockCallback(cb: UnlockCallback | null): void {
  _onUnlockCallback = cb;
}

// ─── Unlocks ──────────────────────────────────────────────────────────

export function getUnlockedIds(): ReadonlySet<string> {
  return _unlockedIds;
}

export function isUnlocked(achievementId: string): boolean {
  return _unlockedIds.has(achievementId);
}

export function getUnlocks(): AchievementUnlock[] {
  return _store.unlocks;
}

export function getUnlock(achievementId: string): AchievementUnlock | undefined {
  return _store.unlocks.find((u) => u.achievementId === achievementId);
}

/**
 * Unlock an achievement. Idempotent — calling twice does not award XP again.
 * Returns true if newly unlocked, false if already unlocked.
 */
export function unlockAchievement(achievementId: string): boolean {
  if (_unlockedIds.has(achievementId)) {
    if (DEBUG_ACH_STORE) console.log(`[LF_XP][SKIP_ALREADY_UNLOCKED] id=${achievementId}`);
    return false;
  }

  const def = ACHIEVEMENT_DEFINITIONS.find((a) => a.id === achievementId);
  if (!def) {
    if (DEBUG_ACH_STORE) console.log(`[LF_XP][UNKNOWN_ACHIEVEMENT] id=${achievementId}`);
    return false;
  }

  const now = Date.now();
  const unlock: AchievementUnlock = {
    achievementId,
    unlockedAt: now,
    xpAwarded: def.xp,
  };

  _store.unlocks.push(unlock);
  _unlockedIds.add(achievementId);
  saveAchievementStore(_store);

  if (DEBUG_ACH_STORE) console.log(`[LF_XP][UNLOCK] id=${achievementId} title="${def.title}" xp=${def.xp} rarity=${def.rarity}`);

  // Award XP
  addXpEvent({
    id: `xp-ach-${achievementId}-${now}`,
    source: "achievement",
    amount: def.xp,
    timestamp: now,
    label: `Achievement: ${def.title}`,
    refId: achievementId,
  });

  // Emit activity event (non-React, callback registered by GameActivityContext)
  if (_onUnlockCallback) {
    _onUnlockCallback(achievementId, def.title, def.xp, def.rarity);
  }

  notify();
  return true;
}

/**
 * Batch unlock multiple achievements. Returns IDs of newly unlocked ones.
 */
export function unlockAchievements(ids: string[]): string[] {
  const newlyUnlocked: string[] = [];
  for (const id of ids) {
    if (unlockAchievement(id)) {
      newlyUnlocked.push(id);
    }
  }
  return newlyUnlocked;
}

// ─── XP ───────────────────────────────────────────────────────────────
// TODO: Duration-based XP (awarding XP proportional to session length) is
// intentionally disabled. Implementing it before the playtime store dedup
// is guaranteed would allow double-awards (session history + playtime store
// both counting the same play). Enable only after a single authoritative
// playtime source is enforced across all consumers.

function addXpEvent(event: PlayerXpEvent): void {
  _xpStore.events.push(event);
  saveXpStore(_xpStore);
  if (DEBUG_ACH_STORE) console.log(`[LF_XP][ADD_EVENT] source=${event.source} amount=${event.amount} label="${event.label}"`);
}

export function getTotalXp(): number {
  const total = _xpStore.events.reduce((sum, e) => sum + e.amount, 0);
  if (DEBUG_ACH_STORE) console.log(`[LF_XP][TOTAL_XP] events=${_xpStore.events.length} totalXp=${total}`);
  return total;
}

export function getXpEvents(): PlayerXpEvent[] {
  return _xpStore.events;
}

export function getRecentXpEvents(limit = 10): PlayerXpEvent[] {
  return [..._xpStore.events].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

// ─── Level calculation ────────────────────────────────────────────────
// Formula: level = floor(sqrt(totalXp / 100)) + 1
// Threshold: level N requires (N-1)^2 * 100 XP

const XP_PER_LEVEL_BASE = 100;

export function computeLevel(totalXp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPercent: number;
} {
  const level = Math.floor(Math.sqrt(totalXp / XP_PER_LEVEL_BASE)) + 1;
  const currentLevelThreshold = (level - 1) * (level - 1) * XP_PER_LEVEL_BASE;
  const nextLevelThreshold = level * level * XP_PER_LEVEL_BASE;
  const currentLevelXp = totalXp - currentLevelThreshold;
  const nextLevelXp = nextLevelThreshold - currentLevelThreshold;
  const progressPercent = nextLevelXp > 0 ? Math.min(100, (currentLevelXp / nextLevelXp) * 100) : 100;
  return { level, currentLevelXp, nextLevelXp, progressPercent };
}

// ─── Player profile ───────────────────────────────────────────────────

export function getPlayerProfile(): PlayerProfile {
  const totalXp = getTotalXp();
  const { level, currentLevelXp, nextLevelXp, progressPercent } = computeLevel(totalXp);
  return {
    totalXp,
    level,
    currentLevelXp,
    nextLevelXp,
    progressPercent,
    unlockedCount: _store.unlocks.length,
    totalCount: ACHIEVEMENT_DEFINITIONS.length,
    xpAvailable: TOTAL_XP_AVAILABLE,
  };
}

// ─── Stats helpers ────────────────────────────────────────────────────

export function getCategoryProgress(category: string): { unlocked: number; total: number } {
  const defs = ACHIEVEMENT_DEFINITIONS.filter((a) => a.category === category);
  const unlocked = defs.filter((a) => _unlockedIds.has(a.id)).length;
  return { unlocked, total: defs.length };
}

export function getRarityProgress(rarity: string): { unlocked: number; total: number } {
  const defs = ACHIEVEMENT_DEFINITIONS.filter((a) => a.rarity === rarity);
  const unlocked = defs.filter((a) => _unlockedIds.has(a.id)).length;
  return { unlocked, total: defs.length };
}
