use serde::Serialize;

#[derive(Serialize)]
pub struct GameNameResult {
    pub app_id: u32,
    pub name: String,
    pub resolved: bool,
}