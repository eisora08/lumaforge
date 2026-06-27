use serde::Serialize;

#[derive(Serialize)]
pub struct SteamAppMetadata {
    pub app_id: u32,
    pub name: String,
    pub developer: Option<String>,

    pub header_image: Option<String>,
    pub capsule_image: Option<String>,
    pub capsule_image_v5: Option<String>,

    pub platforms: Vec<String>,
    pub languages: Vec<String>,
    pub dlc_count: usize,

    pub resolved: bool,
}