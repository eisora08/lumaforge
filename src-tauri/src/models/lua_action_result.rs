
use serde::Serialize;

#[derive(Serialize)]
pub struct LuaActionResult {
    pub success: bool,
    pub message: String,
}
