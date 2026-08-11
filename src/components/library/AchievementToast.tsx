import { Toast, toast } from "react-hot-toast";
import type { UnlockEvent } from "../../types/gameAchievements";
import { AchievementToastBody, GroupedAchievementToastBody } from "./AchievementToastBody";

export const ACHIEVEMENT_TOAST_DURATION = 4500;
export const ACHIEVEMENT_TOAST_EXIT_DURATION = 180;

type AchievementToastProps = {
  t: Toast;
  event: UnlockEvent;
  appId?: string;
  gameTitle?: string;
};

// Session-level dedup: prevent same achievement from showing twice
let _shownThisSession = new Set<string>();

function getToastDuration(rarityPercent?: number): number {
  if (rarityPercent == null || !Number.isFinite(rarityPercent) || rarityPercent <= 0) {
    return 4500; // Normal
  }
  if (rarityPercent <= 1) return 8000;  // Ultra rare (gold)
  if (rarityPercent <= 5) return 6500;  // Rare (silver)
  if (rarityPercent <= 10) return 5500; // Uncommon (bronze)
  return 4500; // Normal
}

export function showAchievementToast(event: UnlockEvent, appId?: string, gameTitle?: string) {
  // Dedup by appId:apiName key
  const key = `${appId ?? "unknown"}:${event.apiName}`;
  if (_shownThisSession.has(key)) return;
  _shownThisSession.add(key);
  // Auto-cleanup after 5 minutes to prevent memory leak in long sessions
  setTimeout(() => _shownThisSession.delete(key), 5 * 60 * 1000);

  const duration = getToastDuration(event.rarityPercent);

  toast.custom(
    (t) => <AchievementToastComponent t={t} event={event} appId={appId} gameTitle={gameTitle} />,
    { duration, position: "bottom-right" },
  );
  if (import.meta.env.DEV) {
    const hasIcon = !!event.iconUrl;
    const hasGrayIcon = !!event.iconGrayUrl;
    console.debug(`[ACH][TOAST] show apiName=${event.apiName} rarity=${event.rarityPercent ?? "none"} duration=${duration}ms hasIconUrl=${hasIcon} hasIconGrayUrl=${hasGrayIcon}`);
    if (!hasIcon && !hasGrayIcon) {
      console.debug(`[ACH][TOAST] missing icon apiName=${event.apiName}`);
    }
  }
}

export function showGroupedAchievementToast(count: number) {
  toast.custom(
    (t) => <GroupedToast t={t} count={count} />,
    { duration: ACHIEVEMENT_TOAST_DURATION, position: "bottom-right" },
  );
  if (import.meta.env.DEV) {
    console.debug(`[ACH][TOAST] grouped count=${count}`);
  }
}

export function showTestAchievementToast(gameTitle?: string) {
  const testEvent: UnlockEvent = {
    apiName: "test_achievement",
    name: "Test Achievement",
    description: "This is a test achievement description to verify the premium toast layout.",
    iconUrl: undefined,
    iconGrayUrl: undefined,
    unlockTime: Date.now(),
    rarityPercent: 31.1,
  };
  showAchievementToast(testEvent, undefined, gameTitle);
}

function AchievementToastComponent({ t, event, appId, gameTitle }: AchievementToastProps) {
  return (
    <AchievementToastBody
      event={event}
      appId={appId}
      gameTitle={gameTitle}
      visible={t.visible}
      onClose={() => toast.dismiss(t.id)}
    />
  );
}

function GroupedToast({ t, count }: { t: Toast; count: number }) {
  return (
    <GroupedAchievementToastBody
      count={count}
      visible={t.visible}
      onClose={() => toast.dismiss(t.id)}
    />
  );
}
