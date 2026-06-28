use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamUserGameStats {
    pub app_id: u32,
    pub steam_id: Option<String>,
    pub last_played: Option<u64>,
    pub playtime_minutes: Option<u64>,
    pub playtime_2weeks: Option<u64>,
    pub cloud_status: Option<String>,
    pub autocloud_last_launch: Option<u64>,
    pub autocloud_last_exit: Option<u64>,
}
