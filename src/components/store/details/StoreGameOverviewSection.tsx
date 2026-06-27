import { useState } from "react";
import { Calendar, Gamepad2, Tag } from "lucide-react";

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

const MAX_SHORT_DESCRIPTION_LENGTH = 300;
const MAX_LONG_PREVIEW = 700;

export default function StoreGameOverviewSection({
  title,
  metadata,
}: StoreGameOverviewSectionProps) {
  const [showFullDescription, setShowFullDescription] = useState(false);

  const shortDescription = metadata?.short_description || null;
  const rawAboutTheGame = metadata?.about_the_game || null;
  const rawDetailedDescription = metadata?.detailed_description || null;

  const aboutTheGame = rawAboutTheGame ? stripHtml(rawAboutTheGame) : null;
  const detailedDescription = rawDetailedDescription ? stripHtml(rawDetailedDescription) : null;

  const publishers = metadata?.publishers ?? [];
  const genres = metadata?.genres ?? [];
  const categories = metadata?.categories ?? [];
  const releaseDate = metadata?.release_date || null;

  const primaryText = (() => {
    if (shortDescription) return shortDescription;
    if (aboutTheGame) return aboutTheGame.slice(0, MAX_SHORT_DESCRIPTION_LENGTH);
    if (detailedDescription) return detailedDescription.slice(0, MAX_SHORT_DESCRIPTION_LENGTH);
    return "";
  })();

  const longText = (() => {
    const source = aboutTheGame ?? detailedDescription;
    if (!source) return null;
    if (source === primaryText) return null;
    return source;
  })();

  const shouldClamp = longText !== null && longText.length > MAX_LONG_PREVIEW;
  const displayLongText = shouldClamp && !showFullDescription
    ? longText!.slice(0, MAX_LONG_PREVIEW)
    : longText;

  const hasContent = !!primaryText || genres.length > 0 || categories.length > 0 || publishers.length > 0 || releaseDate;

  if (!hasContent) {
    return (
      <div>
        <h2 className="text-xl font-bold text-(--color-text)">
          About {title}
        </h2>
        <p className="mt-3 leading-relaxed text-(--color-muted)">
          Game description is not available yet.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-(--color-text)">
        About {title}
      </h2>

      {primaryText && (
        <p className="mt-3 leading-relaxed text-(--color-text)/80">
          {primaryText}
        </p>
      )}

      {longText && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
            About This Game
          </h3>

          <div className="relative mt-2">
            <p className="whitespace-pre-line leading-relaxed text-(--color-text)/70">
              {displayLongText}
            </p>

            {shouldClamp && !showFullDescription && (
              <div className="absolute bottom-0 left-0 right-0 h-16 bg-linear-to-t from-(--color-surface) to-transparent" />
            )}
          </div>

          {shouldClamp && (
            <button
              type="button"
              onClick={() => setShowFullDescription(!showFullDescription)}
              className="mt-1 text-sm font-medium text-(--color-accent) transition hover:opacity-80"
            >
              {showFullDescription ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-(--color-muted)">
        {publishers.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5" />
            {publishers.join(", ")}
          </span>
        )}

        {releaseDate && (
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            {releaseDate}
          </span>
        )}
      </div>

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

      {categories.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {categories.slice(0, 6).map((cat) => (
            <span
              key={cat}
              className="rounded-md border border-(--surface-active-border) bg-white/[0.03] px-2.5 py-1 text-xs text-(--color-muted)"
            >
              {cat}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
