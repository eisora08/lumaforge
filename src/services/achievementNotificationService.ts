import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { resolveImageSource } from "./achievementImageQueue";

const THEME_VAR_NAMES = [
  "--color-bg",
  "--color-text",
  "--color-muted",
  "--color-accent",
  "--surface-active-border",
  "--surface-active",
] as const;

type ThemeVars = Record<string, string>;

function collectThemeVars(): ThemeVars {
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const vars: ThemeVars = {};
  for (const name of THEME_VAR_NAMES) {
    const val = computed.getPropertyValue(name).trim();
    if (val) {
      vars[name] = val;
    }
  }
  if (import.meta.env.DEV) {
    const themeId = root.dataset.theme || "unknown";
    const surfaceStyle = root.dataset.surface || "unknown";
    console.debug(`[ACH][OVERLAY_THEME] themeId=${themeId} surfaceStyle=${surfaceStyle}`);
    console.debug(`[ACH][OVERLAY_THEME_VARS] bg=${vars["--color-bg"]} text=${vars["--color-text"]} muted=${vars["--color-muted"]} accent=${vars["--color-accent"]} border=${vars["--surface-active-border"]}`);
  }
  return vars;
}

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

// ---------------------------------------------------------------------------
// Settings helpers (no React context needed)
// ---------------------------------------------------------------------------

const SETTINGS_KEY = "lumaforge-settings";

function readSettings(): Record<string, any> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function isSettingEnabled(key: string): boolean {
  return readSettings()[key] === true;
}

// ---------------------------------------------------------------------------
// Icon resolution for overlay (isolated window cannot resolve relative img/ paths)
// ---------------------------------------------------------------------------

const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps";

function resolveOverlayIconUrl(
  iconUrl: string | null | undefined,
  iconGrayUrl: string | null | undefined,
  appId: string | null | undefined,
): string | null {
  const tryResolve = (value: string | null | undefined): string | null => {
    if (!value) return null;

    // Already absolute and browser-loadable
    if (
      value.startsWith("data:") ||
      value.startsWith("file://") ||
      value.startsWith("asset://") ||
      value.startsWith("http://") ||
      value.startsWith("https://")
    ) {
      return value;
    }

    // Relative img/ path — resolve via image queue or CDN fallback
    if (value.startsWith("img/") && appId) {
      try {
        const resolved = resolveImageSource(value, appId, "icon");
        if (resolved?.sourceUrl) return resolved.sourceUrl;
      } catch {
        // fall through
      }
      // Direct CDN fallback: extract hash from img/<hash>.jpg
      const hash = value.replace("img/", "").replace(/\.jpg$/i, "");
      if (/^[a-f0-9]{32,40}$/i.test(hash)) {
        return `${STEAM_CDN}/${appId}/${hash}.jpg`;
      }
    }

    // Raw steam hash (40 hex chars)
    if (/^[a-f0-9]{40}$/i.test(value) && appId) {
      return `${STEAM_CDN}/${appId}/${value}.jpg`;
    }

    return null;
  };

  // Try icon first, then iconGray, then null
  const result = tryResolve(iconUrl) ?? tryResolve(iconGrayUrl);
  return result;
}

// ---------------------------------------------------------------------------
// Overlay command
// ---------------------------------------------------------------------------

/** Show an achievement notification in the Tauri overlay window. */
export async function showAchievementOverlay(params: {
  name: string;
  iconUrl?: string | null;
  appId?: string | null;
  rarity?: number | null;
  gameTitle?: string | null;
  duration?: number | null;
  iconGrayUrl?: string | null;
}): Promise<boolean> {
  const resolvedIcon = resolveOverlayIconUrl(params.iconUrl ?? null, params.iconGrayUrl ?? null, params.appId ?? null);
  console.log(`[ACH][OVERLAY_ICON] apiName=${params.name} input=${params.iconUrl ?? "(none)"} resolved=${resolvedIcon ?? "(none)"} fallback=${!resolvedIcon ? "trophy" : "none"}`);
  try {
    const themeVars = collectThemeVars();
    const invokePayload = {
      name: params.name,
      iconUrl: resolvedIcon,
      appId: params.appId ?? null,
      rarity: params.rarity ?? null,
      gameTitle: params.gameTitle ?? null,
      duration: params.duration ?? null,
      themeVars,
    };
    await Promise.race([
      invoke("show_achievement_overlay", invokePayload),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("invoke timed out after 5s")), 5000),
      ),
    ]);
    return true;
  } catch (err) {
    console.warn("[ACH][OVERLAY] invoke failed:", err);
    return false;
  }
}

/** Show a grouped achievement notification in the overlay window. */
export async function showGroupedAchievementOverlay(count: number): Promise<boolean> {
  return showAchievementOverlay({
    name: `+${count} more`,
    iconUrl: null,
    appId: null,
    rarity: null,
    gameTitle: null,
  });
}

/**
 * Forced low-level overlay test.
 *
 * Bypasses all notification settings (`achievementOverlayNotificationsEnabled`,
 * `achievementToastEnabled`, `achievementNativeNotificationsEnabled`) and
 * directly invokes the overlay window. Use this to verify the overlay
 * infrastructure works, regardless of the user's notification preferences.
 */
export async function showTestAchievementOverlay(): Promise<void> {
  console.log("[ACH][OVERLAY_FORCED] test start");
  const payload = {
    name: "Test Achievement",
    iconUrl: "img/0123456789abcdef0123456789abcdef01234567.jpg",
    appId: "480",
    rarity: 31.1,
    gameTitle: "LumaForge",
    duration: 4500,
  };
  console.log("[ACH][OVERLAY_FORCED] payload=" + JSON.stringify(payload));
  console.log("[ACH][OVERLAY_FORCED] calling showAchievementOverlay");
  const ok = await showAchievementOverlay(payload);
  console.log(`[ACH][OVERLAY_FORCED] result=overlay_${ok ? "shown" : "failed"}`);
}

/**
 * Settings-aware notification test.
 *
 * Follows the user's current notification preferences exactly:
 * - achievementToastEnabled → in-app toast
 * - achievementOverlayNotificationsEnabled → overlay window
 * - achievementNativeNotificationsEnabled → OS notification
 *
 * Useful for verifying the full settings pipeline end-to-end.
 */
export async function showTestAchievementNotification(): Promise<void> {
  const overlayEnabled = isSettingEnabled("achievementOverlayNotificationsEnabled");
  const toastEnabled = isSettingEnabled("achievementToastEnabled");
  const nativeEnabled = isSettingEnabled("achievementNativeNotificationsEnabled");

  console.log("[ACH][NOTIFY_TEST] start");
  console.log("[ACH][NOTIFY_TEST] settings overlay=" + overlayEnabled + " toast=" + toastEnabled + " native=" + nativeEnabled);

  if (!overlayEnabled && !toastEnabled && !nativeEnabled) {
    console.log("[ACH][NOTIFY_TEST] skipped reason=all-visual-notifications-disabled");
    return;
  }

  if (overlayEnabled) {
    const payload = {
      name: "Test Achievement",
      iconUrl: "img/0123456789abcdef0123456789abcdef01234567.jpg",
      appId: "480",
      rarity: 31.1,
      gameTitle: "LumaForge",
      duration: 4500,
    };
    console.log("[ACH][NOTIFY_TEST] overlay_payload=" + JSON.stringify(payload));
    console.log("[ACH][NOTIFY_TEST] calling showAchievementOverlay");
    const ok = await showAchievementOverlay(payload);
    console.log("[ACH][NOTIFY_TEST] overlay_result=" + (ok ? "shown" : "failed"));
    if (!ok && toastEnabled) {
      console.log("[ACH][NOTIFY_TEST] overlay failed, falling back to in-app toast");
      const { showTestAchievementToast } = await import("../components/library/AchievementToast");
      showTestAchievementToast("LumaForge");
    } else if (!ok) {
      console.log("[ACH][NOTIFY_TEST] overlay failed, no fallback (toast disabled)");
    }
  } else if (toastEnabled) {
    console.log("[ACH][NOTIFY_TEST] using in-app toast (overlay disabled)");
    const { showTestAchievementToast } = await import("../components/library/AchievementToast");
    showTestAchievementToast("LumaForge");
  }

  if (nativeEnabled) {
    console.log("[ACH][NOTIFY_TEST] sending native notification");
    await sendAchievementNativeNotification("Test Achievement", "LumaForge");
    console.log("[ACH][NOTIFY_TEST] native notification sent");
  }

  console.log("[ACH][NOTIFY_TEST] end");
}

// Dev console helpers
if (typeof window !== "undefined") {
  (window as any).__testAchievementOverlay = showTestAchievementOverlay;
  (window as any).__testAchievementNotification = showTestAchievementNotification;
}
