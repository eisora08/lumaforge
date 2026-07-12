let _fullscreenEnabled = false;

const DEBUG_FULLSCREEN = false;

function log(...args: unknown[]) {
  if (DEBUG_FULLSCREEN) console.log("[WINDOW_MODE]", ...args);
}

export async function setAppFullscreen(enabled: boolean): Promise<void> {
  if (_fullscreenEnabled === enabled) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.setFullscreen(enabled);
    _fullscreenEnabled = enabled;
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
