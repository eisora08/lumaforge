import { useState, useEffect, useCallback } from "react";
import {
  FolderOpen,
  Plus,
  Trash2,
  Loader2,
  Search,
  Cpu,
} from "lucide-react";
import { pickFolder } from "../../services/tauri";
import { showSuccess, showError, showWarning } from "../toast/GameToast";
import {
  getAllConfigs,
  saveConfig,
  removeConfig,
  detectAndLoadAndStore,
  autoGenerateSchema,
} from "../../services/nonSteamAchievementService";
import type { NonSteamAchievementConfig, NonSteamDetectionResult } from "../../services/tauri";

const SOURCE_LABELS: Record<string, string> = {
  goldberg: "Goldberg Emulator",
  codex: "CODEX / RUNE",
  onlinefix: "OnlineFix",
  manual: "Manual",
};

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "goldberg", label: "Goldberg Emulator" },
  { value: "codex", label: "CODEX / RUNE" },
  { value: "onlinefix", label: "OnlineFix" },
];

export default function NonSteamAchievementsSection() {
  const [configs, setConfigs] = useState<NonSteamAchievementConfig[]>([]);
  const [adding, setAdding] = useState(false);
  const [newGameDir, setNewGameDir] = useState("");
  const [newAppId, setNewAppId] = useState("");
  const [newSource, setNewSource] = useState("auto");
  const [newSavePath, setNewSavePath] = useState("");
  const [detecting, setDetecting] = useState<string | null>(null);
  const [generating, setGenerating] = useState<number | null>(null);
  const [detectionResults, setDetectionResults] = useState<Record<string, NonSteamDetectionResult>>({});
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);

  const loadConfigs = useCallback(async () => {
    try {
      const all = await getAllConfigs();
      setConfigs(all);
    } catch (e) {
      console.error("[NON_STEAM_ACH][SETTINGS_LOAD_ERROR]", e);
    }
  }, []);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const handleDetect = useCallback(async (config: NonSteamAchievementConfig) => {
    setDetecting(config.gameDir);
    try {
      const summary = await detectAndLoadAndStore(config.appId, config.gameDir);
      // Refresh local detection results display
      const { detect } = await import("../../services/nonSteamAchievementService");
      const detection = await detect(config.gameDir, config.appId);
      setDetectionResults((prev) => ({ ...prev, [config.gameDir]: detection }));

      if (summary && detection.hasAchievements && detection.source) {
        showSuccess(
          `Detected ${summary.total} achievements (${summary.unlocked} unlocked) from ${SOURCE_LABELS[detection.source] || detection.source}. Stored in achievement store.`,
          { title: "Non-Steam Achievements" }
        );
      } else {
        showWarning(detection.message || "No achievement data found in this directory.", {
          title: "Detection Result",
        });
      }
    } catch (e) {
      console.error("[NON_STEAM_ACH][SETTINGS_DETECT_ERROR]", e);
      showError("Detection failed.", { title: "Error" });
    } finally {
      setDetecting(null);
    }
  }, []);

  const handleGenerate = useCallback(async (config: NonSteamAchievementConfig) => {
    setGenerating(config.appId);
    try {
      const success = await autoGenerateSchema(config.appId, undefined, config.gameDir, config.name, config.savePath, config.platform);
      if (success) {
        showSuccess(
          `Schema generated for AppID ${config.appId}. Binary VDF files written.`,
          { title: "Schema Generated" }
        );
        // Re-detect to show updated results
        const { detect } = await import("../../services/nonSteamAchievementService");
        const detection = await detect(config.gameDir, config.appId);
        setDetectionResults((prev) => ({ ...prev, [config.gameDir]: detection }));
      } else {
        showWarning(
          "Could not generate schema. Check that a Steam Web API key is configured.",
          { title: "Generation Failed" }
        );
      }
    } catch (e) {
      console.error("[NON_STEAM_ACH][SETTINGS_GENERATE_ERROR]", e);
      showError("Schema generation failed.", { title: "Error" });
    } finally {
      setGenerating(null);
    }
  }, []);

  const handleAdd = useCallback(async () => {
    const dir = newGameDir.trim();
    const appIdNum = parseInt(newAppId, 10);

    if (!dir) {
      showError("Game directory is required.", { title: "Missing directory" });
      return;
    }

    if (isNaN(appIdNum) || appIdNum <= 0) {
      showError("A valid AppID is required for achievement tracking.", { title: "Invalid AppID" });
      return;
    }

    const config: NonSteamAchievementConfig = {
      appId: appIdNum,
      name: dir.split(/[/\\]/).filter(Boolean).pop() || `Game ${appIdNum}`,
      gameDir: dir,
      source: newSource,
      enabled: true,
      ...(newSavePath.trim() ? { savePath: newSavePath.trim() } : {}),
    };

    try {
      await saveConfig(config);
      showSuccess(`Added config for AppID ${appIdNum}.`, { title: "Config saved" });
      setNewGameDir("");
      setNewAppId("");
      setNewSource("auto");
      setNewSavePath("");
      setAdding(false);
      await loadConfigs();
    } catch (e) {
      console.error("[NON_STEAM_ACH][SETTINGS_ADD_ERROR]", e);
      showError("Failed to save config.", { title: "Error" });
    }
  }, [newGameDir, newAppId, newSource, newSavePath, loadConfigs]);

  const handleDelete = useCallback(async (appId: number) => {
    try {
      await removeConfig(appId);
      showSuccess(`Removed config for AppID ${appId}.`, { title: "Config deleted" });
      setConfirmingDelete(null);
      await loadConfigs();
    } catch (e) {
      console.error("[NON_STEAM_ACH][SETTINGS_DELETE_ERROR]", e);
      showError("Failed to delete config.", { title: "Error" });
    }
  }, [loadConfigs]);

  const handleToggle = useCallback(async (config: NonSteamAchievementConfig) => {
    const updated = { ...config, enabled: !(config.enabled ?? true) };
    try {
      await saveConfig(updated);
      await loadConfigs();
    } catch (e) {
      console.error("[NON_STEAM_ACH][SETTINGS_TOGGLE_ERROR]", e);
    }
  }, [loadConfigs]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-(--color-muted)">
        Track achievements for non-Steam games (cracked games, Goldberg emulator, CODEX/RUNE, OnlineFix).
        Each entry requires a game directory and a Steam AppID for schema lookup.
      </p>

      {configs.length > 0 && (
        <div className="space-y-2">
          {configs.map((config) => {
            const result = detectionResults[config.gameDir];
            const isDetecting = detecting === config.gameDir;

            return (
              <div
                key={config.appId}
                className="flex flex-col gap-3 rounded-xl border border-(--surface-active-border) bg-white/[0.03] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-(--color-text)">
                        {config.name || `Game ${config.appId}`}
                      </span>
                      <span className="shrink-0 rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-(--color-muted)">
                        AppID {config.appId}
                      </span>
                      <span className="shrink-0 rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-(--color-muted)">
                        {SOURCE_LABELS[config.source || ""] || config.source || "auto"}
                      </span>
                      {result?.hasAchievements && (
                        <span className="shrink-0 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                          {result.achievementCount} achievements
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-(--color-muted)">
                      {config.gameDir}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleToggle(config)}
                      className={`relative h-6 w-10 rounded-full transition ${
                        (config.enabled ?? true) ? "bg-(--color-accent)" : "bg-white/10"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                          (config.enabled ?? true) ? "left-5" : "left-0.5"
                        }`}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDetect(config)}
                      disabled={isDetecting}
                      className="rounded-lg p-1.5 text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:opacity-50"
                      title="Detect achievements"
                    >
                      {isDetecting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleGenerate(config)}
                      disabled={generating === config.appId}
                      className="rounded-lg p-1.5 text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-accent) disabled:opacity-50"
                      title="Generate schema from Steam API"
                    >
                      {generating === config.appId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Cpu className="h-4 w-4" />
                      )}
                    </button>

                    {confirmingDelete === config.appId ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDelete(config.appId)}
                          className="rounded-lg bg-red-500/20 px-2 py-1 text-[10px] font-medium text-red-400 transition hover:bg-red-500/30"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(null)}
                          className="rounded-lg px-2 py-1 text-[10px] text-(--color-muted) transition hover:bg-white/10"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(config.appId)}
                        className="rounded-lg p-1.5 text-(--color-muted) transition hover:bg-white/10 hover:text-red-400"
                        title="Remove config"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {result && !result.hasAchievements && !isDetecting && (
                  <p className="text-xs text-amber-400/80">{result.message}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className="space-y-3 rounded-xl border border-(--color-accent)/30 bg-white/[0.03] p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-(--color-text)">
              Game Directory
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newGameDir}
                onChange={(e) => setNewGameDir(e.target.value)}
                className="h-9 flex-1 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)/50 focus:border-(--color-accent)/50"
                placeholder="C:\Games\My Game"
              />
              <button
                type="button"
                onClick={async () => {
                  const folder = await pickFolder("Select Game Directory");
                  if (folder) setNewGameDir(folder);
                }}
                className="shrink-0 rounded-lg border border-(--surface-active-border) bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-(--color-text) transition hover:bg-white/10"
              >
                <FolderOpen className="inline h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-(--color-text)">
                Steam AppID
              </label>
              <input
                type="number"
                value={newAppId}
                onChange={(e) => setNewAppId(e.target.value)}
                className="h-9 w-full rounded-lg border border-(--surface-active-border) bg-white/5 px-3 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)/50 focus:border-(--color-accent)/50"
                placeholder="e.g. 480"
                min={1}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-(--color-text)">
                Source
              </label>
              <select
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
                className="h-9 w-full rounded-lg border border-(--surface-active-border) bg-white/5 px-3 text-sm text-(--color-text) outline-none focus:border-(--color-accent)/50"
              >
                {SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-(--color-text)">
              Save Path <span className="text-(--color-muted)">(optional)</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newSavePath}
                onChange={(e) => setNewSavePath(e.target.value)}
                className="h-9 flex-1 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)/50 focus:border-(--color-accent)/50"
                placeholder="e.g. C:\Games\My Game\GSE_Saves (unlock state files)"
              />
              <button
                type="button"
                onClick={async () => {
                  const folder = await pickFolder("Select Save Directory");
                  if (folder) setNewSavePath(folder);
                }}
                className="shrink-0 rounded-lg border border-(--surface-active-border) bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-(--color-text) transition hover:bg-white/10"
              >
                <FolderOpen className="inline h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-1 text-[10px] text-(--color-muted)/60">
              Directory containing achievement unlock state files. If omitted, auto-detected from the game directory.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAdd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setNewGameDir("");
                setNewAppId("");
                setNewSource("auto");
                setNewSavePath("");
              }}
              className="rounded-lg px-3 py-1.5 text-xs text-(--color-muted) transition hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-(--surface-active-border) bg-white/[0.02] px-3 py-2 text-xs font-medium text-(--color-muted) transition hover:border-(--color-accent)/40 hover:bg-white/[0.05] hover:text-(--color-text)"
        >
          <Plus className="h-3.5 w-3.5" />
          Add non-Steam game
        </button>
      )}

      <p className="text-[10px] text-(--color-muted)/60">
        Achievement data is read from the game's local files (Goldberg steam_settings/, CODEX ini, OnlineFix ini).
        Use the Generate button to create schema files from Steam API when no local data exists.
      </p>
    </div>
  );
}
