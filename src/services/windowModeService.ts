const DEBUG_FULLSCREEN = false;

function log(...args: unknown[]) {
  if (DEBUG_FULLSCREEN) console.log("[WINDOW_MODE]", ...args);
}

export async function setAppFullscreen(enabled: boolean): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    // Always call setFullscreen — do NOT short-circuit based on cached state,
    // because external OS actions (Win+Up, snap, etc.) can desync the cache.
    await win.setFullscreen(enabled);
    log(enabled ? "fullscreen ON" : "fullscreen OFF");
  } catch (err) {
    console.warn("[WINDOW_MODE] setAppFullscreen failed:", err);
  }
}

export async function isAppFullscreen(): Promise<boolean> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    return await win.isFullscreen();
  } catch (err) {
    console.warn("[WINDOW_MODE] isAppFullscreen failed:", err);
    return false;
  }
}

export async function toggleAppFullscreen(): Promise<boolean> {
  const current = await isAppFullscreen();
  await setAppFullscreen(!current);
  return !current;
}
