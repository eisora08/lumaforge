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
} from "lucide-react";

import { SummaryLine } from "./StoreGameDetailPrimitives";

import type { PackageGame, PackageSource } from "../../../types/package";
import type { PackageInstallStatus } from "../../../types/packageInstall";
import type { SourceCheckStatus } from "../../../services/sourceAvailabilityCacheService";

type StoreGameSummaryPanelProps = {
  game: PackageGame;
  previewImageUrl?: string;
  installStatus?: PackageInstallStatus;
  developer: string;
  platforms: string[];
  availableSources: number;
  totalSources: number;
  selectedSource?: PackageSource | null;
  sourceStatus?: SourceCheckStatus;
  onDownload?: () => void;
  onChangeSource?: () => void;
  onOpenSteam: () => void;
  onOpenSteamDb: () => void;
  onRefreshSources?: () => void;
};

function getInstallBadge(status: PackageInstallStatus) {
  if (status === "active") {
    return {
      label: "Installed",
      icon: CheckCircle2,
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    };
  }

  if (status === "disabled") {
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

function getDownloadLabel(source?: PackageSource | null) {
  if (!source) return "Download";
  if (source.fileType === "lua") return "Download Lua";
  if (source.fileType === "zip") return "Download Package";
  return "Download";
}

export default function StoreGameSummaryPanel({
  game,
  previewImageUrl,
  installStatus = "not-installed",
  developer,
  platforms,
  availableSources,
  totalSources,
  selectedSource,
  sourceStatus = "idle",
  onDownload,
  onChangeSource,
  onOpenSteam,
  onOpenSteamDb,
  onRefreshSources,
}: StoreGameSummaryPanelProps) {
  const isChecking = sourceStatus === "checking";
  const isReady = sourceStatus === "ready" || availableSources > 0;
  const isNone = sourceStatus === "none" && availableSources === 0;
  const isError = sourceStatus === "error";
  const isTimeout = sourceStatus === "timeout";

  const hasLuaReady = isReady && availableSources > 0;
  const installBadge = getInstallBadge(installStatus);
  const canDownload = isReady && !!selectedSource?.available;
  const needsRetry = isError || isTimeout;

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
            {installBadge &&
              (() => {
                const Icon = installBadge.icon;

                return (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${installBadge.className}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {installBadge.label}
                  </span>
                );
              })()}

            {isChecking && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/20 bg-yellow-500/15 px-2.5 py-1 text-xs font-medium text-yellow-300">
                Checking sources...
              </span>
            )}

            {isReady && hasLuaReady && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Lua Ready
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

            {totalSources > 0 && !isChecking && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/60">
                {availableSources}/{totalSources} Sources
              </span>
            )}
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

        <div className="space-y-2">
          <button
            type="button"
            disabled={!canDownload}
            onClick={onDownload}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-4 py-3 text-sm font-bold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            {isChecking
              ? "Checking sources..."
              : isReady && canDownload
                ? getDownloadLabel(selectedSource)
                : isNone
                  ? "No Sources Available"
                  : needsRetry
                    ? "Source check failed"
                    : "No Sources Available"}
          </button>

          <button
            type="button"
            disabled={isChecking || totalSources === 0}
            onClick={onChangeSource}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isChecking ? "Checking sources..." : isReady ? "Change Source" : "Sources: None"}
          </button>

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
            value={
              installStatus === "active"
                ? "Installed"
                : installStatus === "disabled"
                  ? "Disabled"
                  : "Not Installed"
            }
          />
          <SummaryLine
            label="Sources"
            value={
              isChecking
                ? "Checking..."
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
