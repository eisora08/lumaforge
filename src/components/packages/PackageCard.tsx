import {
  Download,
  ExternalLink,
  Gamepad2,
  SearchCheck,
} from "lucide-react";

import { PackageGame } from "../../types/package";
import PackageSourceBadge from "./PackageSourceBadge";

type PackageCardProps = {
  game: PackageGame;
};

export default function PackageCard({ game }: PackageCardProps) {
  const availableSources = game.sources.filter((source) => source.available);

  return (
    <article className="lf-surface group overflow-hidden rounded-2xl border transition">
      <div className="relative h-36 overflow-hidden bg-white/5">
        {game.imageUrl ? (
          <img
            src={game.imageUrl}
            alt={game.title}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Gamepad2 className="h-8 w-8 text-(--color-muted)" />
          </div>
        )}

        <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/10 to-transparent" />

        <div className="absolute bottom-3 left-3 right-3">
          <h3 className="line-clamp-1 font-semibold text-white">
            {game.title}
          </h3>

          <p className="mt-0.5 text-xs text-gray-300">
            AppID: {game.appId}
          </p>
        </div>
      </div>

      <div className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="line-clamp-1 text-sm text-(--color-muted)">
              {game.developer || "Developer unknown"}
            </p>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {game.platforms.map((platform) => (
                <span
                  key={platform}
                  className="rounded-full border border-(--surface-active-border) bg-white/5 px-2 py-0.5 text-[11px] text-(--color-muted)"
                >
                  {platform}
                </span>
              ))}
            </div>
          </div>

          <span className="rounded-full bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
            {availableSources.length} source
            {availableSources.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {game.sources.map((source) => (
            <PackageSourceBadge
              key={`${game.appId}-${source.providerId}-${source.fileType}`}
              source={source}
            />
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10">
            <SearchCheck className="h-3.5 w-3.5" />
            Details
          </button>

          <button
            disabled={availableSources.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-3 py-2 text-xs font-medium text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
        </div>

        <button className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)">
          <ExternalLink className="h-3.5 w-3.5" />
          Open Steam page
        </button>
      </div>
    </article>
  );
}