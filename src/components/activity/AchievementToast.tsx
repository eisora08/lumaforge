import type { AchievementDef } from "../../features/activity/types";
import { playAchievementSound } from "../../features/activity/achievements/achievementSound";
import { fireCompletionConfetti } from "../../features/activity/achievements/completionConfetti";
import { getPlayerProfile } from "../../features/activity/achievements/achievementStore";
import { pulseAmbientRarity } from "../../services/ambientBackgroundStore";
import { queueAchievementOverlay } from "../../services/achievementNotificationService";

const SETTINGS_KEY = "lumaforge-settings";

function isOverlayEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.launcherAchievementOverlayEnabled === "boolean") {
        return parsed.launcherAchievementOverlayEnabled;
      }
    }
  } catch { /* ignore */ }
  return true; // default enabled
}

const RARITY_TO_NUMBER: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 5,
  epic: 15,
  legendary: 31,
};

let _shownThisSession = new Set<string>();

export function showAchievementToast(achievement: AchievementDef, duration = 4000): void {
  if (_shownThisSession.has(achievement.id)) return;
  _shownThisSession.add(achievement.id);

  // Always play sound + ambient pulse
  playAchievementSound(achievement.rarity);
  pulseAmbientRarity(achievement.rarity);

  // Route to Tauri overlay window when enabled
  if (isOverlayEnabled()) {
    queueAchievementOverlay({
      name: achievement.title,
      description: `${achievement.description} — +${achievement.xp} XP`,
      iconUrl: null,
      appId: null,
      rarity: RARITY_TO_NUMBER[achievement.rarity] ?? 0,
      gameTitle: null,
      duration,
    });
  }
  // When overlay disabled → silent (sound + pulse already fired)
}

export function showAchievementToasts(achievements: AchievementDef[], delay = 600): void {
  achievements.forEach((ach, i) => {
    setTimeout(() => showAchievementToast(ach), i * delay);
  });

  // Check for 100% completion after all toasts fire
  if (achievements.length > 0) {
    const lastDelay = achievements.length * delay + 500;
    setTimeout(() => {
      const profile = getPlayerProfile();
      if (profile.unlockedCount >= profile.totalCount && profile.totalCount > 0) {
        fireCompletionConfetti();
      }
    }, lastDelay);
  }
}

export function resetAchievementToastDedup(): void {
  _shownThisSession.clear();
}

/**
 * Kept for backward compatibility — returns null since launcher achievements
 * now use the Tauri overlay window instead of react-hot-toast.
 */
export function AchievementToastViewport() {
  return null;
}

// Dev console helper — cycles through launcher achievements for overlay testing
if (typeof window !== "undefined") {
  let _testCounter = 0;
  (window as any).__testLauncherAchievement = () => {
    const defs = [
      { id: "test-launcher", title: "First Launch", description: "Launch any game for the first time", category: "play" as const, rarity: "common" as const, xp: 10, icon: null as any },
      { id: "test-launcher-2", title: "Collector", description: "Add 50 games to your library", category: "library" as const, rarity: "uncommon" as const, xp: 50, icon: null as any },
      { id: "test-launcher-3", title: "Backlog Slayer", description: "Complete 10 games", category: "completion" as const, rarity: "rare" as const, xp: 200, icon: null as any },
      { id: "test-launcher-4", title: "Quarterly Commitment", description: "Maintain a 90-day play streak", category: "streak" as const, rarity: "epic" as const, xp: 300, icon: null as any },
      { id: "test-launcher-5", title: "Year of Gaming", description: "Maintain a 365-day play streak", category: "streak" as const, rarity: "legendary" as const, xp: 1000, icon: null as any },
    ];
    const def = defs[_testCounter % defs.length];
    _testCounter++;
    _shownThisSession.delete(def.id);
    showAchievementToast(def, 5000);
  };
  (window as any).__testCompletionConfetti = () => fireCompletionConfetti();
}
