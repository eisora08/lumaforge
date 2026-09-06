import { invoke } from "@tauri-apps/api/core";

type OverlayPosition = "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center";

function readOverlayPosition(): OverlayPosition {
  try {
    const raw = localStorage.getItem("lumaforge-settings");
    const settings = raw ? JSON.parse(raw) : {};
    const pos = settings.overlayNotificationPosition;
    const valid: OverlayPosition[] = ["top-right", "top-left", "bottom-right", "bottom-left", "top-center", "bottom-center"];
    return valid.includes(pos) ? pos : "top-right";
  } catch {
    return "top-right";
  }
}

const THEME_VAR_NAMES = [
  "--color-bg",
  "--color-text",
  "--color-muted",
  "--color-accent",
  "--surface-active-border",
  "--surface-active",
  "--surface-active-blur",
  "--surface-active-hover",
] as const;

function collectThemeVars(): Record<string, string> {
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const vars: Record<string, string> = {};
  for (const name of THEME_VAR_NAMES) {
    const val = computed.getPropertyValue(name).trim();
    if (val) vars[name] = val;
  }
  return vars;
}

export async function showSessionOverlay(event: {
  type: "launch" | "end";
  gameTitle: string;
  provider: string;
  imageUrl?: string;
  durationSeconds?: number;
}): Promise<boolean> {
  console.log(`[SESSION][OVERLAY] invoke start type=${event.type}`);
  try {
    const themeVars = collectThemeVars();
    const overlayPosition = readOverlayPosition();
    const durationMs = event.type === "launch" ? 3000 : 4000;
    await Promise.race([
      invoke("show_session_overlay", {
        sessionType: event.type,
        gameTitle: event.gameTitle,
        provider: event.provider,
        imageUrl: event.imageUrl ?? null,
        durationSeconds: event.durationSeconds ?? null,
        duration: durationMs,
        themeVars,
        overlayPosition,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("invoke timed out after 5s")), 5000),
      ),
    ]);
    console.log(`[SESSION][OVERLAY] invoke_resolved type=${event.type}`);
    return true;
  } catch (err) {
    console.warn("[SESSION][OVERLAY] invoke failed:", err);
    return false;
  }
}

function readSettings(): Record<string, any> {
  try {
    const raw = localStorage.getItem("lumaforge-settings");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function isSessionOverlayEnabled(): boolean {
  return readSettings().gameSessionOverlayEnabled === true;
}
