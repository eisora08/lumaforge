use serde::Serialize;

#[derive(Serialize)]
pub struct SteamAppMetadata {
    pub app_id: u32,
    pub name: String,
    pub developer: Option<String>,

    pub header_image: Option<String>,
    pub capsule_image: Option<String>,
    pub capsule_image_v5: Option<String>,

    pub library_hero_image: Option<String>,
    pub background_image: Option<String>,
    pub hero_image: Option<String>,
    pub library_header_image: Option<String>,
    pub wide_cover_image: Option<String>,
    pub logo_image: Option<String>,
    pub library_logo_image: Option<String>,

    pub platforms: Vec<String>,
    pub languages: Vec<String>,
    pub dlc_count: usize,

    pub short_description: Option<String>,
    pub detailed_description: Option<String>,
    pub about_the_game: Option<String>,
    pub genres: Vec<String>,
    pub publishers: Vec<String>,
    pub release_date: Option<String>,
    pub categories: Vec<String>,
    pub dlc_app_ids: Vec<u32>,

    pub pc_requirements: Option<SystemRequirements>,
    pub mac_requirements: Option<SystemRequirements>,
    pub linux_requirements: Option<SystemRequirements>,

    pub screenshots: Vec<String>,

    pub resolved: bool,
}

#[derive(Serialize)]
pub struct SystemRequirements {
    pub minimum: Option<String>,
    pub recommended: Option<String>,
}