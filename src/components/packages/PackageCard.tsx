import { memo, useEffect, useMemo, useRef, useState } from "react";
import { countRender } from "../../services/perfCounters";

import {
  Flame,
  Gamepad2,
  Link2,
  Rocket,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";

import type { PackageGame, PackageSource } from "../../types/package";
import type { SteamAppMetadata } from "../../types/gameMetadata";
import type { SteamReviewSummary } from "../../types/gameReview";
import type { SgdbArtworkData } from "../../services/storeArtworkResolver";
import { useHoverPrefetch } from "../../hooks/useHoverPrefetch";


type StoreBadge = {
  type: string;
  label: string;
};

const BADGE_ICON_MAP: Record<string, typeof Sparkles> = {
  trending: Flame,
  "top-rated": Star,
  popular: Zap,
  recommended: Sparkles,
  new: Rocket,
  "has-sources": Link2,
};

type PackageCardProps = {
  game: PackageGame;
  storeMetadata?: SteamAppMetadata;
  reviewSummary?: SteamReviewSummary;
  badges?: StoreBadge[];
  variant?: "landscape" | "poster";
  sgdbArtwork?: SgdbArtworkData;
  onOpenGame?: (game: PackageGame) => void;
  onDownload?: (game: PackageGame) => void;
  onOpenDetails?: (game: PackageGame) => void;
  onOpenSourceSelector?: (game: PackageGame) => void;
  onDownloadSource?: (game: PackageGame, source: PackageSource) => void;
};

/** Steam CDN fallback URLs for known image roles. */
function getSteamCdnUrls(appId: string, variant?: "landscape" | "poster"): string[] {
  const id = parseInt(appId, 10);
  if (!id || isNaN(id) || id <= 0) return [];
  const base = `https://cdn.akamai.steamstatic.com/steam/apps/${id}`;
  if (variant === "poster") {
    return [
      `${base}/library_600x900.jpg`,
      `${base}/capsule_616x353.jpg`,
      `${base}/header.jpg`,
    ];
  }
  return [
    `${base}/capsule_616x353.jpg`,
    `${base}/header.jpg`,
    `${base}/library_600x900.jpg`,
  ];
}

/** Return all candidate image URLs in priority order for fallback. */
function getBestCardImageChain(
  game: PackageGame,
  metadata?: SteamAppMetadata,
  variant?: "landscape" | "poster",
  sgdbArtwork?: SgdbArtworkData,
): string[] {
  const cdnUrls = getSteamCdnUrls(game.appId, variant);
  const metadataUrls = (() => {
    const c = variant === "poster"
      ? [metadata?.capsule_image_v5, metadata?.capsule_image, game.imageUrl, metadata?.header_image]
      : [metadata?.header_image, game.imageUrl, metadata?.capsule_image, metadata?.capsule_image_v5];
    return c.filter((u): u is string => typeof u === "string");
  })();

  const allUrls: string[] = [];

  // Poster variant: SGDB cover is king (portrait/cover art)
  if (variant === "poster" && sgdbArtwork?.sgdbCoverUrl) {
    allUrls.push(sgdbArtwork.sgdbCoverUrl);
  }

  // Landscape variant: SGDB hero first
  if (variant === "landscape" && sgdbArtwork?.sgdbHeroUrl) {
    allUrls.push(sgdbArtwork.sgdbHeroUrl);
  }

  // Steam metadata + CDN fallbacks
  for (const url of metadataUrls) {
    if (!allUrls.includes(url)) allUrls.push(url);
  }
  for (const url of cdnUrls) {
    if (!allUrls.includes(url)) allUrls.push(url);
  }
  return allUrls;
}

/** Custom comparator for React.memo — compares only visible props. */
function arePackageCardPropsEqual(
  a: PackageCardProps,
  b: PackageCardProps,
): boolean {
  // Game identity (stable key)
  if (a.game.appId !== b.game.appId) return false;
  // Game display fields
  if (a.game.title !== b.game.title) return false;
  if (a.game.imageUrl !== b.game.imageUrl) return false;
  const aSources = a.game.sources.filter((s) => s.available).length;
  const bSources = b.game.sources.filter((s) => s.available).length;
  if (aSources !== bSources) return false;
  // Variant
  if (a.variant !== b.variant) return false;
  // Badges fingerprint
  const aBadges = a.badges?.map((b) => `${b.type}:${b.label}`).join(",") ?? "";
  const bBadges = b.badges?.map((b) => `${b.type}:${b.label}`).join(",") ?? "";
  if (aBadges !== bBadges) return false;
  // Handler identity (stable if callbacks are useCallback-ed)
  if (a.onOpenDetails !== b.onOpenDetails) return false;
  if (a.onOpenSourceSelector !== b.onOpenSourceSelector) return false;
  if (a.onDownload !== b.onDownload) return false;
  if (a.onOpenGame !== b.onOpenGame) return false;
  // Store metadata relevant display fields
  const aMeta = a.storeMetadata;
  const bMeta = b.storeMetadata;
  if ((aMeta === undefined) !== (bMeta === undefined)) return false;
  if (aMeta && bMeta) {
    if (aMeta.name !== bMeta.name) return false;
    if (aMeta.developer !== bMeta.developer) return false;
    if (aMeta.header_image !== bMeta.header_image) return false;
    if (aMeta.capsule_image !== bMeta.capsule_image) return false;
    if (aMeta.capsule_image_v5 !== bMeta.capsule_image_v5) return false;
    const aPlats = aMeta.platforms?.slice().sort().join(",") ?? "";
    const bPlats = bMeta.platforms?.slice().sort().join(",") ?? "";
    if (aPlats !== bPlats) return false;
    const aGenres = aMeta.genres?.slice().sort().join(",") ?? "";
    const bGenres = bMeta.genres?.slice().sort().join(",") ?? "";
    if (aGenres !== bGenres) return false;
  }
  // Review summary — compare positive_percent for score badge reactivity
  const aRev = a.reviewSummary?.positive_percent;
  const bRev = b.reviewSummary?.positive_percent;
  if (aRev !== bRev) return false;
  // SGDB artwork — compare cover and hero URLs
  if (a.sgdbArtwork?.sgdbCoverUrl !== b.sgdbArtwork?.sgdbCoverUrl) return false;
  if (a.sgdbArtwork?.sgdbHeroUrl !== b.sgdbArtwork?.sgdbHeroUrl) return false;
  return true;
}

function getStoreTitle(game: PackageGame, metadata?: SteamAppMetadata) {
  return metadata?.name || game.title;
}

function getStoreDeveloper(game: PackageGame, metadata?: SteamAppMetadata) {
  return metadata?.developer || game.developer || "Developer unknown";
}

function CardImage({
  src,
  alt,
  objectClass,
  onError,
}: {
  src: string;
  alt: string;
  objectClass: string;
  onError: () => void;
}) {
  return (
    <img
      src={src}
      alt={alt}
      className={`h-full w-full transition duration-500 ${objectClass}`}
      loading="lazy"
      onError={onError}
    />
  );
}

function PackageCardRaw({
  game,
  storeMetadata,
  reviewSummary,
  badges,
  variant = "landscape",
  sgdbArtwork,
  onOpenGame,
  onOpenDetails,
}: PackageCardProps) {
  countRender("PackageCard");

  const [imageFailed, setImageFailed] = useState(false);
  const [imageFallbackIndex, setImageFallbackIndex] = useState(0);
  const { onMouseEnter, onMouseLeave } = useHoverPrefetch(game.appId);

  const _mountedRef = useRef(true);
  useEffect(() => {
    _mountedRef.current = true;
    return () => { _mountedRef.current = false; };
  }, []);

  const displayTitle = getStoreTitle(game, storeMetadata);
  const displayDeveloper = getStoreDeveloper(game, storeMetadata);
  const imageFallbackChain = useMemo(
    () => getBestCardImageChain(game, storeMetadata, variant, sgdbArtwork),
    [game, storeMetadata, variant, sgdbArtwork],
  );
  const displayImageUrl: string | undefined = imageFallbackChain[imageFallbackIndex];
  const hasMoreFallbacks = imageFallbackIndex + 1 < imageFallbackChain.length;

  function handleOpenDetails(event?: React.MouseEvent) {
    event?.stopPropagation();

    if (onOpenDetails) {
      onOpenDetails(game);
    } else if (onOpenGame) {
      onOpenGame(game);
    }
  }

  if (variant === "poster") {
    const displayGenres = storeMetadata?.genres?.slice(0, 2) ?? [];
    const scorePercent = reviewSummary?.positive_percent;

    return (
      <article
        role="button"
        tabIndex={0}
        onClick={handleOpenDetails}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleOpenDetails();
        }}
        className="group relative aspect-[2/3] cursor-pointer overflow-hidden rounded-2xl border border-(--surface-active-border) bg-white/5 transition-all duration-300 hover:border-(--color-accent)/40 hover:shadow-xl hover:shadow-black/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)"
      >
        {/* Full-bleed cover image */}
        {displayImageUrl && !imageFailed ? (
          <CardImage
            src={displayImageUrl}
            alt={displayTitle}
            objectClass="object-cover"
            onError={() => {
              if (!_mountedRef.current) return;
              if (hasMoreFallbacks) {
                setImageFallbackIndex(imageFallbackIndex + 1);
              } else {
                setImageFailed(true);
              }
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/5">
            <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
          </div>
        )}

        {/* Score badge — always visible */}
        {scorePercent != null && (
          <div className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-[10px] font-bold text-white backdrop-blur-sm">
            {Math.round(scorePercent)}
          </div>
        )}

        {/* Section badges — always visible */}
        {badges && badges.length > 0 && (
          <div className="absolute left-2 top-2 z-20 flex gap-1">
            {badges.slice(0, 2).map((badge) => {
              const Icon = BADGE_ICON_MAP[badge.type];
              return (
                <span
                  key={badge.type}
                  className="inline-flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm"
                >
                  {Icon && <Icon className="h-2.5 w-2.5" />}
                  {badge.label}
                </span>
              );
            })}
          </div>
        )}

        {/* Hover overlay — darkens smoothly */}
        <div className="absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/50" />

        {/* Info block — slides up on hover */}
        <div className="absolute inset-x-0 bottom-0 z-10 translate-y-2 px-3 pb-3 pt-8 opacity-0 transition-all duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white drop-shadow-lg">
            {displayTitle}
          </h3>
          {displayDeveloper && (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-white/70">
              {displayDeveloper}
            </p>
          )}
          {displayGenres.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {displayGenres.map((genre) => (
                <span
                  key={genre}
                  className="rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] font-medium text-white/80 backdrop-blur-sm"
                >
                  {genre}
                </span>
              ))}
            </div>
          )}
        </div>
      </article>
    );
  }

  const displayGenres = useMemo(
    () => storeMetadata?.genres?.slice(0, 3) ?? [],
    [storeMetadata?.genres],
  );
  const scorePercent = reviewSummary?.positive_percent;
  const scoreColor = scorePercent != null
    ? scorePercent >= 75 ? "bg-emerald-500" : scorePercent >= 50 ? "bg-amber-500" : "bg-red-500"
    : null;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={handleOpenDetails}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          handleOpenDetails();
        }
      }}
      className="group relative aspect-video cursor-pointer overflow-hidden rounded-2xl border border-(--surface-active-border) bg-white/5 transition-all duration-300 hover:border-(--color-accent)/40 hover:shadow-xl hover:shadow-black/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)"
    >
      {displayImageUrl && !imageFailed ? (
        <CardImage
          src={displayImageUrl}
          alt={displayTitle}
          objectClass="object-cover"
          onError={() => {
            if (!_mountedRef.current) return;
            if (hasMoreFallbacks) {
              setImageFallbackIndex(imageFallbackIndex + 1);
            } else {
              setImageFailed(true);
            }
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-white/5">
          <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
        </div>
      )}

      {/* Score badge — always visible */}
      {scoreColor && scorePercent != null && (
        <div className={`absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full ${scoreColor} text-[10px] font-bold text-white shadow-md`}>
          {Math.round(scorePercent)}
        </div>
      )}

      {/* Section badges — always visible */}
      {badges && badges.length > 0 && (
        <div className="pointer-events-none absolute left-2 top-2 z-20 flex gap-1.5">
          {badges.map((badge) => {
            const Icon = BADGE_ICON_MAP[badge.type];
            return (
              <span
                key={badge.type}
                className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm"
              >
                {Icon && <Icon className="h-3 w-3" />}
                {badge.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Hover overlay — darkens smoothly */}
      <div className="absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/50" />

      {/* Info block — slides up on hover, no padding */}
      <div className="absolute inset-x-0 bottom-0 z-10 translate-y-2 opacity-0 transition-all duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100">
        <h3 className="line-clamp-1 px-3 text-sm font-semibold leading-snug text-white drop-shadow-lg">
          {displayTitle}
        </h3>
        {displayDeveloper && (
          <p className="mt-0.5 line-clamp-1 px-3 text-[11px] text-white/70">
            {displayDeveloper}
          </p>
        )}
        {displayGenres.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1 px-3 pb-3">
            {displayGenres.map((genre) => (
              <span
                key={genre}
                className="rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] font-medium text-white/80 backdrop-blur-sm"
              >
                {genre}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

export default memo(PackageCardRaw, arePackageCardPropsEqual);
