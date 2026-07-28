import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Gamepad2 } from "lucide-react";
import AsyncImage from "../../common/AsyncImage";

import type { SteamAppMetadata } from "../../../types/gameMetadata";
import { openExternalUrl } from "../../../services/externalLinks";
import { getSteamStoreUrl } from "../../../utils/steamLinks";

type StoreGameDlcSectionProps = {
  dlcCount: number;
  dlcMetadata?: SteamAppMetadata[];
};

export default function StoreGameDlcSection({
  dlcCount,
  dlcMetadata = [],
}: StoreGameDlcSectionProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const validDlcItems = useMemo(
    () => dlcMetadata.filter((d) => d.resolved),
    [dlcMetadata],
  );

  const hasCards = validDlcItems.length > 0;
  const _lastDlcScrollUpdate = useRef(0);

  function checkScroll() {
    const now = Date.now();
    if (now - _lastDlcScrollUpdate.current < 100) return;
    _lastDlcScrollUpdate.current = now;
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }

  useEffect(() => {
    const id = setTimeout(checkScroll, 100);
    return () => clearTimeout(id);
  }, [validDlcItems.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    return () => el.removeEventListener("scroll", checkScroll);
  }, [validDlcItems.length]);

  function scrollRight() {
    const el = scrollRef.current;
    if (!el) return;
    const itemWidth = el.querySelector("button")?.offsetWidth ?? 200;
    el.scrollBy({ left: itemWidth + 12, behavior: "smooth" });
    setTimeout(checkScroll, 350);
  }

  function scrollLeft() {
    const el = scrollRef.current;
    if (!el) return;
    const itemWidth = el.querySelector("button")?.offsetWidth ?? 200;
    el.scrollBy({ left: -(itemWidth + 12), behavior: "smooth" });
    setTimeout(checkScroll, 350);
  }

  return (
    <section className="rounded-3xl border border-(--surface-active-border) bg-white/5 p-5 lg:p-6">
      <h2 className="text-lg font-bold text-(--color-text)">
        Content For This Game
      </h2>

      <p className="mt-1 text-sm text-(--color-muted)">
        DLC and add-ons detected from Steam metadata.
      </p>

      {dlcCount === 0 && (
        <div className="mt-4 rounded-xl border border-(--surface-active-border) bg-black/20 p-4 text-sm text-(--color-muted)">
          No additional content detected for this game.
        </div>
      )}

      {dlcCount > 0 && !hasCards && (
        <div className="mt-4 rounded-xl border border-(--surface-active-border) bg-black/20 p-4">
          <p className="text-sm font-medium text-(--color-text)">
            {dlcCount} DLC{dlcCount !== 1 ? "s" : ""} Available
          </p>
          <p className="mt-1 text-xs text-(--color-muted)">
            Detailed DLC metadata is not available yet.
          </p>
        </div>
      )}

      {hasCards && (
        <div className="relative mt-4">
          {canScrollLeft && (
            <button
              type="button"
              onClick={scrollLeft}
              className="absolute -left-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-(--surface-active-border) bg-black/60 text-(--color-text) backdrop-blur-md transition hover:bg-black/80"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}

          <div
            ref={scrollRef}
            className="flex gap-3 overflow-x-auto pb-2 scrollbar-none"
          >
            {validDlcItems.map((dlc) => (
              <button
                key={dlc.app_id}
                type="button"
                onClick={() =>
                  openExternalUrl(getSteamStoreUrl(dlc.app_id))
                }
                className="w-44 shrink-0 cursor-pointer overflow-hidden rounded-2xl border border-(--surface-active-border) bg-white/5 text-left transition hover:border-(--color-accent)/40"
              >
                <div className="aspect-video overflow-hidden bg-white/5">
                  <AsyncImage
                    src={dlc.header_image}
                    alt={dlc.name}
                    className="h-full w-full"
                    fallback={
                      <div className="flex h-full w-full items-center justify-center">
                        <Gamepad2 className="h-8 w-8 text-(--color-muted)" />
                      </div>
                    }
                  />
                </div>

                <div className="p-3">
                  <p className="line-clamp-2 text-sm font-semibold text-(--color-text)">
                    {dlc.name}
                  </p>

                  <p className="mt-1 text-xs text-(--color-muted)">
                    AppID {dlc.app_id}
                  </p>

                  <span className="mt-2 inline-flex items-center gap-1 rounded-md border border-(--surface-active-border) bg-white/5 px-2 py-0.5 text-[10px] text-(--color-muted)">
                    <ExternalLink className="h-2.5 w-2.5" />
                    Steam
                  </span>
                </div>
              </button>
            ))}
          </div>

          {canScrollRight && (
            <button
              type="button"
              onClick={scrollRight}
              className="absolute -right-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-(--surface-active-border) bg-black/60 text-(--color-text) backdrop-blur-md transition hover:bg-black/80"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
