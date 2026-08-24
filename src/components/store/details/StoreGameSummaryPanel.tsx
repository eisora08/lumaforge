import { useTranslation } from "react-i18next";
import AsyncImage from "../../common/AsyncImage";
import HubcapProviderBadges from "../../settings/HubcapProviderBadges";
import {
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  FileArchive,
  FileCode2,
  FileText,
  Gamepad2,
  PauseCircle,
  RefreshCw,
  Library,
  SquareArrowOutUpRight,
  AlertTriangle,
  ShieldAlert,
  Clock,
  RefreshCwOff,
} from "lucide-react";

import { SummaryLine } from "./StoreGameDetailPrimitives";
import type { PackageGame, PackageSource } from "../../../types/package";
import type { PackageInstallStatus } from "../../../types/packageInstall";
import type { SourceCheckStatus } from "../../../services/sourceAvailabilityCacheService";
import type { SourceProgress } from "../StoreGameDetailsPage";

export type ProviderCheckState =
  | "update-available"
  | "up-to-date"
  | "unknown"
  | "provider-unavailable"
  | "provider-updating"
  | "provider-needs-refresh"
  | "auth-required"
  | "rate-limited"
  | "error"
  | "no-data";

type StoreGameSummaryPanelProps = {
  game: PackageGame;
  resolvedTitle?: string;
  previewImageUrl?: string;
  installStatus?: PackageInstallStatus;
  isSteamInstalled?: boolean;
  luaInstalled?: boolean;
  developer: string;
  platforms: string[];
  availableSources: number;
  totalSources: number;
  selectedSource?: PackageSource | null;
  sourceStatus?: SourceCheckStatus;
  isBackgroundChecking?: boolean;
  sourceProgress?: SourceProgress;
  onDownload?: () => void;
  onChangeSource?: () => void;
  onOpenSteam: () => void;
  onOpenSteamDb: () => void;
  onOpenSteamLibrary?: () => void;
  onRefreshSources?: () => void;

  // Provider-status sidecar props
  providerCheckState?: ProviderCheckState;
  providerCheckReason?: string;
  providerRemoteFileModified?: string;
  providerRemoteFileSize?: number;
  hasLocalPackage?: boolean;
  steamOwned?: boolean;
  isProviderChecking?: boolean;
  onCheckForUpdates?: () => void;

  /** Which section of the panel to render. Defaults to "full" (all three cards). */
  section?: "full" | "hero" | "download" | "summary";

  /** Repack tab active: hero card shows only an Installed badge; Sources line lists repackers. */
  repackActive?: boolean;
  repackInstalled?: boolean;
  repackSourceLabels?: string[];
};

function getSummaryBadges(isSteamInstalled: boolean, installStatus: PackageInstallStatus, luaInstalled: boolean, steamOwned: boolean, t: (key: string, fallback: string) => string) {
  const badges: { label: string; icon: typeof CheckCircle2; className: string }[] = [];

  if (isSteamInstalled || (installStatus === "active" && !luaInstalled)) {
    badges.push({
      label: t("store.summary.installed_badge", "Installed"),
      icon: CheckCircle2,
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    });
  }

  if (steamOwned) {
    badges.push({
      label: t("store.summary.owned", "Owned"),
      icon: Gamepad2,
      className: "border-blue-500/20 bg-blue-500/10 text-blue-300",
    });
  }

  if (!isSteamInstalled && (installStatus === "active" || luaInstalled)) {
    badges.push({
      label: t("store.summary.in_library", "In Library"),
      icon: Library,
      className: "border-(--color-accent)/20 bg-(--color-accent)/10 text-(--color-accent)",
    });
  }

  if (installStatus === "disabled") {
    badges.push({
      label: t("store.summary.disabled", "Disabled"),
      icon: PauseCircle,
      className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300",
    });
  }

  return badges;
}

function getFileIcon(fileType: PackageSource["fileType"]) {
  if (fileType === "zip") return FileArchive;
  if (fileType === "lua") return FileCode2;
  return FileText;
}

type ButtonConfig = {
  label: string;
  enabled: boolean;
  onClick: (() => void) | undefined;
  reason: string;
};

function getButtonConfig(
  providerCheckState: ProviderCheckState,
  luaInstalled: boolean,
  isSteamInstalled: boolean,
  steamOwned: boolean,
  isChecking: boolean,
  isNone: boolean,
  isNeedsConfig: boolean,
  needsRetry: boolean,
  canDownload: boolean,
  selectedSource: PackageSource | null | undefined,
  onDownload: (() => void) | undefined,
  onCheckForUpdates: (() => void) | undefined,
  onOpenSteam: (() => void) | undefined,
  sourceProgress: SourceProgress,
  t: (key: string, fallback: string, opts?: Record<string, unknown>) => string,
): ButtonConfig {
  // Non-installed Lua games (orphaned config/lua files) always show "Install via Steam"
  // regardless of source status. Must be checked before isChecking to prevent
  // "Checking sources..." from short-circuiting the install button.
  if (luaInstalled && !isSteamInstalled) {
    return { label: t("store.summary.install_via_steam", "Install via Steam"), enabled: true, onClick: onOpenSteam, reason: "lua-not-installed-install-steam" };
  }

  if (isChecking) {
    const label = sourceProgress && sourceProgress.total > 0 && sourceProgress.completed > 0
      ? t("store.summary.checking_xy", "Checking {{completed}}/{{total}}...", { completed: sourceProgress.completed, total: sourceProgress.total })
      : t("store.summary.checking_sources", "Checking sources...");
    return { label, enabled: false, onClick: undefined, reason: "checking-sources" };
  }

  // Steam-installed games: provider status always shown regardless of source checks
  if (isSteamInstalled) {
    if (steamOwned) {
      return { label: t("store.summary.already_in_account", "Already in account"), enabled: false, onClick: undefined, reason: "steam-owned" };
    }
    switch (providerCheckState) {
      case "update-available":
        return { label: t("store.summary.update_package", "Update Package"), enabled: true, onClick: onDownload, reason: "update-available" };
      case "no-data":
        return { label: t("store.summary.check_for_updates", "Check for updates"), enabled: true, onClick: onCheckForUpdates, reason: "no-provider-data" };
      case "up-to-date":
        return { label: t("store.summary.up_to_date", "Up to date"), enabled: false, onClick: undefined, reason: "up-to-date" };
      case "unknown":
        return { label: t("store.summary.check_again", "Check again"), enabled: true, onClick: onCheckForUpdates, reason: "unknown-no-local-data" };
      case "provider-updating":
        return { label: t("store.summary.provider_updating", "Provider updating"), enabled: false, onClick: undefined, reason: "provider-updating" };
      case "provider-needs-refresh":
        return { label: t("store.summary.provider_needs_refresh", "Provider needs refresh"), enabled: false, onClick: undefined, reason: "provider-needs-refresh" };
      case "provider-unavailable":
        return { label: t("store.summary.provider_unavailable", "Provider unavailable"), enabled: false, onClick: undefined, reason: "provider-unavailable" };
      case "auth-required":
        return { label: t("store.summary.auth_required", "Auth required"), enabled: false, onClick: undefined, reason: "auth-required" };
      case "rate-limited":
        return { label: t("store.summary.rate_limited", "Rate limited"), enabled: false, onClick: undefined, reason: "rate-limited" };
      case "error":
        return { label: t("store.summary.check_again", "Check again"), enabled: true, onClick: onCheckForUpdates, reason: "provider-error" };
      default:
        return { label: t("store.summary.check_for_updates", "Check for updates"), enabled: true, onClick: onCheckForUpdates, reason: "default" };
    }
  }

  // Non-installed / Lua-only games
  if (isNone) {
    return { label: t("store.summary.no_sources", "No Sources Available"), enabled: false, onClick: undefined, reason: "no-sources" };
  }
  if (isNeedsConfig) {
    return { label: t("store.summary.configure_providers", "Configure Providers"), enabled: false, onClick: undefined, reason: "needs-configuration" };
  }
  if (needsRetry) {
    return { label: t("store.summary.source_check_failed", "Source check failed"), enabled: false, onClick: undefined, reason: "source-check-failed" };
  }
  if (steamOwned) {
    return { label: t("store.summary.already_in_account", "Already in account"), enabled: false, onClick: undefined, reason: "steam-owned" };
  }
  if (!canDownload) {
    return { label: t("store.summary.select_source", "Select a Source"), enabled: false, onClick: undefined, reason: "no-source-selected" };
  }
  let label = t("store.summary.download", "Download");
  if (selectedSource?.fileType === "lua") label = t("store.summary.download_lua", "Download Lua");
  else if (selectedSource?.fileType === "zip") label = t("store.summary.download_package", "Download Package");
  return { label, enabled: true, onClick: onDownload, reason: "download-ready" };
}

function getProviderStatusBadge(checkState: ProviderCheckState, t: (key: string, fallback: string) => string): { label: string; icon: typeof AlertTriangle; className: string } | null {
  switch (checkState) {
    case "update-available":
      return { label: t("store.summary.update_available", "Update available"), icon: Download, className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" };
    case "up-to-date":
      return { label: t("store.summary.up_to_date", "Up to date"), icon: CheckCircle2, className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" };
    case "unknown":
      return { label: t("store.summary.no_local_data", "No local data"), icon: AlertTriangle, className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300" };
    case "provider-updating":
      return { label: t("store.summary.provider_updating", "Provider updating"), icon: Clock, className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300" };
    case "provider-needs-refresh":
      return { label: t("store.summary.needs_refresh", "Needs refresh"), icon: RefreshCw, className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300" };
    case "provider-unavailable":
      return { label: t("store.summary.provider_unavailable", "Provider unavailable"), icon: RefreshCwOff, className: "border-red-500/20 bg-red-500/10 text-red-300" };
    case "auth-required":
      return { label: t("store.summary.auth_required", "Auth required"), icon: ShieldAlert, className: "border-red-500/20 bg-red-500/10 text-red-300" };
    case "rate-limited":
      return { label: t("store.summary.rate_limited", "Rate limited"), icon: Clock, className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300" };
    case "error":
      return { label: t("store.summary.check_error", "Check error"), icon: AlertTriangle, className: "border-red-500/20 bg-red-500/10 text-red-300" };
    default:
      return null;
  }
}

export default function StoreGameSummaryPanel({
  game,
  resolvedTitle,
  previewImageUrl,
  installStatus = "not-installed",
  isSteamInstalled = false,
  luaInstalled = false,
  developer,
  platforms,
  availableSources,
  totalSources,
  selectedSource,
  sourceStatus = "idle",
  isBackgroundChecking = false,
  sourceProgress = null,
  onDownload,
  onChangeSource,
  onOpenSteam,
  onOpenSteamDb,
  onOpenSteamLibrary,
  onRefreshSources,
  providerCheckState = "no-data",
  providerCheckReason,
  providerRemoteFileModified,
  providerRemoteFileSize,
  hasLocalPackage = false,
  steamOwned = false,
  isProviderChecking = false,
  onCheckForUpdates,
  section = "full",
  repackActive = false,
  repackInstalled = false,
  repackSourceLabels = [],
}: StoreGameSummaryPanelProps) {
  const { t } = useTranslation();
  const isChecking = (sourceStatus === "checking" || sourceStatus === "idle") && !isBackgroundChecking;
  const isReady = sourceStatus === "ready" || availableSources > 0;
  const isNone = sourceStatus === "none" && availableSources === 0;
  const isError = sourceStatus === "error";
  const isTimeout = sourceStatus === "timeout";
  const isNeedsConfig = sourceStatus === "needs-configuration";

  const summaryBadges = getSummaryBadges(isSteamInstalled, installStatus, luaInstalled, steamOwned, t);
  const canDownload = isReady && !!selectedSource?.available;
  const needsRetry = isError || isTimeout;
  const canRetry = onRefreshSources !== undefined && !isReady;

  const isInstalled = isSteamInstalled;
  const inLibrary = steamOwned || luaInstalled;
  const isNonInstalledLua = luaInstalled && !isSteamInstalled;
  const actionState = steamOwned ? "owned-blocked" : canDownload ? "download-available" : "none";

  // Derivation logs only make sense when the download section is rendered
  const verbose = section === "full" || section === "download";

  if (verbose) {
    console.log(
      `[PACKAGE][BUTTON_INPUTS] appid=${game.appId} sourceStatus=${sourceStatus} isChecking=${isChecking} isReady=${isReady} isNone=${isNone} luaInstalled=${luaInstalled} isSteamInstalled=${isSteamInstalled} installStatus=${installStatus} providerCheckState=${providerCheckState} actionState=${actionState} hasLocalPackage=${hasLocalPackage} steamOwned=${steamOwned} canDownload=${canDownload} needsRetry=${needsRetry} selectedSource=${selectedSource?.providerName ?? "none"}`,
    );
  }

  const buttonConfig = getButtonConfig(
    providerCheckState,
    luaInstalled,
    isSteamInstalled,
    steamOwned,
    isChecking,
    isNone,
    isNeedsConfig,
    needsRetry,
    canDownload,
    selectedSource,
    onDownload,
    onCheckForUpdates,
    onOpenSteam,
    sourceProgress,
    t,
  );

  if (verbose) {
    console.log(
      `[PACKAGE][BUTTON_RESOLVE] appid=${game.appId} label="${buttonConfig.label}" enabled=${buttonConfig.enabled} reason=${buttonConfig.reason}`,
    );
  }

  const providerStatusBadge = isInstalled ? getProviderStatusBadge(providerCheckState, t) : null;

  if (verbose && (luaInstalled || isSteamInstalled)) {
    console.log(
      `[PACKAGE][ACTION_RESOLVE] appid=${game.appId} providerStatus=${providerCheckState} selectedProvider=${selectedSource?.providerName || "none"} selectedSource=${!!selectedSource} action=${buttonConfig.label}`,
    );
    if (providerCheckState === "update-available" && !selectedSource) {
      console.log(`[PACKAGE][MISSING_SOURCE_FOR_PROVIDER] appid=${game.appId} provider=hubcapdb action=retry-source`);
    }
  }

  if (verbose) {
    console.log(
      `[STORE][DETAILS_STATE_DERIVE] appid=${game.appId} owned=${steamOwned} steamInstalled=${isSteamInstalled} hasLua=${luaInstalled} installed=${isInstalled} inLibrary=${inLibrary}`,
    );
  }

  if (verbose) {
    console.log(
      `[STORE][OWNED_UI_CLEAN] appid=${game.appId} hideSourcePill=${steamOwned} hidePackageActions=${steamOwned} owned=${steamOwned} installed=${isInstalled} inLibrary=${inLibrary}`,
    );
    if (steamOwned) {
      console.log(`[STORE][OWNED_CARD_THEME] appid=${game.appId} themeTokens=true hardcodedBlue=false`);
      console.log(`[PACKAGE][OWNED_BLOCK] appid=${game.appId} reason=steam-owned`);
    }
    console.log(
      `[STORE][DETAILS_ACTION_GATE] appid=${game.appId} owned=${steamOwned} actionState=${actionState} packageActionsVisible=${!steamOwned} packageActionsEnabled=${!steamOwned && buttonConfig.enabled}`,
    );
    console.debug(
      `[PACKAGE][SUMMARY_STATE] appid=${game.appId} actionState=${actionState} providerCheckState=${providerCheckState} reason=${buttonConfig.reason} hasLocal=${hasLocalPackage} hasRemote=${providerCheckState !== "no-data"}`,
    );
  }
  const primaryIsCheckAction = buttonConfig.label === "Check again" || buttonConfig.label === "Check for updates";
  const showSecondaryCheckAgain = isInstalled && providerCheckState !== "no-data" && !primaryIsCheckAction && !isProviderChecking;
  const checkAgainRendered = primaryIsCheckAction ? 1 : showSecondaryCheckAgain ? 1 : 0;

  if (verbose) {
    console.debug(
      `[PACKAGE][BUTTON_STATE] appid=${game.appId} button="${buttonConfig.label}" enabled=${buttonConfig.enabled} checkAgainRendered=${checkAgainRendered} isChecking=${isProviderChecking} baselineButtonRendered=false`,
    );
    if (providerRemoteFileModified || providerRemoteFileSize) {
      console.debug(
        `[PACKAGE][REMOTE_INFO_RENDER] appid=${game.appId} fileModified=${providerRemoteFileModified} fileSize=${providerRemoteFileSize}`,
      );
    }
  }

  if (verbose && canRetry) {
    console.log(`[STORE][SOURCE_RETRY_RENDER] appid=${game.appId} visible=true reason=${needsRetry ? "retry-failed" : isNone ? "none" : "idle"}`);
  }
  if (verbose && !isChecking && !isReady && !isNone && !needsRetry && !canRetry) {
    console.log(`[STORE][SOURCE_NONE_LABEL_BLOCKED] appid=${game.appId} reason=no-retry-available`);
  }
  if (verbose && !steamOwned && isNone) {
    console.log(`[STORE][NO_SOURCES_RENDER_GUARD] appid=${game.appId} allowed=${!canRetry} sourceStatus=${sourceStatus} availableSources=${availableSources} canRetry=${canRetry} selectedSource=${!!selectedSource}`);
  }

  const heroCard = (
    <div className="overflow-hidden rounded-2xl border border-(--surface-active-border) bg-black/20">
      <div className="aspect-video overflow-hidden bg-white/5">
        <AsyncImage
          src={previewImageUrl || game.imageUrl}
          alt={game.title}
          className="h-full w-full"
          fallback={
            <div className="flex h-full w-full items-center justify-center">
              <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
            </div>
          }
        />
      </div>

        <div className="p-4">
          <h2 className="text-lg font-bold text-(--color-text)">
            {resolvedTitle || game.title}
          </h2>

          <p className="mt-0.5 text-sm text-(--color-muted)">
            {developer}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {repackActive ? (
              repackInstalled && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("store.summary.installed_badge", "Installed")}
                </span>
              )
            ) : (
              <>
            {summaryBadges.map((badge) => {
              const Icon = badge.icon;
              return (
                <span
                  key={badge.label}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${badge.className}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {badge.label}
                </span>
              );
            })}

            {!steamOwned && !isSteamInstalled && !luaInstalled && installStatus === "not-installed" && isReady && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-(--color-muted)">
                <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                {t("store.summary.not_in_library", "Not in Library")}
              </span>
            )}

            {!steamOwned && !isNonInstalledLua && isChecking && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/20 bg-yellow-500/15 px-2.5 py-1 text-xs font-medium text-yellow-300">
                {sourceProgress && sourceProgress.total > 0 && sourceProgress.completed > 0
                  ? t("store.summary.checking_xy", "Checking {{completed}}/{{total}}...", { completed: sourceProgress.completed, total: sourceProgress.total })
                  : t("store.summary.checking_sources", "Checking sources...")}
              </span>
            )}

            {!steamOwned && !isNonInstalledLua && isNone && !canRetry && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300">
                {t("store.summary.no_sources", "No Sources Available")}
              </span>
            )}

            {!steamOwned && !isNonInstalledLua && isNeedsConfig && canRetry && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
                {t("store.summary.provider_config_needed", "Provider configuration needed")}
              </span>
            )}

            {!steamOwned && !isNonInstalledLua && needsRetry && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300">
                {t("store.summary.source_check_failed", "Source check failed")}
              </span>
            )}

            {!steamOwned && !isNonInstalledLua && ((totalSources > 0 && !isChecking) || isBackgroundChecking) ? (
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/60">
                {availableSources}/{totalSources} Sources
                {isBackgroundChecking && ` · ${t("store.summary.scanning", "scanning...")}`}
              </span>
            ) : null}

            {!steamOwned && isInstalled && providerStatusBadge &&
              (() => {
                const Icon = providerStatusBadge.icon;
                return (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${providerStatusBadge.className}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {providerStatusBadge.label}
                  </span>
                );
              })()}
              </>
            )}
          </div>
        </div>
      </div>
    );

  const downloadCard = steamOwned ? (
        <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
          <p className="text-sm font-medium text-(--color-text)">
            {t("store.summary.this_game_in_steam_account", "This game is already in your Steam account.")}
          </p>
          <p className="mt-1 text-xs text-(--color-muted)">
            {isInstalled ? t("store.summary.installed_ready_steam", "Installed and ready to play via Steam.") : t("store.summary.can_install_from_steam", "You can install it from Steam at any time.")}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              onClick={onOpenSteamLibrary}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-4 py-3 text-sm font-bold text-(--color-accent-text) transition hover:opacity-90"
            >
              <Library className="h-4 w-4" />
              {t("store.summary.steam_library", "Steam Library")}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onOpenSteam}
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t("store.summary.steam", "Steam")}
              </button>
              <button
                type="button"
                onClick={onOpenSteamDb}
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
              >
                <Database className="h-3.5 w-3.5" />
                {t("store.summary.steamdb", "SteamDB")}
              </button>
            </div>
          </div>
        </div>
      ) : isNonInstalledLua ? (
        <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
          <p className="text-sm font-medium text-(--color-text)">
            {t("store.summary.this_package_in_library", "This package is already in your library.")}
          </p>
          <p className="mt-1 text-xs text-(--color-muted)">
            {t("store.summary.found_in_config_lua", "Found in config/lua — You can install it from Steam at any time.")}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              onClick={onOpenSteam}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-4 py-3 text-sm font-bold text-(--color-accent-text) transition hover:opacity-90"
            >
              <ExternalLink className="h-4 w-4" />
              {t("store.summary.install_via_steam", "Install via Steam")}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onOpenSteam}
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t("store.summary.steam", "Steam")}
              </button>
              <button
                type="button"
                onClick={onOpenSteamDb}
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
              >
                <Database className="h-3.5 w-3.5" />
                {t("store.summary.steamdb", "SteamDB")}
              </button>
            </div>
          </div>
        </div>
      ) : (
      <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
        {isChecking && (
          <div className="mb-3 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-(--color-muted)">
                {t("store.summary.selected_source", "Selected Source")}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm text-(--color-muted)">
              {sourceProgress && sourceProgress.total > 0 && sourceProgress.completed > 0 ? (
                <span>
                  {t("store.summary.checking_providers_xy", "Checking providers {{completed}}/{{total}}", { completed: sourceProgress.completed, total: sourceProgress.total })}
                  {sourceProgress.successful > 0 && (
                    <span className="ml-1 text-emerald-300/70">
                      {t("store.summary.source_found", "· Source found")}
                    </span>
                  )}
                  {sourceProgress.completed < sourceProgress.total && (
                    <span className="ml-1 text-yellow-300/70">
                      {t("store.summary.checking_remaining", "· Checking {{remaining}} remaining", { remaining: sourceProgress.total - sourceProgress.completed })}
                    </span>
                  )}
                </span>
              ) : (
                <span>{t("store.summary.awaiting_provider", "Awaiting provider response...")}</span>
              )}
            </div>
          </div>
        )}

        {!isChecking && isReady && selectedSource && (
          <div className="mb-3 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-(--color-muted)">
                {t("store.summary.selected_source", "Selected Source")}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-xs text-(--color-text)">
                {(function () {
                  const FileIcon = getFileIcon(selectedSource.fileType);
                  return <FileIcon className="h-3 w-3" />;
                })()}
                .{selectedSource.fileType}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm text-(--color-text) flex-wrap">
              <span>{selectedSource.providerName}</span>
              <span className="text-xs text-emerald-300">
                {t("store.summary.ready", "Ready")}
              </span>
              {isBackgroundChecking && (
                <span className="text-xs text-yellow-300/70">
                  {t("store.summary.checking_more_sources", "Checking more sources...")}
                </span>
              )}
              {selectedSource.providerName === "HubcapDB" && <HubcapProviderBadges surface="store-details" />}
            </div>
          </div>
        )}

        {!isChecking && !isReady && (
          <div className="mb-3 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-(--color-muted)">
                {t("store.summary.selected_source", "Selected Source")}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm text-(--color-muted)">
              {isNone ? (
                <span>{t("store.summary.none_no_packages", "None — no packages found")}</span>
              ) : isNeedsConfig ? (
                <span>{t("store.summary.configure_to_search", "Configure providers to search for sources")}</span>
              ) : needsRetry ? (
                <span>{t("store.summary.check_failed_retry", "Check failed — retry below")}</span>
              ) : canRetry ? (
                <span>{t("store.summary.check_sources_find", "Check sources to find packages")}</span>
              ) : (
                <span>{t("store.summary.none", "None")}</span>
              )}
            </div>
          </div>
        )}

        {/* Auth error info blocks — shown for any state where auth is required */}
        {providerCheckState === "auth-required" && providerCheckReason === "missing-api-key" && (
          <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2">
            <p className="text-xs font-medium text-red-300">
              {t("store.summary.hubcap_api_key_required", "HubcapDB API key required.")}
            </p>
            <p className="mt-1 text-xs text-(--color-muted)">
              {t("store.summary.configure_hubcap_in_settings", "Configure your HubcapDB API key in Settings > Providers.")}
            </p>
          </div>
        )}

        {providerCheckState === "auth-required" && providerCheckReason === "unauthorized" && (
          <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2">
            <p className="text-xs font-medium text-red-300">
              {t("store.summary.hubcap_rejected", "HubcapDB rejected the request. Check your API key.")}
            </p>
          </div>
        )}

        {providerCheckState === "auth-required" && providerCheckReason === "forbidden" && (
          <div className="mb-3 rounded-xl border border-orange-500/20 bg-orange-500/10 px-3 py-2">
            <p className="text-xs font-medium text-orange-300">
              {t("store.summary.hubcap_no_access", "Your HubcapDB account does not have access to this package.")}
            </p>
          </div>
        )}

        {providerCheckState === "rate-limited" && (
          <div className="mb-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-3 py-2">
            <p className="text-xs font-medium text-yellow-300">
              {t("store.summary.hubcap_rate_limited", "HubcapDB rate limit reached. Try again later.")}
            </p>
          </div>
        )}

        {/* Primary action button */}
        <div className="space-y-2">
          <button
            type="button"
            disabled={!buttonConfig.enabled}
            onClick={buttonConfig.onClick}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-4 py-3 text-sm font-bold text-(--color-accent-text) transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {buttonConfig.reason === "lua-not-installed-install-steam"
              ? <ExternalLink className="h-4 w-4" />
              : <Download className="h-4 w-4" />}
            {buttonConfig.label}
          </button>

          <button
            type="button"
            disabled={isChecking || totalSources === 0}
            onClick={onChangeSource}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isChecking
              ? t("store.summary.checking_sources", "Checking sources...")
              : isReady
                ? t("store.summary.change_source", "Change Source")
                : isNeedsConfig
                  ? t("store.summary.configure_check_below", "Configure providers — Check below")
                  : t("store.summary.sources_none_check", "Sources: None — Check below")}
          </button>

          {/* Check again / Retry / Checking... */}
          {showSecondaryCheckAgain && (
            <button
              type="button"
              onClick={onCheckForUpdates}
              disabled={!onCheckForUpdates}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("store.summary.check_again", "Check again")}
            </button>
          )}
          {isProviderChecking && isInstalled && (
            <button
              type="button"
              disabled={true}
              className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm font-medium text-(--color-muted) opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              {t("store.summary.checking", "Checking...")}
            </button>
          )}

          {canRetry && (
            <button
              type="button"
              onClick={() => {
                console.log(`[STORE][SOURCE_RETRY_CLICK] appid=${game.appId} reason=${needsRetry || isNone ? "retry-failed" : isNeedsConfig ? "configure-providers" : "initial-check"}`);
                onRefreshSources?.();
              }}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-(--color-accent)/30 bg-(--color-accent)/10 px-4 py-2 text-sm font-medium text-(--color-accent) transition hover:bg-(--color-accent)/20"
            >
              {isNeedsConfig ? t("store.summary.configure_check", "Configure & Check") : needsRetry || isNone ? t("store.summary.retry_sources", "Retry Sources") : t("store.summary.check_sources", "Check sources")}
            </button>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={onOpenSteam}
              className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Steam
            </button>
            <button
              type="button"
              onClick={onOpenSteamDb}
              className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
            >
              <Database className="h-3.5 w-3.5" />
              SteamDB
            </button>
          </div>
        </div>
      </div>
      );

  const summaryCard = (
    <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
        Summary
      </h3>

        <div className="mt-3 space-y-2">
          <SummaryLine label={t("store.summary.app_id", "AppID")} value={game.appId} />
          <SummaryLine
            label={t("store.summary.status", "Status")}
            value={
              repackActive
                ? repackInstalled
                  ? t("store.summary.installed_badge", "Installed")
                  : t("store.summary.not_installed", "Not installed")
                : summaryBadges.length > 0
                  ? summaryBadges.map((b) => b.label).join(" + ")
                  : inLibrary
                    ? t("store.summary.in_library", "In Library")
                    : steamOwned
                      ? t("store.summary.owned", "Owned")
                      : t("store.summary.not_in_library", "Not in Library")
            }
          />
          <SummaryLine
            label={t("store.summary.sources", "Sources")}
            value={
              repackActive
                ? repackSourceLabels.length > 0
                  ? repackSourceLabels.join(" · ")
                  : t("store.summary.sin_repacks", "Sin repacks")
                : steamOwned
                  ? t("store.summary.steam_account", "Steam account")
                  : isNonInstalledLua
                    ? t("store.summary.in_library_lua", "In library (Lua)")
                    : isChecking
                      ? t("store.summary.checking_ellipsis", "Checking...")
                      : isBackgroundChecking
                        ? `${availableSources}/${totalSources} · ${t("store.summary.scanning", "scanning...")}`
                        : isReady
                          ? t("store.summary.available", "{{available}}/{{total}} available", { available: availableSources, total: totalSources })
                          : isNeedsConfig
                            ? t("store.summary.configure_providers_label", "Configure providers")
                            : isNone
                              ? t("store.summary.none_found", "None found")
                              : needsRetry
                                ? t("store.summary.check_failed", "Check failed")
                                : canRetry
                                  ? t("store.summary.check_pending", "Check pending")
                                  : t("store.summary.none", "None")
            }
          />
          <SummaryLine label={t("store.summary.developer", "Developer")} value={developer} />
          {platforms.length > 0 && (
            <SummaryLine
              label={t("store.summary.platforms", "Platforms")}
              value={platforms.join(", ")}
            />
          )}
        </div>
      </div>
    );

  if (section === "hero") return heroCard;
  if (section === "download") return downloadCard;
  if (section === "summary") return summaryCard;

  return (
    <div className="space-y-4">
      {heroCard}
      {downloadCard}
      {summaryCard}
    </div>
  );
}
