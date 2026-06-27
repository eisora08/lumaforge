use serde::Serialize;

#[derive(Serialize)]
pub struct SteamReviewSummary {
    pub app_id: u32,
    pub review_score: i64,
    pub review_score_desc: String,
    pub total_positive: u64,
    pub total_negative: u64,
    pub total_reviews: u64,
    pub positive_percent: Option<u8>,
    pub resolved: bool,
}