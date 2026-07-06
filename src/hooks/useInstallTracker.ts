import { useEffect, useState, useCallback } from "react";
import { installTrackerService, type InstallState } from "../services/installTrackingService";

const IDLE_STATE: InstallState = {
  appId: "",
  status: "idle",
  elapsedMs: 0,
  startedAt: 0,
  downloadProgress: null,
};

export function useInstallTracker(appId: string | undefined): {
  installState: InstallState;
  isInstalling: boolean;
  isWaiting: boolean;
  startTracking: (steamRoot?: string | null) => void;
  dismiss: () => void;
} {
  const [state, setState] = useState<InstallState>(() => {
    if (!appId) return IDLE_STATE;
    return installTrackerService.getState(appId) ?? IDLE_STATE;
  });

  useEffect(() => {
    if (!appId) {
      setState(IDLE_STATE);
      return;
    }
    const current = installTrackerService.getState(appId);
    if (current) setState(current);
    return installTrackerService.subscribe(appId, setState);
  }, [appId]);

  const startTracking = useCallback((steamRoot?: string | null) => {
    if (!appId) return;
    installTrackerService.startTracking(appId, steamRoot);
  }, [appId]);

  const dismiss = useCallback(() => {
    if (!appId) return;
    installTrackerService.dismiss(appId);
  }, [appId]);

  const isInstalling = state.status === "opening-steam" || state.status === "waiting";
  const isWaiting = state.status === "waiting";

  return { installState: state, isInstalling, isWaiting, startTracking, dismiss };
}
