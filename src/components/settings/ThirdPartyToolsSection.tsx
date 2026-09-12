import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Disc3,
  Rocket,
  X,
  HardDrive,
  Code,
  Download,
  Cloud,
} from "lucide-react";

import {
  listThirdPartyTools,
  installThirdPartyTool,
  uninstallThirdPartyTool,
  checkThirdPartyUpdates,
  updateThirdPartyTool,
  setThirdPartyToolEnabled,
  setThirdPartyToolVariant,
  openThirdPartyFolder,
  terminateProcessByName,
  ThirdPartyToolInfo,
} from "../../services/tauri";
import { showSuccess, showError } from "../toast/GameToast";
import { useSettings } from "../../context/SettingsContext";
import { useConfirm } from "../../services/confirmService";

function toolIcon(id: string): React.ReactNode {
  switch (id) {
    case "smokeapi":
      return <Disc3 className="h-5 w-5" />;
    case "steamless":
      return <Rocket className="h-5 w-5" />;
    case "goldberg_fork":
      return <HardDrive className="h-5 w-5" />;
    case "opensteamtool":
      return <Code className="h-5 w-5" />;
    case "depotdownloader":
      return <Download className="h-5 w-5" />;
    case "cloud_redirect":
      return <Cloud className="h-5 w-5" />;
    default:
      return <HardDrive className="h-5 w-5" />;
  }
}

const STEAM_LOCKED_MESSAGES = ["steam_running", "os error 32", "os error 33", "being used by another process"];

function isSteamLockedError(err: unknown): boolean {
  const msg = String(err);
  return STEAM_LOCKED_MESSAGES.some((m) => msg.includes(m));
}

export default function ThirdPartyToolsSection() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { confirm } = useConfirm();
  const [tools, setTools] = useState<ThirdPartyToolInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [workingAction, setWorkingAction] = useState<"install" | "uninstall" | "update" | "toggle">("install");
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  const withSteamCloseRetry = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> => {
      try {
        return await operation();
      } catch (err) {
        if (!isSteamLockedError(err)) throw err;
        const result = await confirm({
          title: t("tools_section.steam_locked_title"),
          description: t("tools_section.steam_locked_desc"),
          confirmLabel: t("tools_section.steam_locked_confirm"),
          variant: "danger",
        });
        if (!result.confirmed) throw err;
        await terminateProcessByName("steam.exe");
        await new Promise((r) => setTimeout(r, 2000));
        return await operation();
      }
    },
    [confirm, t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listThirdPartyTools();
      setTools(result);
    } catch (err) {
      showError(t("tools_section.error_load", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleInstall = useCallback(async (toolId: string) => {
    setWorkingId(toolId);
    setWorkingAction("install");
    try {
      const steamRoot = settings.steamRoot || undefined;
      const res = await withSteamCloseRetry(() => installThirdPartyTool(toolId, steamRoot));
      if (res.ok) showSuccess(res.message || t("tools_section.install_ok"));
      else showError(res.message || t("tools_section.install_fail"));
    } catch (err) {
      if (isSteamLockedError(err)) return; // user declined — no error toast
      showError(t("tools_section.error_install", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setWorkingId(null);
      load();
    }
  }, [load, settings.steamRoot, withSteamCloseRetry]);

  const handleUninstall = useCallback(async (toolId: string) => {
    setWorkingId(toolId);
    setWorkingAction("uninstall");
    try {
      const steamRoot = settings.steamRoot || undefined;
      const res = await withSteamCloseRetry(() => uninstallThirdPartyTool(toolId, steamRoot));
      if (res.ok) showSuccess(res.message || t("tools_section.uninstall_ok"));
      else showError(res.message || t("tools_section.uninstall_fail"));
    } catch (err) {
      if (isSteamLockedError(err)) return;
      showError(t("tools_section.error_uninstall", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setWorkingId(null);
      load();
    }
  }, [load, settings.steamRoot, withSteamCloseRetry]);

  const handleToggle = useCallback(async (toolId: string, currentEnabled: boolean) => {
    setWorkingId(toolId);
    setWorkingAction("toggle");
    try {
      const steamRoot = settings.steamRoot || undefined;
      const res = await withSteamCloseRetry(() => setThirdPartyToolEnabled(toolId, !currentEnabled, steamRoot));
      if (res.ok) showSuccess(res.message || t("tools_section.toggle_ok"));
      else showError(res.message || t("tools_section.toggle_fail"));
    } catch (err) {
      if (isSteamLockedError(err)) return;
      showError(t("tools_section.error_toggle", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setWorkingId(null);
      load();
    }
  }, [load, settings.steamRoot]);

  const handleVariantChange = useCallback(async (toolId: string, variantId: string) => {
    setWorkingId(toolId);
    setWorkingAction("toggle");
    try {
      const res = await setThirdPartyToolVariant(toolId, variantId);
      if (res.ok) showSuccess(res.message);
      else showError(res.message);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkingId(null);
      load();
    }
  }, [load]);

  const handleUpdateAll = useCallback(async () => {
    setCheckingUpdates(true);
    try {
      const result = await checkThirdPartyUpdates();
      setTools(result);
      const outdated = result.filter((t) => t.updateAvailable);
      if (outdated.length === 0) {
        showSuccess(t("tools_section.all_updated"));
        return;
      }
      let updated = 0;
      const steamRoot = settings.steamRoot || undefined;
      for (const t of outdated) {
        setWorkingId(t.id);
        setWorkingAction("update");
        const res = await updateThirdPartyTool(t.id, steamRoot);
        if (res.ok) updated++;
      }
      showSuccess(t("tools_section.updated_count", { updated, total: outdated.length }));
    } catch (err) {
      showError(t("tools_section.error_updates", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setWorkingId(null);
      setCheckingUpdates(false);
      load();
    }
  }, [load, settings.steamRoot]);

  const handleOpenFolder = useCallback(async () => {
    try {
      await openThirdPartyFolder();
    } catch (err) {
      showError(t("tools_section.error_open_folder", { error: err instanceof Error ? err.message : String(err) }));
    }
  }, []);

  const busy = workingId !== null;

  return (
    <div className="lf-surface overflow-hidden rounded-2xl border">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--surface-active-border) p-5">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-(--color-text)">
            <HardDrive className="h-4 w-4 text-(--color-accent)" />
            {t("tools_section.title")}
          </h3>
          <p className="mt-1 text-xs text-(--color-muted)">
            {t("tools_section.desc")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenFolder}
            className="flex items-center gap-1.5 rounded-lg border border-(--surface-active-border) px-3 py-1.5 text-xs font-medium text-(--color-muted) transition hover:bg-white/5 hover:text-(--color-text)"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("tools_section.open_folder")}
          </button>
          <button
            type="button"
            onClick={handleUpdateAll}
            disabled={busy || tools.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-(--color-accent)/10 px-3 py-1.5 text-xs font-medium text-(--color-accent) transition hover:bg-(--color-accent)/20 disabled:opacity-50"
          >
            {checkingUpdates ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t("tools_section.check_updates")}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="space-y-3 p-5">
        {loading && tools.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-(--color-muted)">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("tools_section.loading")}
          </div>
        ) : tools.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <HardDrive className="h-8 w-8 text-(--color-muted)" />
            <p className="text-sm text-(--color-muted)">
              {t("tools_section.empty")}
            </p>
          </div>
        ) : (
          tools.map((tool) => {
            const isWorking = workingId === tool.id;
            const hasToggle = tool.enabled !== undefined;
            return (
              <div
                key={tool.id}
                className="flex items-start gap-3 rounded-xl border border-(--surface-active-border) p-4"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--color-accent)/10 text-(--color-accent)">
                  {toolIcon(tool.id)}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-(--color-text)">{tool.name}</span>
                    {tool.installed && (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        {tool.installedVersion ? `v${tool.installedVersion}` : t("tools_section.installed")}
                      </span>
                    )}
                    {tool.updateAvailable && (
                      <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">
                        <AlertTriangle className="h-3 w-3" />
                        {tool.latestVersion
                          ? t("tools_section.update_available", { version: `v${tool.latestVersion}` })
                          : t("tools_section.update_available", { version: "" })}
                      </span>
                    )}
                  </div>
                  {tool.variants && tool.variants.length > 0 && (
                    <div className="mt-2 flex gap-1 rounded-lg bg-white/5 p-0.5">
                      {tool.variants.map((v) => {
                        const isSelected = (tool.selectedVariant ?? "original") === v.id;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            disabled={busy}
                            onClick={() => handleVariantChange(tool.id, v.id)}
                            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                              isSelected
                                ? "bg-(--color-accent) text-white"
                                : "text-(--color-muted) hover:text-(--color-text)"
                            } disabled:opacity-50`}
                          >
                            {v.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="mt-1 line-clamp-2 text-xs text-(--color-muted)">{tool.description}</p>
                  {!tool.installed && tool.latestVersion && (
                    <p className="mt-0.5 text-[11px] text-(--color-muted)">
                      {t("tools_section.latest_version", { version: tool.latestVersion })}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {hasToggle && tool.installed ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleToggle(tool.id, tool.enabled ?? true)}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                          tool.enabled
                            ? "bg-(--color-accent)"
                            : "bg-white/10"
                        } disabled:opacity-50`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            tool.enabled ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                        {isWorking && workingAction === "toggle" && (
                          <Loader2 className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-spin text-(--color-accent)" />
                        )}
                      </button>
                      {tool.updateAvailable && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setWorkingId(tool.id);
                            setWorkingAction("update");
                            const steamRoot = settings.steamRoot || undefined;
                            updateThirdPartyTool(tool.id, steamRoot).then((res) => {
                              if (res.ok) showSuccess(res.message || t("tools_section.update_ok"));
                              else showError(res.message || t("tools_section.update_fail"));
                            }).catch((err) =>
                              showError(err instanceof Error ? err.message : String(err))
                            ).finally(() => {
                              setWorkingId(null);
                              load();
                            });
                          }}
                          className="flex items-center gap-1.5 rounded-lg bg-(--color-accent)/10 px-3 py-1.5 text-xs font-medium text-(--color-accent) transition hover:bg-(--color-accent)/20 disabled:opacity-50"
                        >
                          {isWorking && workingAction === "update" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          {t("tools_section.update")}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleUninstall(tool.id)}
                        className="flex items-center gap-1.5 rounded-lg border border-(--surface-active-border) px-3 py-1.5 text-xs font-medium text-(--color-muted) transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                      >
                        {isWorking && workingAction === "uninstall" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                        {t("tools_section.uninstall")}
                      </button>
                    </>
                  ) : tool.installed ? (
                    <>
                      {tool.updateAvailable && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setWorkingId(tool.id);
                            setWorkingAction("update");
                            const steamRoot = settings.steamRoot || undefined;
                            updateThirdPartyTool(tool.id, steamRoot).then((res) => {
                              if (res.ok) showSuccess(res.message || t("tools_section.update_ok"));
                              else showError(res.message || t("tools_section.update_fail"));
                            }).catch((err) =>
                              showError(err instanceof Error ? err.message : String(err))
                            ).finally(() => {
                              setWorkingId(null);
                              load();
                            });
                          }}
                          className="flex items-center gap-1.5 rounded-lg bg-(--color-accent)/10 px-3 py-1.5 text-xs font-medium text-(--color-accent) transition hover:bg-(--color-accent)/20 disabled:opacity-50"
                        >
                          {isWorking && workingAction === "update" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          {t("tools_section.update")}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleUninstall(tool.id)}
                        className="flex items-center gap-1.5 rounded-lg border border-(--surface-active-border) px-3 py-1.5 text-xs font-medium text-(--color-muted) transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                      >
                        {isWorking && workingAction === "uninstall" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                        {t("tools_section.uninstall")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleInstall(tool.id)}
                      className="flex items-center gap-1.5 rounded-lg bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-(--color-accent-text) transition hover:opacity-90 disabled:opacity-50"
                    >
                      {isWorking && workingAction === "install" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <HardDrive className="h-3.5 w-3.5" />
                      )}
                      {t("tools_section.install")}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
