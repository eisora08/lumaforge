export type SteamGridDbArtwork = {
  appId: number;
  /** Vertical/poster grid (600x900) — used for cover */
  gridUrl?: string;
  gridThumbUrl?: string;
  /** Horizontal/landscape grid (920x430, 1280x720) — used for landscape */
  gridHorizontalUrl?: string;
  gridHorizontalThumbUrl?: string;
  heroUrl?: string;
  logoUrl?: string;
  iconUrl?: string;
};
