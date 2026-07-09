import { Gamepad2, Heart } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import { useFavorites } from "../../context/FavoritesContext";
import { getConsoleCardSrc } from "./consoleMedia";

type Props = {
  game: LibraryGame;
  isFocused?: boolean;
  onClick?: () => void;
  compact?: boolean;
  variant?: "landscape" | "poster";
  noLabel?: boolean;
  cardWidth?: number;
  noTitle?: boolean;
};

export default function ConsoleGameCard({ game, isFocused, onClick, compact, variant = "landscape", noLabel, cardWidth, noTitle }: Props) {
  const { isFavorite } = useFavorites();
  const fav = game.appId ? isFavorite(game.appId) : false;
  const isSpotlight = !compact;

  const src = getConsoleCardSrc(game, variant);

  const widthStyle = cardWidth ? { width: `${cardWidth}px` } : undefined;

  const spotlightFocusStyle = isFocused && isSpotlight ? {
    boxShadow: "0 35px 80px -20px rgba(0,0,0,0.7), 0 0 50px color-mix(in srgb, var(--color-accent) 30%, transparent)",
  } as React.CSSProperties : undefined;

  return (
    <div
      role="button"
      tabIndex={isFocused ? 0 : -1}
      aria-label={game.title}
      onClick={onClick}
      className={`relative cursor-pointer rounded-2xl border transition-all duration-[260ms] ease-out shrink-0 ${
        compact ? "" : variant === "poster" ? "w-[200px]" : "w-[280px]"
      } ${cardWidth ? "" : "shrink-0"} ${
        isFocused
          ? `z-[80] border-(--color-accent) ring-3 ring-(--color-accent)/70 shadow-none saturate-[1.05] brightness-[1.03] ${
              isSpotlight ? "scale-[1.18] -translate-y-11" : "scale-[1.04]"
            }`
          : `${
              isSpotlight
                ? "z-[5] scale-[0.96] opacity-[0.78] brightness-[0.88] hover:!z-[30] hover:!scale-[1.04] hover:!-translate-y-2.5 hover:!opacity-100 hover:!brightness-100"
                : ""
            } border-(--surface-active-border) hover:border-(--color-accent)/40 hover:shadow-lg hover:shadow-(--color-accent)/10`
      }`}
      style={{ ...widthStyle, ...spotlightFocusStyle, willChange: "transform" }}
    >
      <div className={`relative overflow-hidden rounded-2xl ${
        variant === "poster" ? "aspect-[2/3]" : "aspect-[16/10]"
      }`}>
        {src ? (
          <img
            key={game.appId}
            src={src}
            alt={game.title}
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-(--color-surface)/40">
            <Gamepad2 className="h-10 w-10 text-(--color-muted)/30" />
          </div>
        )}

        {/* Hover overlay */}
        <div className="pointer-events-none absolute inset-0 bg-black/20 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100" />

        {/* Focus shine sweep — only on focused card */}
        {isFocused && (
          <div
            className="console-card-shine pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
            style={{ mixBlendMode: "screen" }}
          >
            <div
              className="absolute inset-0"
              style={{
                background: "linear-gradient(105deg, transparent 25%, rgba(255,255,255,0.12) 40%, rgba(255,255,255,0.18) 45%, rgba(255,255,255,0.12) 50%, transparent 65%)",
                animation: "console-shine-sweep 1.8s ease-in-out infinite",
              }}
            />
          </div>
        )}

        {/* Favorite heart */}
        {fav && (
          <div className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
            <Heart className="h-3.5 w-3.5 fill-rose-400 text-rose-400" />
          </div>
        )}

        {/* Badges */}
        <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
          {game.steamInstalled && (
            <span className="rounded-md bg-emerald-500/80 px-2 py-0.5 text-[10px] font-medium text-black backdrop-blur-sm">
              Installed
            </span>
          )}
          {game.isLuaActive && (
            <span className="rounded-md bg-violet-500/80 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
              Lua
            </span>
          )}
          {game.hasUpdate && (
            <span className="rounded-md bg-amber-500/80 px-2 py-0.5 text-[10px] font-medium text-black backdrop-blur-sm">
              Update
            </span>
          )}
        </div>

        {/* Title gradient overlay for landscape variant — hidden with noTitle */}
        {variant !== "poster" && !noTitle && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pt-8 pb-2">
            <h3 className="line-clamp-2 text-sm font-semibold text-white leading-tight">
              {game.title}
            </h3>
          </div>
        )}
      </div>

      {/* Title below for poster variant — hidden with noLabel or noTitle */}
      {variant === "poster" && !noLabel && !noTitle && (
        <div className="px-1.5 pt-1.5 pb-1.5">
          <h3 className="line-clamp-2 text-xs font-semibold text-(--color-text) leading-snug">
            {game.title}
          </h3>
        </div>
      )}
    </div>
  );
}
