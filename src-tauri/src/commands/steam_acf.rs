use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepotInfo {
    pub depot_id: u64,
    pub manifest_gid: String,
    pub size: u64,
    pub os: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AcfParams {
    pub app_id: u64,
    pub game_name: String,
    pub installdir: String,
    pub buildid: String,
    pub size_on_disk: u64,
    pub depots: Vec<DepotInfo>,
    pub last_updated: Option<u64>,
    pub bytes_downloaded: Option<u64>,
    pub bytes_to_download: Option<u64>,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Create an appmanifest_{appid}.acf file in the Steam library's steamapps directory.
/// Returns the path to the created file.
pub fn create_appmanifest_acf(
    library_path: &str,
    params: &AcfParams,
    is_proton_game: bool,
) -> Result<String, String> {
    let steamapps_dir = Path::new(library_path).join("steamapps");
    fs::create_dir_all(&steamapps_dir)
        .map_err(|e| format!("Failed to create steamapps dir: {e}"))?;

    let acf_path = steamapps_dir.join(format!("appmanifest_{}.acf", params.app_id));
    let acf_content = generate_acf_content(params, is_proton_game);

    fs::write(&acf_path, &acf_content)
        .map_err(|e| format!("Failed to write ACF file: {e}"))?;

    Ok(acf_path.to_string_lossy().to_string())
}

/// Generate ACF content string matching Steam's format.
fn generate_acf_content(params: &AcfParams, is_proton_game: bool) -> String {
    let mut acf = String::new();

    // AppState section
    acf.push_str("\"AppState\"\n");
    acf.push_str("{\n");
    acf.push_str(&format!("\t\"appid\"\t\t\"{}\"\n", params.app_id));
    acf.push_str("\t\"Universe\"\t\t\"1\"\n");
    acf.push_str(&format!("\t\"name\"\t\t\"{}\"\n", escape_acf(&params.game_name)));
    acf.push_str("\t\"StateFlags\"\t\t\"4\"\n");
    acf.push_str(&format!("\t\"installdir\"\t\t\"{}\"\n", escape_acf(&params.installdir)));
    acf.push_str(&format!("\t\"SizeOnDisk\"\t\t\"{}\"\n", params.size_on_disk));
    acf.push_str(&format!("\t\"buildid\"\t\t\"{}\"\n", params.buildid));

    if let Some(ts) = params.last_updated {
        acf.push_str(&format!("\t\"LastUpdated\"\t\t\"{}\"\n", ts));
    }
    if let Some(dl) = params.bytes_downloaded {
        acf.push_str(&format!("\t\"BytesDownloaded\"\t\t\"{}\"\n", dl));
    }
    if let Some(total) = params.bytes_to_download {
        acf.push_str(&format!("\t\"BytesToDownload\"\t\t\"{}\"\n", total));
    }

    // InstalledDepots section
    acf.push_str("\t\"InstalledDepots\"\n");
    acf.push_str("\t{\n");
    for depot in &params.depots {
        acf.push_str(&format!("\t\t\"{}\"\n", depot.depot_id));
        acf.push_str("\t\t{\n");
        acf.push_str(&format!("\t\t\t\"manifest\"\t\t\"{}\"\n", depot.manifest_gid));
        acf.push_str(&format!("\t\t\t\"size\"\t\t\"{}\"\n", depot.size));
        acf.push_str("\t\t}\n");
    }
    acf.push_str("\t}\n");

    // UserConfig / MountedConfig for Proton games
    if is_proton_game {
        acf.push_str("\t\"UserConfig\"\n");
        acf.push_str("\t{\n");
        acf.push_str("\t\t\"platform_override_dest\"\t\t\"linux\"\n");
        acf.push_str("\t\t\"platform_override_source\"\t\t\"windows\"\n");
        acf.push_str("\t}\n");
        acf.push_str("\t\"MountedConfig\"\n");
        acf.push_str("\t{\n");
        acf.push_str("\t\t\"platform_override_dest\"\t\t\"linux\"\n");
        acf.push_str("\t\t\"platform_override_source\"\t\t\"windows\"\n");
        acf.push_str("\t}\n");
    } else {
        acf.push_str("\t\"UserConfig\"\n");
        acf.push_str("\t{\n");
        acf.push_str("\t}\n");
        acf.push_str("\t\"MountedConfig\"\n");
        acf.push_str("\t{\n");
        acf.push_str("\t}\n");
    }

    acf.push_str("}\n");
    acf
}

/// Escape special characters for ACF string values.
fn escape_acf(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

/// Determine if a set of depots represents a Windows-only game (needs Proton).
/// Returns true if there are Windows depots but no Linux depots.
pub fn is_proton_required(depots: &HashMap<u64, DepotInfo>) -> bool {
    let has_windows = depots.values().any(|d| {
        d.os.as_deref()
            .map(|o| o.eq_ignore_ascii_case("windows"))
            .unwrap_or(false)
    });
    let has_linux = depots.values().any(|d| {
        d.os.as_deref()
            .map(|o| o.eq_ignore_ascii_case("linux"))
            .unwrap_or(false)
    });
    has_windows && !has_linux
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn steam_acf_create(
    library_path: String,
    app_id: u64,
    game_name: String,
    installdir: String,
    buildid: String,
    size_on_disk: u64,
    depots: Vec<DepotInfo>,
    is_proton_game: bool,
) -> Result<String, String> {
    let params = AcfParams {
        app_id,
        game_name,
        installdir,
        buildid,
        size_on_disk,
        depots,
        last_updated: None,
        bytes_downloaded: None,
        bytes_to_download: None,
    };
    create_appmanifest_acf(&library_path, &params, is_proton_game)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_acf_basic() {
        let params = AcfParams {
            app_id: 730,
            game_name: "Counter-Strike 2".to_string(),
            installdir: "Counter-Strike Global Offensive".to_string(),
            buildid: "12345678".to_string(),
            size_on_disk: 30_000_000_000,
            depots: vec![DepotInfo {
                depot_id: 2555350,
                manifest_gid: "5023020258185551340".to_string(),
                size: 30_000_000_000,
                os: Some("windows".to_string()),
            }],
            last_updated: None,
            bytes_downloaded: None,
            bytes_to_download: None,
        };

        let acf = generate_acf_content(&params, false);
        assert!(acf.contains("\"AppState\""));
        assert!(acf.contains("\"appid\"\t\t\"730\""));
        assert!(acf.contains("\"name\"\t\t\"Counter-Strike 2\""));
        assert!(acf.contains("\"installdir\"\t\t\"Counter-Strike Global Offensive\""));
        assert!(acf.contains("\"buildid\"\t\t\"12345678\""));
        assert!(acf.contains("\"2555350\""));
        assert!(acf.contains("\"manifest\"\t\t\"5023020258185551340\""));
        assert!(!acf.contains("platform_override"));
    }

    #[test]
    fn test_generate_acf_proton() {
        let params = AcfParams {
            app_id: 12345,
            game_name: "Test Game".to_string(),
            installdir: "TestGame".to_string(),
            buildid: "111".to_string(),
            size_on_disk: 5_000_000_000,
            depots: vec![DepotInfo {
                depot_id: 12346,
                manifest_gid: "999".to_string(),
                size: 5_000_000_000,
                os: Some("windows".to_string()),
            }],
            last_updated: None,
            bytes_downloaded: None,
            bytes_to_download: None,
        };

        let acf = generate_acf_content(&params, true);
        assert!(acf.contains("platform_override_dest"));
        assert!(acf.contains("platform_override_source"));
        assert!(acf.contains("\"linux\""));
        assert!(acf.contains("\"windows\""));
    }

    #[test]
    fn test_is_proton_required() {
        let mut depots = HashMap::new();
        depots.insert(
            100,
            DepotInfo {
                depot_id: 100,
                manifest_gid: "111".to_string(),
                size: 1000,
                os: Some("windows".to_string()),
            },
        );
        assert!(is_proton_required(&depots));

        depots.insert(
            200,
            DepotInfo {
                depot_id: 200,
                manifest_gid: "222".to_string(),
                size: 2000,
                os: Some("linux".to_string()),
            },
        );
        assert!(!is_proton_required(&depots));
    }

    #[test]
    fn test_escape_acf() {
        assert_eq!(escape_acf("hello"), "hello");
        assert_eq!(escape_acf("he\"llo"), "he\\\"llo");
        assert_eq!(escape_acf("he\\llo"), "he\\\\llo");
        assert_eq!(escape_acf("he\nllo"), "he\\nllo");
    }
}
