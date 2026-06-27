export type SteamFeaturedItem = {
  app_id: number;
  name: string;

  header_image?: string | null;
  large_capsule_image?: string | null;
  small_capsule_image?: string | null;

  discounted: boolean;
  discount_percent?: number | null;
  original_price?: number | null;
  final_price?: number | null;
  currency?: string | null;

  platforms: string[];
};

export type SteamFeaturedCategory = {
  id: string;
  name: string;
  items: SteamFeaturedItem[];
};