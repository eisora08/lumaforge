use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalExecutableGame {
    pub executable_path: String,
    pub file_name: String,
    pub directory_name: String,
}
