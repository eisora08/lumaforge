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

export function showAchievementToast(event: UnlockEvent, appId?: string, gameTitle?: string) {
  toast.custom(
    (t) => <AchievementToastComponent t={t} event={event} appId={appId} gameTitle={gameTitle} />,
    { duration: ACHIEVEMENT_TOAST_DURATION, position: "bottom-right" },
  );
  if (import.meta.env.DEV) {
    const hasIcon = !!event.iconUrl;
    const hasGrayIcon = !!event.iconGrayUrl;
    console.debug(`[ACH][TOAST] show apiName=${event.apiName} hasIconUrl=${hasIcon} hasIconGrayUrl=${hasGrayIcon}`);
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
