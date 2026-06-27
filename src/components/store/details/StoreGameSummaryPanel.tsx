import {
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  Gamepad2,
  PauseCircle,
} from "lucide-react";

import { SummaryLine } from "./StoreGameDetailPrimitives";

import type { PackageGame } from "../../../types/package";
import type { PackageInstallStatus } from "../../../types/packageInstall";

type StoreGameSummaryPanelProps = {
  game: PackageGame;
  installStatus?: PackageInstallStatus;
  developer: string;
  platforms: string[];
  availableSources: number;
  totalSources: number;
  onDownload?: () => void;
  onChangeSource?: () => void;
  onOpenSteam: () => void;
  onOpenSteamDb: () => void;
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

export default function StoreGameSummaryPanel({
  game,
  installStatus = "not-installed",
  developer,
  platforms,
  availableSources,
  totalSources,
  onDownload,
  onChangeSource,
  onOpenSteam,
  onOpenSteamDb,
}: StoreGameSummaryPanelProps) {
  const hasLuaReady = availableSources > 0;
  const installBadge = getInstallBadge(installStatus);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-(--surface-active-border) bg-black/20">
        <div className="aspect-[16/9] overflow-hidden bg-white/5">
          {game.imageUrl ? (
            <img
              src={game.imageUrl}
              alt={game.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
            </div>
          )}
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

            {hasLuaReady && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Lua Ready
              </span>
            )}

            {totalSources > 0 && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/60">
                {availableSources}/{totalSources} Sources
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
        <div className="space-y-2">
          <button
            type="button"
            disabled={!hasLuaReady}
            onClick={onDownload}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-4 py-3 text-sm font-bold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            {hasLuaReady ? "Download" : "No Sources Available"}
          </button>

          <button
            type="button"
            disabled={totalSources === 0}
            onClick={onChangeSource}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Change Source
          </button>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={onOpenSteam}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Steam
            </button>

            <button
              type="button"
              onClick={onOpenSteamDb}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
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
              totalSources > 0
                ? `${availableSources}/${totalSources} available`
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
