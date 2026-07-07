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
  onDownload?: () => void;
  onChangeSource?: () => void;
  onOpenSteam: () => void;
  onOpenSteamDb: () => void;
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
};

function getStatusBadge(isSteamInstalled: boolean, installStatus: PackageInstallStatus, luaInstalled: boolean) {
  if (isSteamInstalled || (installStatus === "active" && luaInstalled === false)) {
    return {
      label: "Installed",
      icon: CheckCircle2,
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    };
  }

  if (installStatus === "active" || luaInstalled) {
    return {
      label: "In Library",
      icon: Library,
      className: "border-(--color-accent)/20 bg-(--color-accent)/10 text-(--color-accent)",
    };
  }

  if (installStatus === "disabled") {
    return {
      label: "Disabled",
      icon: PauseCircle,
      className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300",
    };
  }

  return null;
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
  needsRetry: boolean,
  canDownload: boolean,
  selectedSource: PackageSource | null | undefined,
  onDownload: (() => void) | undefined,
  onCheckForUpdates: (() => void) | undefined,
): ButtonConfig {
  if (isChecking) {
    return { label: "Checking sources...", enabled: false, onClick: undefined, reason: "checking-sources" };
  }
  if (isNone) {
    return { label: "No Sources Available", enabled: false, onClick: undefined, reason: "no-sources" };
  }
  if (needsRetry) {
    return { label: "Source check failed", enabled: false, onClick: undefined, reason: "source-check-failed" };
  }

  // Non-installed: show download action, provider status is secondary
  if (!luaInstalled && !isSteamInstalled) {
    if (steamOwned) {
      return { label: "Already in account", enabled: false, onClick: undefined, reason: "steam-owned" };
    }
    if (!canDownload) {
      return { label: "Select a Source", enabled: false, onClick: undefined, reason: "no-source-selected" };
    }
    let label = "Download";
    if (selectedSource?.fileType === "lua") label = "Download Lua";
    else if (selectedSource?.fileType === "zip") label = "Download Package";
    return { label, enabled: true, onClick: onDownload, reason: "download-ready" };
  }

  // Installed: owned-blocked
  if (steamOwned) {
    return { label: "Already in account", enabled: false, onClick: undefined, reason: "steam-owned" };
  }

  // Installed: button depends on provider check state
  switch (providerCheckState) {
    case "no-data":
      return { label: "Check for updates", enabled: true, onClick: onCheckForUpdates, reason: "no-provider-data" };
    case "update-available":
      return { label: "Update Package", enabled: true, onClick: onDownload, reason: "update-available" };
    case "up-to-date":
      return { label: "Up to date", enabled: false, onClick: undefined, reason: "up-to-date" };
    case "unknown":
      return { label: "Check again", enabled: true, onClick: onCheckForUpdates, reason: "unknown-no-local-data" };
    case "provider-updating":
      return { label: "Provider updating", enabled: false, onClick: undefined, reason: "provider-updating" };
    case "provider-needs-refresh":
      return { label: "Provider needs refresh", enabled: false, onClick: undefined, reason: "provider-needs-refresh" };
    case "provider-unavailable":
      return { label: "Provider unavailable", enabled: false, onClick: undefined, reason: "provider-unavailable" };
    case "auth-required":
      return { label: "Auth required", enabled: false, onClick: undefined, reason: "auth-required" };
    case "rate-limited":
      return { label: "Rate limited", enabled: false, onClick: undefined, reason: "rate-limited" };
    case "error":
      return { label: "Check again", enabled: true, onClick: onCheckForUpdates, reason: "provider-error" };
    default:
      return { label: "Check for updates", enabled: true, onClick: onCheckForUpdates, reason: "default" };
  }
}

function getProviderStatusBadge(checkState: ProviderCheckState): { label: string; icon: typeof AlertTriangle; className: string } | null {
  switch (checkState) {
    case "update-available":
      return { label: "Update available", icon: Download, className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" };
    case "up-to-date":
      return { label: "Up to date", icon: CheckCircle2, className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" };
    case "unknown":
      return { label: "No local data", icon: AlertTriangle, className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300" };
    case "provider-updating":
      return { label: "Provider updating", icon: Clock, className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300" };
    case "provider-needs-refresh":
      return { label: "Needs refresh", icon: RefreshCw, className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300" };
    case "provider-unavailable":
      return { label: "Provider unavailable", icon: RefreshCwOff, className: "border-red-500/20 bg-red-500/10 text-red-300" };
    case "auth-required":
      return { label: "Auth required", icon: ShieldAlert, className: "border-red-500/20 bg-red-500/10 text-red-300" };
    case "rate-limited":
      return { label: "Rate limited", icon: Clock, className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300" };
    case "error":
      return { label: "Check error", icon: AlertTriangle, className: "border-red-500/20 bg-red-500/10 text-red-300" };
    default:
      return null;
  }
}

export default function StoreGameSummaryPanel({
  game,
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
  onDownload,
  onChangeSource,
  onOpenSteam,
  onOpenSteamDb,
  onRefreshSources,
  providerCheckState = "no-data",
  providerCheckReason,
  providerRemoteFileModified,
  providerRemoteFileSize,
  hasLocalPackage = false,
  steamOwned = false,
  isProviderChecking = false,
  onCheckForUpdates,
}: StoreGameSummaryPanelProps) {
  const isChecking = sourceStatus === "checking" && !isBackgroundChecking;
  const isReady = sourceStatus === "ready" || availableSources > 0;
  const isNone = sourceStatus === "none" && availableSources === 0;
  const isError = sourceStatus === "error";
  const isTimeout = sourceStatus === "timeout";

  const statusBadge = getStatusBadge(isSteamInstalled, installStatus, luaInstalled);
  const canDownload = isReady && !!selectedSource?.available;
  const needsRetry = isError || isTimeout;

  const isInstalled = luaInstalled || isSteamInstalled;
  const actionState = steamOwned ? "owned-blocked" : canDownload ? "download-available" : "none";

  const buttonConfig = getButtonConfig(
    providerCheckState,
    luaInstalled,
    isSteamInstalled,
    steamOwned,
    isChecking,
    isNone,
    needsRetry,
    canDownload,
    selectedSource,
    onDownload,
    onCheckForUpdates,
  );

  const providerStatusBadge = isInstalled ? getProviderStatusBadge(providerCheckState) : null;

  console.debug(
    `[PACKAGE][SUMMARY_STATE] appid=${game.appId} actionState=${actionState} providerCheckState=${providerCheckState} reason=${buttonConfig.reason} hasLocal=${hasLocalPackage} hasRemote=${providerCheckState !== "no-data"}`,
  );
  const primaryIsCheckAction = buttonConfig.label === "Check again" || buttonConfig.label === "Check for updates";
  const showSecondaryCheckAgain = isInstalled && providerCheckState !== "no-data" && !primaryIsCheckAction && !isProviderChecking;
  const checkAgainRendered = primaryIsCheckAction ? 1 : showSecondaryCheckAgain ? 1 : 0;

  console.debug(
    `[PACKAGE][BUTTON_STATE] appid=${game.appId} button="${buttonConfig.label}" enabled=${buttonConfig.enabled} checkAgainRendered=${checkAgainRendered} isChecking=${isProviderChecking} baselineButtonRendered=false`,
  );
  if (providerRemoteFileModified || providerRemoteFileSize) {
    console.debug(
      `[PACKAGE][REMOTE_INFO_RENDER] appid=${game.appId} fileModified=${providerRemoteFileModified} fileSize=${providerRemoteFileSize}`,
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-(--surface-active-border) bg-black/20">
        <div className="aspect-[16/9] overflow-hidden bg-white/5">
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
            {game.title}
          </h2>

          <p className="mt-0.5 text-sm text-(--color-muted)">
            {developer}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {statusBadge &&
              (() => {
                const Icon = statusBadge.icon;

                return (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusBadge.className}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {statusBadge.label}
                  </span>
                );
              })()}

            {!isSteamInstalled && !luaInstalled && installStatus === "not-installed" && isReady && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-(--color-muted)">
                <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                Not in Library
              </span>
            )}

            {isChecking && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/20 bg-yellow-500/15 px-2.5 py-1 text-xs font-medium text-yellow-300">
                Checking sources...
              </span>
            )}

            {isNone && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300">
                No Sources Available
              </span>
            )}

            {needsRetry && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300">
                Source check failed
              </span>
            )}

            {(totalSources > 0 && !isChecking) || isBackgroundChecking ? (
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/60">
                {availableSources}/{totalSources} Sources
                {isBackgroundChecking && " · scanning..."}
              </span>
            ) : null}

            {isInstalled && providerStatusBadge &&
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
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
        {isChecking && (
          <div className="mb-3 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-(--color-muted)">
                Selected Source
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm text-(--color-muted)">
              <span>Awaiting provider response...</span>
            </div>
          </div>
        )}

        {!isChecking && isReady && selectedSource && (
          <div className="mb-3 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-(--color-muted)">
                Selected Source
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
                Ready
              </span>
              {isBackgroundChecking && (
                <span className="text-xs text-yellow-300/70">
                  Checking more sources...
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
                Selected Source
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm text-(--color-muted)">
              <span>{isNone ? "None" : needsRetry ? "Check failed" : "None"}</span>
            </div>
          </div>
        )}

        {/* Provider-status info block — auto-baselined from remote, no manual action needed */}

        {isInstalled && providerCheckState === "update-available" && steamOwned && (
          <div className="mb-3 rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2">
            <p className="text-xs text-blue-300">
              Provider update available, but this game is already in your Steam account.
            </p>
          </div>
        )}

        {/* Auth error info blocks — shown for any state where auth is required */}
        {providerCheckState === "auth-required" && providerCheckReason === "missing-api-key" && (
          <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2">
            <p className="text-xs font-medium text-red-300">
              HubcapDB API key required.
            </p>
            <p className="mt-1 text-xs text-(--color-muted)">
              Configure your HubcapDB API key in Settings {'>'} Providers.
            </p>
          </div>
        )}

        {providerCheckState === "auth-required" && providerCheckReason === "unauthorized" && (
          <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2">
            <p className="text-xs font-medium text-red-300">
              HubcapDB rejected the request. Check your API key.
            </p>
          </div>
        )}

        {providerCheckState === "auth-required" && providerCheckReason === "forbidden" && (
          <div className="mb-3 rounded-xl border border-orange-500/20 bg-orange-500/10 px-3 py-2">
            <p className="text-xs font-medium text-orange-300">
              Your HubcapDB account does not have access to this package.
            </p>
          </div>
        )}

        {providerCheckState === "rate-limited" && (
          <div className="mb-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-3 py-2">
            <p className="text-xs font-medium text-yellow-300">
              HubcapDB rate limit reached. Try again later.
            </p>
          </div>
        )}

        {/* Primary action button */}
        <div className="space-y-2">
          <button
            type="button"
            disabled={!buttonConfig.enabled}
            onClick={buttonConfig.onClick}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-4 py-3 text-sm font-bold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            {buttonConfig.label}
          </button>

          <button
            type="button"
            disabled={isChecking || totalSources === 0}
            onClick={onChangeSource}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isChecking ? "Checking sources..." : isReady ? "Change Source" : "Sources: None"}
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
              Check again
            </button>
          )}
          {isProviderChecking && isInstalled && (
            <button
              type="button"
              disabled={true}
              className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm font-medium text-(--color-muted) opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Checking...
            </button>
          )}

          {needsRetry && onRefreshSources && (
            <button
              type="button"
              onClick={onRefreshSources}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-(--color-accent)/30 bg-(--color-accent)/10 px-4 py-2 text-sm font-medium text-(--color-accent) transition hover:bg-(--color-accent)/20"
            >
              Retry Sources
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

      <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
          Summary
        </h3>

        <div className="mt-3 space-y-2">
          <SummaryLine label="AppID" value={game.appId} />
          <SummaryLine
            label="Status"
            value={statusBadge?.label ?? "Not in Library"}
          />
          <SummaryLine
            label="Sources"
            value={
              isChecking
                ? "Checking..."
                : isBackgroundChecking
                  ? `${availableSources}/${totalSources} · scanning...`
                  : isReady
                    ? `${availableSources}/${totalSources} available`
                    : isNone
                      ? "None"
                      : needsRetry
                        ? "Check failed"
                        : "None"
            }
          />
          <SummaryLine label="Developer" value={developer} />
          {platforms.length > 0 && (
            <SummaryLine
              label="Platforms"
              value={platforms.join(", ")}
            />
          )}
        </div>
      </div>
    </div>
  );
}
