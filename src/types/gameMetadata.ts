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

  resolved: boolean;
};