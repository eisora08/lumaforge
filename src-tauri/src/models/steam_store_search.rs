
use serde::Serialize;

#[derive(Serialize)]
pub struct SteamStoreSearchItem {
    pub app_id: u32,
    pub name: String,
    pub image_url: Option<String>,
    pub price_label: Option<String>,
    pub discount_label: Option<String>,
}
