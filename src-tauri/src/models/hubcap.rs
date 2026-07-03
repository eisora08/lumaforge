use serde::Serialize;

#[derive(Serialize)]
pub struct HubcapHealthResponse {
    pub status: String,
    pub elapsed_ms: u64,
}

#[derive(Serialize)]
pub struct HubcapUserStatsResponse {
    pub ok: bool,
    pub status: String,
    pub username: Option<String>,
    pub today_usage: Option<i64>,
    pub daily_limit: Option<i64>,
    pub total_key_usage: Option<i64>,
    pub generation_used: Option<i64>,
    pub generation_limit: Option<i64>,
    pub depot_keys_count: Option<i64>,
    pub reset_at: Option<serde_json::Value>,
    pub reset_in_seconds: Option<i64>,
    pub remaining: Option<i64>,
    pub plan: Option<String>,
    pub last_used_at: Option<String>,
}

#[derive(Serialize)]
pub struct HubcapDepotKeysResponse {
    pub status: String,
    pub count: i64,
}
