import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Folder } from "lucide-react";
import { useCollections } from "../../context/CollectionsContext";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { getCachedCollectionItems } from "../../services/collectionsService";
import type { Collection } from "../../services/tauri";
import type { LibraryGame } from "../../types/libraryGame";
import { resolveProviderMediaPreviewUrl } from "../../services/gameCacheService";
import { resolveLocalImageSrc } from "../../services/localImageSrc";
import { getCardImageCandidate } from "../../services/dashboardManualGames";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";
import DashboardHorizontalRail from "./DashboardHorizontalRail";
import { useSettings } from "../../context/SettingsContext";
import { setPendingCollectionId } from "../../services/collectionNavigation";

type Props = {
  onNavigate?: (page: AppPage) => void;
  maxItems?: number;
};

function getFirstGamePreview(
  collection: Collection,
  libraryGames: LibraryGame[],
): string | null {
  const items = getCachedCollectionItems(collection.id);
  const gameById = new Map<string, LibraryGame>();
  for (const g of libraryGames) gameById.set(g.id, g);

  for (const item of items) {
    const game = gameById.get(item.gameId);
    if (!game) continue;
    const rawPath = getCardImageCandidate(game);
    if (rawPath) return rawPath;
  }
  return null;
}

function navigateToCollection(collectionId: string) {
  setPendingCollectionId(collectionId);
}

function CollectionCard({
  col,
  count,
  imgUrl,
  onNavigate,
  cardSize,
}: {
  col: Collection;
  count: number;
  imgUrl: string | null;
  onNavigate?: (page: AppPage) => void;
  cardSize: number;
}) {
  const handleClick = () => {
    navigateToCollection(col.id);
    onNavigate?.("collections");
  };

  return (
    <div
      className="shrink-0 snap-start"
      style={{ width: `min(75vw, ${cardSize}px)` }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        className="lf-dash-card group/card cursor-pointer overflow-hidden rounded-xl border border-(--surface-active-border) bg-white/[0.02] transition hover:bg-white/[0.04]"
      >
        <div className="relative aspect-video overflow-hidden">
          {imgUrl ? (
            <AsyncImage
              src={imgUrl}
              alt={col.name}
              className="h-full w-full object-cover"
              fallback={
                <div
                  className="flex h-full w-full items-center justify-center"
                  style={{
                    background: col.color
                      ? `linear-gradient(135deg, ${col.color}33, ${col.color}11)`
                      : "rgba(255,255,255,0.03)",
                  }}
                >
                  <Folder className="h-8 w-8 text-(--color-muted)/40" />
                </div>
              }
            />
          ) : col.color ? (
            <div
              className="flex h-full w-full items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${col.color}44, ${col.color}18)`,
              }}
            >
              <span className="text-lg font-bold" style={{ color: `${col.color}cc` }}>
                {col.name}
              </span>
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-white/[0.03]">
              <Folder className="h-8 w-8 text-(--color-muted)/40" />
            </div>
          )}

          <div className="pointer-events-none absolute inset-0 bg-black/30 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100" />

          <div className="absolute top-2 right-2 flex h-6 items-center gap-1 rounded-full bg-black/60 px-2 text-[11px] font-bold text-white backdrop-blur-sm">
            {count} {count === 1 ? "game" : "games"}
          </div>
        </div>

        <div className="p-3">
          <div className="flex items-center gap-2">
            {col.color && (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/10"
                style={{ backgroundColor: col.color }}
              />
            )}
            <h3 className="lf-card-title line-clamp-1 text-sm font-medium text-(--color-text)">
              {col.name}
            </h3>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CollectionsSection({ onNavigate }: Props) {
  const { t } = useTranslation();
  const { getRootCollections, getSubCollections, getCachedCollectionGameCount } = useCollections();
  const { games: libraryGames } = useLibraryGames();
  const { settings } = useSettings();
  const [mediaUrlMap, setMediaUrlMap] = useState<Record<string, string | null>>({});

  const rootCollections = getRootCollections();

  // Split into groups
  const withSubs: Collection[] = [];
  const standalone: Collection[] = [];
  for (const col of rootCollections) {
    const subs = getSubCollections(col.id);
    if (subs.length > 0) withSubs.push(col);
    else standalone.push(col);
  }

  // Collect all collection IDs we need images for
  const allCols = [...withSubs, ...standalone];
  for (const col of withSubs) {
    allCols.push(...getSubCollections(col.id));
  }

  // Resolve cover/fallback images for each collection
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      const urls: Record<string, string | null> = {};
      for (const col of allCols) {
        if (col.coverPath) {
          urls[col.id] = resolveLocalImageSrc(col.coverPath);
          continue;
        }
        const rawPath = getFirstGamePreview(col, libraryGames);
        if (rawPath) {
          urls[col.id] = await resolveProviderMediaPreviewUrl(rawPath);
        } else {
          urls[col.id] = null;
        }
      }
      if (cancelled) return;
      setMediaUrlMap((prev) => {
        if (
          Object.keys(prev).length === Object.keys(urls).length &&
          Object.entries(urls).every(([k, v]) => prev[k] === v)
        )
          return prev;
        return urls;
      });
    };
    resolve();
    return () => { cancelled = true; };
  }, [rootCollections.length, libraryGames]);

  if (rootCollections.length === 0) return null;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-(--color-text)">
            {t("sidebar.collections", "Collections")}
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            {t("dashboard.collections_desc", "Browse your game collections")}
          </p>
        </div>
      </div>

      {/* Root collections WITH sub-collections → header + rail of sub-cards */}
      {withSubs.map((col) => {
        const subs = getSubCollections(col.id);
        const totalCount = subs.reduce(
          (sum, s) => sum + getCachedCollectionGameCount(s.id), 0
        );

        return (
          <div key={`group:${col.id}`} className="mb-6">
            {/* Header row */}
            <div className="mb-3 flex items-center gap-2.5">
              {col.color && (
                <span
                  className="h-3 w-3 shrink-0 rounded-full ring-1 ring-white/10"
                  style={{ backgroundColor: col.color }}
                />
              )}
              <h3 className="text-base font-semibold text-(--color-text)">
                {col.name}
              </h3>
              <span className="text-xs text-(--color-muted)">
                {totalCount} {totalCount === 1 ? "game" : "games"} · {subs.length} {subs.length === 1 ? "collection" : "collections"}
              </span>
            </div>

            {/* Sub-collection cards rail */}
            <DashboardHorizontalRail gap={settings.dashboardGridGap}>
              {subs.map((sub) => {
                const count = getCachedCollectionGameCount(sub.id);
                const imgUrl = mediaUrlMap[sub.id] ?? null;

                return (
                  <CollectionCard
                    key={sub.id}
                    col={sub}
                    count={count}
                    imgUrl={imgUrl}
                    onNavigate={onNavigate}
                    cardSize={settings.dashboardCardSize}
                  />
                );
              })}
            </DashboardHorizontalRail>
          </div>
        );
      })}

      {/* Standalone root collections (no sub-collections) → single rail */}
      {standalone.length > 0 && (
        <DashboardHorizontalRail gap={settings.dashboardGridGap}>
          {standalone.map((col) => {
            const count = getCachedCollectionGameCount(col.id);
            const imgUrl = mediaUrlMap[col.id] ?? null;

            return (
              <CollectionCard
                key={col.id}
                col={col}
                count={count}
                imgUrl={imgUrl}
                onNavigate={onNavigate}
                cardSize={settings.dashboardCardSize}
              />
            );
          })}
        </DashboardHorizontalRail>
      )}
    </section>
  );
}
