use serde::Serialize;

#[derive(Serialize)]
pub struct SteamPaths {
    pub steam_root: String,
    pub steam_exe: String,
    pub lua_path: String,
    pub depotcache_path: String,
    pub lua_exists: bool,
    pub depotcache_exists: bool,
}