import type { LibraryGame } from "../../types/libraryGame";

type ConsoleMediaShape = {
  heroSrc?: string | null;
  coverSrc?: string | null;
  landscapeSrc?: string | null;
  backgroundSrc?: string | null;
};

export function getConsoleHeroBackground(game: LibraryGame | null): string | null {
  if (!game) return null;

  const cm = (game as { _consoleMedia?: ConsoleMediaShape })._consoleMedia;
  if (cm?.heroSrc) return cm.heroSrc;

  const candidates = [
    game.metadata?.library_hero_image,
    game.metadata?.background_image,
    game.metadata?.header_image,
    game.imageUrl,
  ];
  return candidates.find(Boolean) ?? null;
}

export function getConsoleCardSrc(
  game: LibraryGame | null,
  variant: "landscape" | "poster" = "landscape",
): string | null {
  if (!game) return null;

  const cm = (game as { _consoleMedia?: ConsoleMediaShape })._consoleMedia;

  if (variant === "poster") {
    if (cm?.coverSrc) return cm.coverSrc;
    const candidates = [
      game.metadata?.capsule_image_v5,
      game.metadata?.header_image,
      game.imageUrl,
    ];
    return candidates.find(Boolean) ?? null;
  }

  const localLandscape = cm?.landscapeSrc || cm?.backgroundSrc;
  if (localLandscape) return localLandscape;
  const candidates = [
    game.metadata?.header_image,
    game.metadata?.library_hero_image,
    game.imageUrl,
  ];
  return candidates.find(Boolean) ?? null;
}
