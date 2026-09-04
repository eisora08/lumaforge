/* ── Synchronous card/hero media extractors ──
 *
 * Cache-behavior guarantee: ZERO network calls. These helpers only read
 * pre-resolved _consoleMedia fields or game.metadata directly. They are safe
 * to call from any render path or focus handler.
 *
 * Network resolution (SGDB, provider APIs) must happen in effects via
 * resolveConsoleDetailsArtwork (consoleArtworkResolver.ts).
 */

import type { LibraryGame } from "../../types/libraryGame";

type ConsoleMediaShape = {
  heroSrc?: string | null;
  coverSrc?: string | null;
  landscapeSrc?: string | null;
  backgroundSrc?: string | null;
  logoSrc?: string | null;
};

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|tiff?|avif|svg)(\?.*)?$/i;

function isRawDirectoryPath(p: string | null | undefined): boolean {
  if (!p) return false;
  if (/^https?:\/\//i.test(p)) return false;
  if (p.startsWith("asset://") || p.startsWith("data:") || p.startsWith("file://")) return false;
  if (IMAGE_EXTENSIONS.test(p)) return false;
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("/")) return true;
  return false;
}

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
  variant: "landscape" | "poster" | "hero" = "landscape",
): string | null {
  if (!game) return null;

  const cm = (game as { _consoleMedia?: ConsoleMediaShape })._consoleMedia;

  if (variant === "hero") {
    if (cm?.backgroundSrc) return cm.backgroundSrc;
    if (cm?.landscapeSrc) return cm.landscapeSrc;
    const candidates = [
      game.backgroundPath,
      game.metadata?.library_hero_image,
      game.metadata?.header_image,
      game.imageUrl,
    ];
    const result = candidates.find((c) => !!c && !isRawDirectoryPath(c)) ?? null;
    return result;
  }

  if (variant === "poster") {
    if (cm?.coverSrc) return cm.coverSrc;
    const candidates = [
      game.metadata?.capsule_image_v5,
      game.metadata?.header_image,
      game.imageUrl,
    ];
    const result = candidates.find((c) => !!c && !isRawDirectoryPath(c)) ?? null;
    return result;
  }

  const localLandscape = cm?.landscapeSrc || cm?.backgroundSrc;
  if (localLandscape) return localLandscape;
  const candidates = [
    game.metadata?.header_image,
    game.metadata?.library_hero_image,
    game.imageUrl,
  ];
  const result = candidates.find((c) => !!c && !isRawDirectoryPath(c)) ?? null;
  return result;
}

export function getConsoleLogoSrc(game: LibraryGame | null): string | null {
  if (!game) return null;

  const cm = (game as { _consoleMedia?: ConsoleMediaShape })._consoleMedia;
  if (cm?.logoSrc) return cm.logoSrc;

  const candidates = [
    game.metadata?.logo_image,
    game.metadata?.library_logo_image,
  ];
  return candidates.find(Boolean) ?? null;
}
