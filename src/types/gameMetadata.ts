export type SteamAppMetadata = {
  app_id: number;
  name: string;
  developer?: string | null;

  header_image?: string | null;
  capsule_image?: string | null;
  capsule_image_v5?: string | null;

  platforms: string[];
  languages: string[];
  dlc_count: number;

  short_description?: string | null;
  detailed_description?: string | null;
  genres: string[];
  publisher?: string | null;
  release_date?: string | null;
  categories: string[];

  resolved: boolean;
};