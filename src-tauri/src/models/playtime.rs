use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaytimeStore {
    pub version: u32,
    #[serde(rename = "updatedAt")]
    pub updated_at: u64,
    pub games: std::collections::HashMap<String, PlaytimeEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaytimeEntry {
    #[serde(rename = "gameKey")]
    pub game_key: String,
    #[serde(rename = "appId")]
    pub app_id: Option<String>,
    pub provider: String,
    pub title: String,

    #[serde(rename = "externalPlaytimeSeconds")]
    pub external_playtime_seconds: u64,
    #[serde(rename = "externalSource")]
    pub external_source: Option<String>,
    #[serde(rename = "externalImportedAt")]
    pub external_imported_at: Option<u64>,

    #[serde(rename = "localPlaytimeSeconds")]
    pub local_playtime_seconds: u64,
    #[serde(rename = "totalPlaytimeSeconds")]
    pub total_playtime_seconds: u64,

    #[serde(rename = "lastPlayedAt")]
    pub last_played_at: Option<u64>,
    #[serde(rename = "lastSessionSeconds")]
    pub last_session_seconds: Option<u64>,

    pub sessions: Vec<PlaytimeSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaytimeSession {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "startedAt")]
    pub started_at: u64,
    #[serde(rename = "endedAt")]
    pub ended_at: Option<u64>,
    #[serde(rename = "durationSeconds")]
    pub duration_seconds: Option<u64>,
    #[serde(rename = "exitReason")]
    pub exit_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivePlaySession {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "startedAt")]
    pub started_at: u64,
    #[serde(rename = "gameKey")]
    pub game_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaySessionStart {
    #[serde(rename = "gameKey")]
    pub game_key: String,
    #[serde(rename = "appId")]
    pub app_id: Option<String>,
    pub provider: String,
    pub title: String,
    #[serde(rename = "startedAt")]
    pub started_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaySessionEnd {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "gameKey")]
    pub game_key: String,
    #[serde(rename = "endedAt")]
    pub ended_at: u64,
    #[serde(rename = "exitReason")]
    pub exit_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalPlaytimeImport {
    #[serde(rename = "gameKey")]
    pub game_key: String,
    #[serde(rename = "appId")]
    pub app_id: Option<String>,
    pub provider: String,
    pub title: Option<String>,
    #[serde(rename = "externalPlaytimeSeconds")]
    pub external_playtime_seconds: u64,
    #[serde(rename = "externalSource")]
    pub external_source: String,
}

pub const PLAYTIME_STORE_VERSION: u32 = 1;
pub const MAX_SESSIONS_PER_GAME: usize = 50;
