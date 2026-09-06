import { useEffect, useRef } from "react";
import { useSettings } from "../../context/SettingsContext";
import { achievementWatcherService, ACHIEVEMENT_WATCHER_ENABLED } from "../../services/achievementWatcherService";

// Module-level flag: once started at least once this session, never allow
// the watcher to be permanently torn down (only settings-change restart).
// NOTE: this only works when the module survives HMR — in dev mode, full
// page reloads reset it. That is acceptable.
let _sessionWatcherInitialized = false;

export default function AchievementWatcherInit() {
  const { settings } = useSettings();
  const prevSettingsRef = useRef({ steamRoot: "", steamAccountId: "", steamWebApiKey: "" });
  const startedRef = useRef(false);
  const disabledLoggedRef = useRef(false);

  useEffect(() => {
    if (!ACHIEVEMENT_WATCHER_ENABLED) {
      if (!disabledLoggedRef.current) {
        disabledLoggedRef.current = true;
        console.log("[ACH][WATCHER] not started reason=disabled-by-flag");
      }
      return;
    }

    // If already initialized and settings haven't changed, skip entirely
    const curr = {
      steamRoot: settings.steamRoot,
      steamAccountId: settings.steamAccountId,
      steamWebApiKey: settings.steamWebApiKey,
    };

    if (_sessionWatcherInitialized && startedRef.current) {
      const prev = prevSettingsRef.current;
      const settingsChanged =
        prev.steamRoot !== curr.steamRoot ||
        prev.steamAccountId !== curr.steamAccountId ||
        prev.steamWebApiKey !== curr.steamWebApiKey;
      if (!settingsChanged) {
        prevSettingsRef.current = curr;
        return;
      }
    }

    const prev = prevSettingsRef.current;
    prevSettingsRef.current = curr;

    const settingsChanged =
      prev.steamRoot !== curr.steamRoot ||
      prev.steamAccountId !== curr.steamAccountId ||
      prev.steamWebApiKey !== curr.steamWebApiKey;

    // Start or restart if settings changed or first mount
    if (
      curr.steamRoot &&
      curr.steamAccountId &&
      (!startedRef.current || settingsChanged)
    ) {
      if (settingsChanged && startedRef.current) {
        console.debug("[ACH][WATCHER] restarted reason=settings-changed");
      }
      startedRef.current = true;
      _sessionWatcherInitialized = true;
      // Don't await — fire and forget to avoid blocking render
      achievementWatcherService.start(curr.steamRoot, curr.steamAccountId, curr.steamWebApiKey);
    }

    // Stop if settings become invalid
    if (
      startedRef.current &&
      (!curr.steamRoot || !curr.steamAccountId)
    ) {
      console.debug("[ACH][WATCHER] stopped reason=settings-changed");
      startedRef.current = false;
      achievementWatcherService.stop();
    }
  }, [settings.steamRoot, settings.steamAccountId, settings.steamWebApiKey]);

  // Do NOT stop on unmount — watcher must stay alive in background
  // It only stops when settings change or the app closes

  return null;
}
