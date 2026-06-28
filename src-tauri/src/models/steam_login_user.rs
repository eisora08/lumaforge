use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamLoginUser {
    pub steam_id: String,
    pub account_name: String,
    pub persona_name: String,
    pub remember_password: bool,
    pub timestamp: u64,
}
