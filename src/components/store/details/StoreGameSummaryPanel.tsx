import { Database, ExternalLink } from "lucide-react";

import { SummaryLine } from "./StoreGameDetailPrimitives";

import type { PackageGame } from "../../../types/package";
import type { PackageInstallStatus } from "../../../types/packageInstall";

type StoreGameSummaryPanelProps = {
  game: PackageGame;
  installStatus?: PackageInstallStatus;
  developer: string;
  availableSources: number;
  totalSources: number;
  onOpenSteam: () => void;
  onOpenSteamDb: () => void;
};

export default function StoreGameSummaryPanel({
  game,
  installStatus = "not-installed",
  developer,
  availableSources,
  totalSources,
  onOpenSteam,
  onOpenSteamDb,
}: StoreGameSummaryPanelProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
        <h2 className="font-bold text-(--color-text)">
          Actions
        </h2>

        <div className="mt-4 grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={onOpenSteam}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-sm text-(--color-text) transition hover:bg-white/10"
          >
            <ExternalLink className="h-4 w-4" />
            Open Steam Page
          </button>

          <button
            type="button"
            onClick={onOpenSteamDb}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-sm text-(--color-text) transition hover:bg-white/10"
          >
            <Database className="h-4 w-4" />
            Open SteamDB
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
        <h2 className="font-bold text-(--color-text)">
          Summary
        </h2>

        <div className="mt-4 space-y-3 text-sm">
          <SummaryLine label="AppID" value={game.appId} />
          <SummaryLine
            label="Install Status"
            value={installStatus}
          />
          <SummaryLine
            label="Sources"
            value={`${availableSources}/${totalSources} available`}
          />
          <SummaryLine label="Developer" value={developer} />
        </div>
      </div>
    </div>
  );
}
