import { useState, useEffect } from "react";
import { Settings, Loader2, CheckCircle2, AlertTriangle, Play, Wrench } from "lucide-react";

import {
  slssteamStatus,
  slssteamFullSetup,
  slssteamStartSteam,
  slssteamConfigGetAdditionalApps,
  SLSSteamStatus as SLSSteamStatusType,
} from "../../services/tauri";
import { showSuccess, showError } from "../toast/GameToast";

export default function SLSSteamStatusCard() {
  const [status, setStatus] = useState<SLSSteamStatusType | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingUp, setSettingUp] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [additionalApps, setAdditionalApps] = useState<string[]>([]);

  const refresh = async () => {
    setLoading(true);
    try {
      const s = await slssteamStatus();
      setStatus(s);
      if (s.installed) {
        const apps = await slssteamConfigGetAdditionalApps();
        setAdditionalApps(apps);
      }
    } catch (err) {
      console.warn("[SLSSteam] Failed to get status:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleSetup = async () => {
    setSettingUp(true);
    try {
      const msg = await slssteamFullSetup();
      showSuccess(msg);
      await refresh();
    } catch (err) {
      showError(String(err));
    } finally {
      setSettingUp(false);
    }
  };

  const handleStartSteam = async () => {
    setLaunching(true);
    try {
      const result = await slssteamStartSteam();
      if (result.success) {
        showSuccess(result.message);
      } else {
        showError(result.message);
      }
    } catch (err) {
      showError(String(err));
    } finally {
      setLaunching(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-neutral-800/50 text-neutral-400 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Checking SLS Steam status...</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-neutral-800/50 text-neutral-400 text-sm">
        <AlertTriangle className="h-4 w-4" />
        <span>Could not detect SLS Steam status</span>
      </div>
    );
  }

  const isLinux = status.steamInstallType !== undefined;

  if (!isLinux) {
    return null; // SLS Steam is Linux-only, hide on other platforms
  }

  return (
    <div className="rounded-lg border border-neutral-700/50 bg-neutral-800/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-neutral-400" />
          <span className="text-sm font-medium text-neutral-200">SLS Steam</span>
        </div>
        {status.installed ? (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            Installed
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-yellow-400">
            <AlertTriangle className="h-3 w-3" />
            Not installed
          </span>
        )}
      </div>

      <div className="text-xs text-neutral-500 space-y-1">
        <div>Steam: {status.steamPath || "(not found)"}</div>
        <div>Type: {status.steamInstallType || "unknown"}</div>
        <div>SLSsteam.so: {status.slssteamSoPath || "(missing)"}</div>
        <div>library-inject.so: {status.libraryInjectSoPath || "(missing)"}</div>
        <div>Config: {status.configExists ? "exists" : "missing"}</div>
        {additionalApps.length > 0 && (
          <div>Games in config: {additionalApps.length}</div>
        )}
      </div>

      <div className="flex gap-2">
        {!status.installed ? (
          <span className="text-xs text-neutral-500">
            Install SLS Steam from Settings &gt; Integrations &gt; Third-Party Tools
          </span>
        ) : (
          <>
            <button
              onClick={handleSetup}
              disabled={settingUp}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-blue-600/20 text-blue-400 text-xs hover:bg-blue-600/30 transition-colors disabled:opacity-50"
            >
              {settingUp ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
              Setup
            </button>
            <button
              onClick={handleStartSteam}
              disabled={launching}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-green-600/20 text-green-400 text-xs hover:bg-green-600/30 transition-colors disabled:opacity-50"
            >
              {launching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Start Steam with SLS
            </button>
          </>
        )}
      </div>
    </div>
  );
}
