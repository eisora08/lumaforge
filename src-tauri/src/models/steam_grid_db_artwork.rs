use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamGridDbArtwork {
    pub app_id: u32,
    /// Vertical/poster grid (typically 600x900) — used for cover
    pub grid_url: Option<String>,
    pub grid_thumb_url: Option<String>,
    /// Horizontal/landscape grid (typically 920x430, 1280x720) — used for landscape
    pub grid_horizontal_url: Option<String>,
    pub grid_horizontal_thumb_url: Option<String>,
    pub hero_url: Option<String>,
    pub logo_url: Option<String>,
    pub icon_url: Option<String>,
}
