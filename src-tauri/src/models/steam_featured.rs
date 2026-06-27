use serde::Serialize;

#[derive(Serialize)]
pub struct SteamFeaturedCategory {
    pub id: String,
    pub name: String,
    pub items: Vec<SteamFeaturedItem>,
}

#[derive(Serialize)]
pub struct SteamFeaturedItem {
    pub app_id: u32,
    pub name: String,

    pub header_image: Option<String>,
    pub large_capsule_image: Option<String>,
    pub small_capsule_image: Option<String>,

    pub discounted: bool,
    pub discount_percent: Option<i64>,
    pub original_price: Option<i64>,
    pub final_price: Option<i64>,
    pub currency: Option<String>,

    pub platforms: Vec<String>,
}