use serde::Serialize;

#[derive(Serialize)]
pub struct InstalledLuaScript {
    pub app_id: u32,
    pub file_name: String,
    pub path: String,
    pub is_disabled: bool,
    pub file_size: u64,
    pub modified_at: u64,
}