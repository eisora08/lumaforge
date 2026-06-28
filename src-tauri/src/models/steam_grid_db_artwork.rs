use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamGridDbArtwork {
    pub app_id: u32,
    pub grid_url: Option<String>,
    pub grid_thumb_url: Option<String>,
    pub hero_url: Option<String>,
}
