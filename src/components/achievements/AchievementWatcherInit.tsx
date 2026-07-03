import { useEffect, useRef } from "react";
import { useSettings } from "../../context/SettingsContext";
import { achievementWatcherService } from "../../services/achievementWatcherService";

export default function AchievementWatcherInit() {
  const { settings } = useSettings();
  const prevSettingsRef = useRef({ steamRoot: "", steamAccountId: "" });
  const startedRef = useRef(false);

  useEffect(() => {
    const prev = prevSettingsRef.current;
    const curr = {
      steamRoot: settings.steamRoot,
      steamAccountId: settings.steamAccountId,
    };
    prevSettingsRef.current = curr;

    const settingsChanged =
      prev.steamRoot !== curr.steamRoot ||
      prev.steamAccountId !== curr.steamAccountId;

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
      achievementWatcherService.start(curr.steamRoot, curr.steamAccountId);
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
  }, [settings.steamRoot, settings.steamAccountId]);

  // Do NOT stop on unmount — watcher must stay alive in background
  // It only stops when settings change or the app closes

  return null;
}
