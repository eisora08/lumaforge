export type SteamReviewSummary = {
  app_id: number;
  review_score: number;
  review_score_desc: string;
  total_positive: number;
  total_negative: number;
  total_reviews: number;
  positive_percent?: number | null;
  resolved: boolean;
};