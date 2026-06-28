export type GameArtwork = {
  appId?: string;
  localId?: string;
  coverUrl?: string;
  heroUrl?: string;
  logoUrl?: string;
  iconUrl?: string;
  source: "steamgriddb" | "steam" | "cache" | "fallback";
  updatedAt?: number;
};