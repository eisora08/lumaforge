import { useMemo } from "react";
import { useSettings } from "../context/SettingsContext";
import {
  playNavigateSound,
  playSelectSound,
  playLaunchSound,
  playEntrySound,
} from "../services/soundEffectsService";

export function useSoundEffects() {
  const { settings } = useSettings();

  return useMemo(
    () => ({
      playNavigate: playNavigateSound,
      playSelect: playSelectSound,
      playLaunch: playLaunchSound,
      playEntry: playEntrySound,
      enabled: settings.soundEffectsEnabled,
      volume: settings.soundEffectsVolume,
    }),
    [settings.soundEffectsEnabled, settings.soundEffectsVolume]
  );
}
