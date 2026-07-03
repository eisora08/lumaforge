import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

export async function sendAchievementNativeNotification(
  achievementName: string,
  gameTitle?: string,
): Promise<boolean> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }
    if (granted) {
      const body = gameTitle ? `${gameTitle} — ${achievementName}` : achievementName;
      sendNotification({ title: "Achievement Unlocked", body });
      return true;
    }
    return false;
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn("[ACH][NATIVE_NOTIF] failed", e);
    }
    return false;
  }
}
