import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { resolveImageSource } from "./achievementImageQueue";
import { resolveAchievementImagePath } from "./tauri";
import { DEBUG_ACH_VERBOSE } from "./achievementAutoFlags";

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
  if (import.meta.env.DEV && DEBUG_ACH_VERBOSE) {
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

async function tryResolveLocalCached(
  value: string | null | undefined,
  appId: string | null | undefined,
  isGray: boolean,
): Promise<string | null> {
  if (!value || !appId) return null;

  // Already browser-loadable — let caller handle it
  if (value.startsWith("data:") || value.startsWith("file://") || value.startsWith("asset://")) {
    return null;
  }

  let hash: string | null = null;

  // img/<hash>.jpg or img/<hash>_gray.jpg
  if (value.startsWith("img/")) {
    const m = value.match(/^img\/([a-f0-9]{40})(?:_gray)?\.jpg$/i);
    if (m) hash = m[1];
  }

  // Raw 40-char hex hash
  if (!hash && /^[a-f0-9]{40}$/i.test(value)) {
    hash = value;
  }

  if (hash) {
    const suffix = isGray ? "_gray" : "";
    const relativePath = `img/${hash}${suffix}.jpg`;
    try {
      const absPath = await resolveAchievementImagePath("steam", Number(appId), relativePath);
      const exists = await invoke<boolean>("file_exists", { path: absPath });
      if (exists) {
        const localUrl = convertFileSrc(absPath, "asset");
        console.log(`[ACH][OVERLAY_ICON_LOCAL] appid=${appId} path=${relativePath} exists=true`);
        return localUrl;
      }
    } catch {
      // fall through to fallback
    }
  }

  return null;
}

async function resolveOverlayIconUrl(
  iconUrl: string | null | undefined,
  iconGrayUrl: string | null | undefined,
  appId: string | null | undefined,
): Promise<string | null> {
  // Phase 1: Local cached files first
  const localIcon = await tryResolveLocalCached(iconUrl, appId, false);
  if (localIcon) return localIcon;

  const localGray = await tryResolveLocalCached(iconGrayUrl, appId, true);
  if (localGray) return localGray;

  // Phase 2: Remote/CDN fallback (existing synchronous logic)
  const tryResolve = (value: string | null | undefined): string | null => {
    if (!value) return null;

    if (
      value.startsWith("data:") ||
      value.startsWith("file://") ||
      value.startsWith("asset://") ||
      value.startsWith("http://") ||
      value.startsWith("https://")
    ) {
      return value;
    }

    if (value.startsWith("img/") && appId) {
      try {
        const resolved = resolveImageSource(value, appId, "icon");
        if (resolved?.sourceUrl) return resolved.sourceUrl;
      } catch {
        // fall through
      }
      const hash = value.replace("img/", "").replace(/\.jpg$/i, "");
      if (/^[a-f0-9]{32,40}$/i.test(hash)) {
        return `${STEAM_CDN}/${appId}/${hash}.jpg`;
      }
    }

    if (/^[a-f0-9]{40}$/i.test(value) && appId) {
      return `${STEAM_CDN}/${appId}/${value}.jpg`;
    }

    return null;
  };

  return tryResolve(iconUrl) ?? tryResolve(iconGrayUrl);
}

// ---------------------------------------------------------------------------
// Overlay command
// ---------------------------------------------------------------------------

export type OverlayPosition = "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center";

function readOverlayPosition(): OverlayPosition {
  const pos = readSettings().overlayNotificationPosition;
  const valid: OverlayPosition[] = ["top-right", "top-left", "bottom-right", "bottom-left", "top-center", "bottom-center"];
  return valid.includes(pos) ? pos : "top-right";
}

// ── Sequential toast queue ──
// Shows achievements one at a time instead of all at once
interface QueuedToast {
  name: string;
  description?: string | null;
  iconUrl?: string | null;
  iconGrayUrl?: string | null;
  appId?: string | null;
  rarity?: number | null;
  gameTitle?: string | null;
  duration?: number;
  isPlatinum?: boolean;
}

let _toastQueue: QueuedToast[] = [];
let _toastProcessing = false;

function getToastDuration(rarity?: number | null, isPlatinum?: boolean): number {
  if (isPlatinum) return 10000;
  if (rarity == null || !Number.isFinite(rarity) || rarity <= 0) return 4500;
  if (rarity <= 1) return 8000;
  if (rarity <= 5) return 6500;
  if (rarity <= 10) return 5500;
  return 4500;
}

async function processToastQueue(): Promise<void> {
  if (_toastProcessing || _toastQueue.length === 0) return;
  _toastProcessing = true;

  while (_toastQueue.length > 0) {
    const toast = _toastQueue.shift()!;
    const duration = toast.duration ?? getToastDuration(toast.rarity, toast.isPlatinum);
    await showAchievementOverlay({
      name: toast.name,
      description: toast.description,
      iconUrl: toast.iconUrl,
      iconGrayUrl: toast.iconGrayUrl,
      appId: toast.appId,
      rarity: toast.isPlatinum ? 100 : toast.rarity,
      gameTitle: toast.gameTitle,
      duration,
    });
    // Wait for the toast to display + extra gap before next
    await new Promise<void>((resolve) => setTimeout(resolve, duration + 500));
  }

  _toastProcessing = false;
}

/** Queue an achievement toast — shows one at a time sequentially */
export function queueAchievementOverlay(toast: QueuedToast): void {
  _toastQueue.push(toast);
  processToastQueue();
}

/** Show an achievement notification in the Tauri overlay window. */
export async function showAchievementOverlay(params: {
  name: string;
  description?: string | null;
  iconUrl?: string | null;
  appId?: string | null;
  rarity?: number | null;
  gameTitle?: string | null;
  duration?: number | null;
  iconGrayUrl?: string | null;
}): Promise<boolean> {
  const resolvedIcon = await resolveOverlayIconUrl(params.iconUrl ?? null, params.iconGrayUrl ?? null, params.appId ?? null);
  console.log(`[ACH][OVERLAY_ICON] appid=${params.appId ?? "?"} apiName=${params.name} input=${params.iconUrl ?? "(none)"} resolved=${resolvedIcon ?? "(none)"} source=${resolvedIcon?.startsWith("asset://") || resolvedIcon?.startsWith("http://asset.localhost") || resolvedIcon?.startsWith("https://asset.localhost") ? "local-cache" : resolvedIcon?.startsWith("http") ? "cdn" : resolvedIcon?.startsWith("file://") ? "file" : resolvedIcon?.startsWith("data:") ? "data" : resolvedIcon ? "asset" : "fallback"}`);
  try {
    const themeVars = collectThemeVars();
    const overlayPosition = readOverlayPosition();
    const invokePayload = {
      name: params.name,
      description: params.description ?? null,
      iconUrl: resolvedIcon,
      appId: params.appId ?? null,
      rarity: params.rarity ?? null,
      gameTitle: params.gameTitle ?? null,
      duration: params.duration ?? null,
      themeVars,
      overlayPosition,
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