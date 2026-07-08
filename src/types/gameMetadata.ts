export type SystemRequirements = {
  minimum?: string | null;
  recommended?: string | null;
};

export type SteamMovie = {
  id: number;
  name: string;
  thumbnail?: string | null;
  mp4_max?: string | null;
  mp4_480?: string | null;
  webm_max?: string | null;
  webm_480?: string | null;
  hls?: string | null;
  hls_h264?: string | null;
  dash?: string | null;
  dash_h264?: string | null;
  dash_av1?: string | null;
  highlight: boolean;
};

export type SteamAppMetadata = {
  app_id: number;
  name: string;
  developer?: string | null;

  header_image?: string | null;
  capsule_image?: string | null;
  capsule_image_v5?: string | null;

  library_hero_image?: string | null;
  background_image?: string | null;
  hero_image?: string | null;
  library_header_image?: string | null;
  wide_cover_image?: string | null;
  logo_image?: string | null;
  library_logo_image?: string | null;

  platforms: string[];
  languages: string[];
  dlc_count: number;

  short_description?: string | null;
  detailed_description?: string | null;
  about_the_game?: string | null;
  legal_notice?: string | null;
  store_drm_notice?: string | null;
  genres: string[];
  publishers: string[];
  release_date?: string | null;
  categories: string[];
  dlc_app_ids: number[];

  pc_requirements?: SystemRequirements | null;
  mac_requirements?: SystemRequirements | null;
  linux_requirements?: SystemRequirements | null;

  screenshots?: string[];
  movies?: SteamMovie[];

  resolved: boolean;
};