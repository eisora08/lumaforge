import { useState } from "react";
import { Gamepad2 } from "lucide-react";

import type { SteamAppMetadata } from "../../../types/gameMetadata";

type StoreGameOverviewSectionProps = {
  title: string;
  metadata?: SteamAppMetadata;
};

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&[a-zA-Z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function StoreGameOverviewSection({
  title,
  metadata,
}: StoreGameOverviewSectionProps) {
  const [showFullDescription, setShowFullDescription] = useState(false);

  const shortDescription = metadata?.short_description || null;
  const rawDetailedDescription = metadata?.detailed_description || null;
  const detailedDescription = rawDetailedDescription
    ? stripHtml(rawDetailedDescription)
    : null;
  const genres = metadata?.genres ?? [];

  const hasDescription = !!shortDescription || !!detailedDescription;

  if (!hasDescription && genres.length === 0) {
    return (
      <section className="rounded-3xl border border-(--surface-active-border) bg-white/5 p-5 lg:p-6">
        <h2 className="text-lg font-bold text-(--color-text)">
          About {title}
        </h2>
        <p className="mt-3 text-sm text-(--color-muted)">
          Game description is not available yet.
        </p>
      </section>
    );
  }

  const descriptionText = shortDescription || detailedDescription || "";
  const longText = detailedDescription && detailedDescription !== shortDescription
    ? detailedDescription
    : null;

  const shouldClamp = longText && longText.length > 400;
  const displayText = shouldClamp && !showFullDescription
    ? longText.slice(0, 400) + "..."
    : longText;

  return (
    <section className="rounded-3xl border border-(--surface-active-border) bg-white/5 p-5 lg:p-6">
      <h2 className="text-lg font-bold text-(--color-text)">
        About {title}
      </h2>

      <p className="mt-3 leading-relaxed text-(--color-text)/80">
        {descriptionText}
      </p>

      {longText && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-(--color-muted)">
            About This Game
          </h3>
          <p className="mt-2 whitespace-pre-line leading-relaxed text-(--color-text)/70">
            {displayText}
          </p>
          {shouldClamp && (
            <button
              type="button"
              onClick={() => setShowFullDescription(!showFullDescription)}
              className="mt-2 text-sm font-medium text-(--color-accent) transition hover:opacity-80"
            >
              {showFullDescription ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      {genres.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Gamepad2 className="h-4 w-4 text-(--color-muted)" />
          {genres.map((genre) => (
            <span
              key={genre}
              className="rounded-full border border-(--surface-active-border) bg-white/5 px-3 py-1 text-xs text-(--color-text)/70"
            >
              {genre}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
