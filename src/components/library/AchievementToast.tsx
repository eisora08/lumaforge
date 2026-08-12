import { Toast, toast } from "react-hot-toast";
import type { UnlockEvent } from "../../types/gameAchievements";
import { AchievementToastBody, MultiAchievementStrip } from "./AchievementToastBody";

export const ACHIEVEMENT_TOAST_DURATION = 4500;
export const ACHIEVEMENT_TOAST_EXIT_DURATION = 180;
const PLATINUM_TOAST_DURATION = 8000;

type AchievementToastProps = {
  t: Toast;
  event: UnlockEvent;
  appId?: string;
  gameTitle?: string;
};

type MultiToastProps = {
  t: Toast;
  unlocks: UnlockEvent[];
  appId?: string;
  gameTitle?: string;
};

// Session-level dedup: prevent same achievement from showing twice
let _shownThisSession = new Set<string>();

function getToastDuration(rarityPercent?: number, isPlatinum?: boolean): number {
  if (isPlatinum) return PLATINUM_TOAST_DURATION;
  if (rarityPercent == null || !Number.isFinite(rarityPercent) || rarityPercent <= 0) {
    return 4500;
  }
  if (rarityPercent <= 1) return 8000;
  if (rarityPercent <= 5) return 6500;
  if (rarityPercent <= 10) return 5500;
  return 4500;
}

export function showAchievementToast(event: UnlockEvent, appId?: string, gameTitle?: string) {
  const key = `${appId ?? "unknown"}:${event.apiName}`;
  if (_shownThisSession.has(key)) return;
  _shownThisSession.add(key);
  setTimeout(() => _shownThisSession.delete(key), 5 * 60 * 1000);

  const duration = getToastDuration(event.rarityPercent, event.isPlatinum);

  toast.custom(
    (t) => <AchievementToastComponent t={t} event={event} appId={appId} gameTitle={gameTitle} />,
    { duration, position: "bottom-right" },
  );
}

export function showGroupedAchievementToast(unlocks: UnlockEvent[], appId?: string, gameTitle?: string) {
  const maxDuration = unlocks.reduce((max, u) => Math.max(max, getToastDuration(u.rarityPercent, u.isPlatinum)), 4500);
  toast.custom(
    (t) => <MultiToastComponent t={t} unlocks={unlocks} appId={appId} gameTitle={gameTitle} />,
    { duration: maxDuration, position: "bottom-right" },
  );
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

function MultiToastComponent({ t, unlocks, appId, gameTitle }: MultiToastProps) {
  return (
    <MultiAchievementStrip
      unlocks={unlocks}
      appId={appId}
      gameTitle={gameTitle}
      visible={t.visible}
      onClose={() => toast.dismiss(t.id)}
    />
  );
}
