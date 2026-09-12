use regex::Regex;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// Regex for active setManifestid lines: setManifestid(depotId,"manifestId",size)
/// Captures: (1) depot_id, (2) manifest_id, (3) optional size_on_disk
fn re_setmanifest_active() -> Regex {
    Regex::new(
        r#"^\s*setManifestid\s*\(\s*(\d+)\s*,\s*"(\d+)"\s*(?:,\s*(\d+))?\s*\)\s*$"#,
    )
    .unwrap()
}

/// Regex for commented setManifestid lines: --setManifestid(depotId,"manifestId",size)
fn re_setmanifest_commented() -> Regex {
    Regex::new(
        r#"^\s*--\s*setManifestid\s*\(\s*(\d+)\s*,\s*"(\d+)"\s*(?:,\s*(\d+))?\s*\)\s*$"#,
    )
    .unwrap()
}

/// Regex for addappid lines (active or commented)
fn re_addappid() -> Regex {
    Regex::new(
        r#"(?i)^\s*(?:--\s*)?addappid\s*\(\s*(\d+)"#,
    )
    .unwrap()
}

/// Regex for addtoken lines (active or commented)
fn re_addtoken() -> Regex {
    Regex::new(
        r#"(?i)^\s*(?:--\s*)?addtoken\s*\(\s*(\d+)"#,
    )
    .unwrap()
}

/// Generate a complete .lua file for a game.
///
/// # Arguments
/// * `lua_dir` - Directory where the .lua file will be created (typically Steam's config/lua)
/// * `app_id` - The Steam App ID
/// * `game_name` - Human-readable game name (used as comment)
/// * `depots` - List of (depot_id, optional_hex_key) tuples
/// * `tokens` - List of (app_id, token_hex) tuples
/// * `manifest_pins` - List of (depot_id, manifest_id) tuples to pin
///
/// # Returns
/// Path to the created .lua file
pub fn generate_lua_file(
    lua_dir: &Path,
    app_id: u64,
    game_name: &str,
    depots: &[(u64, Option<String>)],
    tokens: &[(u64, String)],
    manifest_pins: &[(u64, String)],
) -> Result<std::path::PathBuf, String> {
    let mut lines: Vec<String> = Vec::new();

    lines.push("-- lua by LumaForge".to_string());
    lines.push(String::new());

    // Main app entry — bare addappid if no key (reference behavior)
    // Use the first depot's key as the main key (base game depot)
    let name_comment = sanitize_lua_comment(game_name);
    let main_key = depots.first().and_then(|(_, k)| k.as_ref());
    if let Some(key) = main_key {
        if name_comment.is_empty() {
            lines.push(format!("addappid({}, 1, \"{}\")", app_id, key));
        } else {
            lines.push(format!("addappid({}, 1, \"{}\") -- {}", app_id, key, name_comment));
        }
    } else {
        if name_comment.is_empty() {
            lines.push(format!("addappid({})", app_id));
        } else {
            lines.push(format!("addappid({}) -- {}", app_id, name_comment));
        }
    }

    // Depot entries (skip the first depot which is the main app entry)
    for (i, (depot_id, key)) in depots.iter().enumerate() {
        if i == 0 {
            continue; // First depot is already added as main app entry
        }
        if let Some(k) = key {
            lines.push(format!("addappid({}, 1, \"{}\")", depot_id, k));
        }
        // Depots without key are skipped silently
    }

    // App access tokens
    for (token_app_id, token_hex) in tokens {
        lines.push(format!("addtoken({}, \"{}\")", token_app_id, token_hex));
    }

    // Manifest pins
    for (depot_id, manifest_id) in manifest_pins {
        lines.push(format!("setManifestid({},\"{}\",0)", depot_id, manifest_id));
    }

    // Ensure lua directory exists
    fs::create_dir_all(lua_dir)
        .map_err(|e| format!("Failed to create lua directory: {e}"))?;

    let lua_path = lua_dir.join(format!("{}.lua", app_id));
    fs::write(&lua_path, lines.join("\n"))
        .map_err(|e| format!("Failed to write lua file: {e}"))?;

    Ok(lua_path)
}

/// Set or unset a manifest pin for a specific depot in an existing .lua file.
///
/// When `pin` is true, writes/updates the `setManifestid` line for the depot.
/// When `pin` is false, comments out the active `setManifestid` line.
pub fn set_manifest_pin(
    lua_path: &Path,
    depot_id: u64,
    manifest_id: &str,
    pin: bool,
) -> Result<(), String> {
    let content = fs::read_to_string(lua_path)
        .map_err(|e| format!("Failed to read lua file: {e}"))?;

    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();

    if pin {
        let new_line = format!("setManifestid({},\"{}\",0)", depot_id, manifest_id);
        update_manifest_line(&mut lines, depot_id, &new_line);
    } else {
        // Comment out active setManifestid lines for this depot
        let re_active = re_setmanifest_active();
        for line in lines.iter_mut() {
            if let Some(caps) = re_active.captures(line) {
                if let Some(id_str) = caps.get(1).map(|m| m.as_str()) {
                    if let Ok(id) = id_str.parse::<u64>() {
                        if id == depot_id && !line.trim_start().starts_with("--") {
                            *line = format!("--{}", line.trim_start());
                        }
                    }
                }
            }
        }
    }

    fs::write(lua_path, lines.join("\n"))
        .map_err(|e| format!("Failed to write lua file: {e}"))?;

    Ok(())
}

/// Update all manifest pins in a .lua file at once.
/// Writes/updates `setManifestid` lines for each depot_id -> manifest_id mapping.
pub fn update_all_manifest_pins(
    lua_path: &Path,
    pins: &[(u64, String)],
) -> Result<(), String> {
    let content = fs::read_to_string(lua_path)
        .map_err(|e| format!("Failed to read lua file: {e}"))?;

    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();

    for (depot_id, manifest_id) in pins {
        let new_line = format!("setManifestid({},\"{}\",0)", depot_id, manifest_id);
        update_manifest_line(&mut lines, *depot_id, &new_line);
    }

    fs::write(lua_path, lines.join("\n"))
        .map_err(|e| format!("Failed to write lua file: {e}"))?;

    Ok(())
}

/// Comment out all active setManifestid lines in a .lua file (unpin all).
pub fn unpin_all_manifests(lua_path: &Path) -> Result<u32, String> {
    let content = fs::read_to_string(lua_path)
        .map_err(|e| format!("Failed to read lua file: {e}"))?;

    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    let re_active = re_setmanifest_active();
    let mut count = 0u32;

    for line in lines.iter_mut() {
        if let Some(caps) = re_active.captures(line) {
            if !line.trim_start().starts_with("--") {
                *line = format!("--{}", line.trim_start());
                count += 1;
            }
        }
    }

    if count > 0 {
        fs::write(lua_path, lines.join("\n"))
            .map_err(|e| format!("Failed to write lua file: {e}"))?;
    }

    Ok(count)
}

/// Add a DLC entry to an existing .lua file.
/// Appends `addappid(dlc_app_id, ...)` after the last existing addappid/addtoken line.
pub fn add_dlc_to_lua(
    lua_path: &Path,
    dlc_app_id: u64,
    key: Option<&str>,
    comment: Option<&str>,
) -> Result<(), String> {
    let content = fs::read_to_string(lua_path)
        .map_err(|e| format!("Failed to read lua file: {e}"))?;

    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();

    // Build the new line
    let new_line = if let Some(k) = key {
        if let Some(c) = comment {
            format!("addappid({}, 1, \"{}\") -- {}", dlc_app_id, k, c)
        } else {
            format!("addappid({}, 1, \"{}\")", dlc_app_id, k)
        }
    } else {
        if let Some(c) = comment {
            format!("addappid({}) -- {}", dlc_app_id, c)
        } else {
            format!("addappid({})", dlc_app_id)
        }
    };

    // Find insertion point: after the last addappid/addtoken/setManifestid line
    let insert_at = find_last_instruction_line(&lines);
    lines.insert(insert_at, new_line);

    fs::write(lua_path, lines.join("\n"))
        .map_err(|e| format!("Failed to write lua file: {e}"))?;

    Ok(())
}

/// Append multiple lines to an existing .lua file.
pub fn append_lines(lua_path: &Path, new_lines: &[String]) -> Result<(), String> {
    let content = fs::read_to_string(lua_path)
        .map_err(|e| format!("Failed to read lua file: {e}"))?;

    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();

    let insert_at = find_last_instruction_line(&lines);
    for (i, line) in new_lines.iter().enumerate() {
        lines.insert(insert_at + i, line.clone());
    }

    fs::write(lua_path, lines.join("\n"))
        .map_err(|e| format!("Failed to write lua file: {e}"))?;

    Ok(())
}

/// Check if a .lua file exists for a given app_id
pub fn lua_file_exists(lua_dir: &Path, app_id: u64) -> bool {
    lua_dir.join(format!("{}.lua", app_id)).exists()
}

/// Parse existing manifest pins from a .lua file.
/// Returns a map of depot_id -> manifest_id for active setManifestid lines.
pub fn parse_manifest_pins(lua_path: &Path) -> Result<HashMap<u64, String>, String> {
    let content = fs::read_to_string(lua_path)
        .map_err(|e| format!("Failed to read lua file: {e}"))?;

    let re = re_setmanifest_active();
    let mut pins = HashMap::new();

    for line in content.lines() {
        if let Some(caps) = re.captures(line) {
            if let Some(id_match) = caps.get(1) {
                if let Some(manifest_match) = caps.get(2) {
                    if let Ok(depot_id) = id_match.as_str().parse::<u64>() {
                        pins.insert(depot_id, manifest_match.as_str().to_string());
                    }
                }
            }
        }
    }

    Ok(pins)
}

/// Check if a Lua file has any active (uncommented) setManifestid lines.
pub fn has_active_pins(lua_path: &Path) -> bool {
    let content = match fs::read_to_string(lua_path) {
        Ok(c) => c,
        Err(_) => return false,
    };

    let re = re_setmanifest_active();
    for line in content.lines() {
        if let Some(caps) = re.captures(line) {
            if !line.trim_start().starts_with("--") {
                return true;
            }
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// Find the index after the last instruction line (addappid, addtoken, setManifestid).
/// This is where new entries should be inserted.
fn find_last_instruction_line(lines: &[String]) -> usize {
    let re_inst = Regex::new(
        r#"(?i)^\s*(?:--\s*)?(?:addappid|addtoken|setManifestid)\s*\("#,
    )
    .unwrap();

    let mut last_idx = 0;
    for (i, line) in lines.iter().enumerate() {
        if re_inst.is_match(line) {
            last_idx = i + 1;
        }
    }
    last_idx
}

/// Update or insert a setManifestid line for a specific depot_id.
/// If an active or commented line exists for the depot, replace it.
/// Otherwise, insert after the last instruction line.
fn update_manifest_line(lines: &mut Vec<String>, depot_id: u64, new_line: &str) {
    let re_active = re_setmanifest_active();
    let re_commented = re_setmanifest_commented();

    // Try to find and replace existing line (active first, then commented)
    for line in lines.iter_mut() {
        if let Some(caps) = re_active.captures(line) {
            if let Some(id_str) = caps.get(1).map(|m| m.as_str()) {
                if let Ok(id) = id_str.parse::<u64>() {
                    if id == depot_id {
                        *line = new_line.to_string();
                        return;
                    }
                }
            }
        }
    }

    for line in lines.iter_mut() {
        if let Some(caps) = re_commented.captures(line) {
            if let Some(id_str) = caps.get(1).map(|m| m.as_str()) {
                if let Ok(id) = id_str.parse::<u64>() {
                    if id == depot_id {
                        *line = new_line.to_string();
                        return;
                    }
                }
            }
        }
    }

    // Not found — insert after last instruction line
    let insert_at = find_last_instruction_line(lines);
    lines.insert(insert_at, new_line.to_string());
}

/// Sanitize a game name for use as a Lua comment.
/// Removes characters that could break Lua syntax.
fn sanitize_lua_comment(name: &str) -> String {
    name.replace('\n', " ")
        .replace('\r', "")
        .replace("--", "—")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn create_test_lua(dir: &Path, app_id: u64, content: &str) -> std::path::PathBuf {
        let path = dir.join(format!("{}.lua", app_id));
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        path
    }

    #[test]
    fn test_generate_lua_file() {
        let tmp = TempDir::new().unwrap();
        let depots = vec![
            (730, Some("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2".to_string())),
            (2555350, Some("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef".to_string())),
        ];
        let tokens = vec![(730, "f8e7d6c5b4a3f8e7d6c5b4a3f8e7d6c5b4a3f8e7d6c5b4a3f8e7d6c5b4a3f8e7".to_string())];
        let pins = vec![(2555350, "1234567890123456789".to_string())];

        let path = generate_lua_file(tmp.path(), 730, "Counter-Strike 2", &depots, &tokens, &pins).unwrap();
        assert!(path.exists());

        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("addappid(730, 1, \"a1b2c3"));
        assert!(content.contains("Counter-Strike 2"));
        assert!(content.contains("addappid(2555350, 1, \"deadbeef"));
        assert!(content.contains("addtoken(730, \"f8e7d6"));
        assert!(content.contains("setManifestid(2555350,\"1234567890123456789\",0)"));
    }

    #[test]
    fn test_generate_lua_without_keys() {
        let tmp = TempDir::new().unwrap();
        let depots = vec![(730, None)];
        let tokens: Vec<(u64, String)> = vec![];
        let pins: Vec<(u64, String)> = vec![];

        // Should succeed with bare addappid (reference behavior)
        let path = generate_lua_file(tmp.path(), 730, "CS2", &depots, &tokens, &pins).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("addappid(730) -- CS2"));
        assert!(!content.contains("addappid(730, 1,"));
    }

    #[test]
    fn test_generate_lua_skips_dlc_depots_without_key() {
        let tmp = TempDir::new().unwrap();
        let depots = vec![
            (730, Some("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2".to_string())),
            (2555350, None),  // DLC depot without key — should be skipped
        ];
        let tokens: Vec<(u64, String)> = vec![];
        let pins: Vec<(u64, String)> = vec![];

        let path = generate_lua_file(tmp.path(), 730, "CS2", &depots, &tokens, &pins).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("addappid(730, 1, \"a1b2c3"));
        assert!(!content.contains("addappid(2555350)"));
    }

    #[test]
    fn test_set_manifest_pin() {
        let tmp = TempDir::new().unwrap();
        let lua_content = "addappid(730, 1, \"abc123\")\naddappid(2555350, 1, \"def456\")\n";
        let path = create_test_lua(tmp.path(), 730, lua_content);

        set_manifest_pin(&path, 2555350, "9876543210987654321", true).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("setManifestid(2555350,\"9876543210987654321\",0)"));
    }

    #[test]
    fn test_set_manifest_pin_update_existing() {
        let tmp = TempDir::new().unwrap();
        let lua_content = "addappid(730, 1, \"abc123\")\nsetManifestid(730,\"11111111111111111\",0)\n";
        let path = create_test_lua(tmp.path(), 730, lua_content);

        set_manifest_pin(&path, 730, "22222222222222222", true).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("setManifestid(730,\"22222222222222222\",0)"));
        assert!(!content.contains("11111111111111111"));
    }

    #[test]
    fn test_set_manifest_unpin() {
        let tmp = TempDir::new().unwrap();
        let lua_content = "addappid(730, 1, \"abc123\")\nsetManifestid(730,\"11111111111111111\",0)\n";
        let path = create_test_lua(tmp.path(), 730, lua_content);

        set_manifest_pin(&path, 730, "11111111111111111", false).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("--setManifestid(730,\"11111111111111111\",0)"));
    }

    #[test]
    fn test_add_dlc_to_lua() {
        let tmp = TempDir::new().unwrap();
        let lua_content = "addappid(730, 1, \"abc123\")\naddtoken(730, \"token123\")\n";
        let path = create_test_lua(tmp.path(), 730, lua_content);

        add_dlc_to_lua(&path, 731, Some("dlckey123"), Some("DLC Name")).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("addappid(731, 1, \"dlckey123\") -- DLC Name"));
    }

    #[test]
    fn test_add_dlc_without_key() {
        let tmp = TempDir::new().unwrap();
        let lua_content = "addappid(730, 1, \"abc123\")\n";
        let path = create_test_lua(tmp.path(), 730, lua_content);

        add_dlc_to_lua(&path, 731, None, None).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("addappid(731)"));
    }

    #[test]
    fn test_parse_manifest_pins() {
        let tmp = TempDir::new().unwrap();
        let lua_content = "addappid(730, 1, \"abc\")\nsetManifestid(730,\"11111111111111111\",0)\nsetManifestid(2555350,\"22222222222222222\",0)\n--setManifestid(999999,\"33333333333333333\",0)\n";
        let path = create_test_lua(tmp.path(), 730, lua_content);

        let pins = parse_manifest_pins(&path).unwrap();
        assert_eq!(pins.len(), 2);
        assert_eq!(pins.get(&730).unwrap(), "11111111111111111");
        assert_eq!(pins.get(&2555350).unwrap(), "22222222222222222");
    }

    #[test]
    fn test_sanitize_lua_comment() {
        assert_eq!(sanitize_lua_comment("Game -- Subtitle"), "Game — Subtitle");
        assert_eq!(sanitize_lua_comment("Line1\nLine2"), "Line1 Line2");
    }

    #[test]
    fn test_update_all_manifest_pins() {
        let tmp = TempDir::new().unwrap();
        let lua_content = "addappid(730, 1, \"abc\")\nsetManifestid(730,\"11111111111111111\",0)\naddappid(2555350, 1, \"def\")\n";
        let path = create_test_lua(tmp.path(), 730, lua_content);

        let pins = vec![
            (730, "22222222222222222".to_string()),
            (2555350, "33333333333333333".to_string()),
        ];
        update_all_manifest_pins(&path, &pins).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("setManifestid(730,\"22222222222222222\",0)"));
        assert!(content.contains("setManifestid(2555350,\"33333333333333333\",0)"));
        assert!(!content.contains("11111111111111111"));
    }

    #[test]
    fn test_unpin_all_manifests() {
        let tmp = TempDir::new().unwrap();
        let lua_content = "addappid(730, 1, \"abc\")\nsetManifestid(730,\"11111111111111111\",0)\nsetManifestid(2555350,\"22222222222222222\",0)\n--setManifestid(999999,\"33333333333333333\",0)\n";
        let path = create_test_lua(tmp.path(), 730, lua_content);

        let count = unpin_all_manifests(&path).unwrap();
        assert_eq!(count, 2);

        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("--setManifestid(730,\"11111111111111111\",0)"));
        assert!(content.contains("--setManifestid(2555350,\"22222222222222222\",0)"));
        assert!(content.contains("--setManifestid(999999,\"33333333333333333\",0)"));
    }

    #[test]
    fn test_unpin_all_no_pins() {
        let tmp = TempDir::new().unwrap();
        let lua_content = "addappid(730, 1, \"abc\")\naddtoken(730, \"token\")\n";
        let path = create_test_lua(tmp.path(), 730, lua_content);

        let count = unpin_all_manifests(&path).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_has_active_pins() {
        let tmp = TempDir::new().unwrap();

        // No pins
        let lua_content = "addappid(730, 1, \"abc\")\naddtoken(730, \"token\")\n";
        let path = create_test_lua(tmp.path(), 730, lua_content);
        assert!(!has_active_pins(&path));

        // Active pin
        let lua_content = "addappid(730, 1, \"abc\")\nsetManifestid(730,\"11111111111111111\",0)\n";
        let path = create_test_lua(tmp.path(), 731, lua_content);
        assert!(has_active_pins(&path));

        // Only commented pins
        let lua_content = "addappid(730, 1, \"abc\")\n--setManifestid(730,\"11111111111111111\",0)\n";
        let path = create_test_lua(tmp.path(), 732, lua_content);
        assert!(!has_active_pins(&path));

        // Mixed: one active, one commented
        let lua_content = "addappid(730, 1, \"abc\")\nsetManifestid(730,\"11111111111111111\",0)\n--setManifestid(2555350,\"22222222222222222\",0)\n";
        let path = create_test_lua(tmp.path(), 733, lua_content);
        assert!(has_active_pins(&path));
    }

    /// Simulates Lua generation for game 1971870 (Mortal Kombat 1)
    /// using Hubcap's depot data and compares output.
    /// Verifies: no depots without keys, correct structure, Hubcap parity.
    #[test]
    fn test_mk1_1971870_matches_hubcap() {
        let tmp = TempDir::new().unwrap();

        // Hubcap depot data for 1971870 (Mortal Kombat 1)
        // Main app (1971870) has no key — bare addappid
        // Main app depots, shared depots, and DLC depots with keys
        let depots = vec![
            // Main app — no key (bare addappid)
            (1971870u64, None),
            // Main app depots (with keys)
            (1971872, Some("2fb68660ef98508853b7901a8c4758d2811c558bc23eb52105126af40209be9c".to_string())),
            (1971873, Some("1721fcefd622e29779c2aaf9b3c0b7fbad0d149f94d00e611b8185720bd65afb".to_string())),
            (1971874, Some("d7c65f47842d7fe05e6489fd6f86355ebfb7a3f1261c503cdbeebaba66849d82".to_string())),
            (1971875, Some("020f4d21f49e187c5ee0dc181a3d10cdc166bc935868f83e5add726947973b51".to_string())),
            // Shared depots (from App 228980)
            (228989, Some("ad69276eb476cf06c40312df7376d63deac0c838b9a2767005be8bb306ffb853".to_string())),
            (228990, Some("44d8c45ce229a11c4f231a3d2a350eaf80b0d69a8af938ec7ccca720f694b0e8".to_string())),
            // DLC depots with keys
            (2615191, Some("881b5265b81aaa6e34ba005510561510c74dca7c4ddf56e688110dc4708702f7".to_string())),
            (3168021, Some("30cb9e85c44a2e1796c48b863ad72b03f0c8c8944fc32e93af78420d958df89e".to_string())),
            (3233541, Some("202206a238ab830b8c5dc5506ae41300989cd12ceadff8bb3c6d554bf3feb56b".to_string())),
        ];
        let tokens: Vec<(u64, String)> = vec![];
        let pins: Vec<(u64, String)> = vec![];

        let path = generate_lua_file(
            tmp.path(),
            1971870,
            "Mortal Kombat 1",
            &depots,
            &tokens,
            &pins,
        )
        .unwrap();
        let content = fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = content.lines().collect();

        // --- Verify main app ---
        // Main app (1971870) has no key → bare addappid
        assert!(
            lines.iter().any(|l| l.contains("addappid(1971870)") && !l.contains("addappid(1971870, 1,")),
            "Main app 1971870 should be bare addappid (no key). Got:\n{}",
            content
        );

        // --- Verify main app depots (with keys) ---
        for (depot_id, key) in &[
            (1971872, "2fb68660"),
            (1971873, "1721fcef"),
            (1971874, "d7c65f47"),
            (1971875, "020f4d21"),
        ] {
            assert!(
                lines.iter().any(|l| l.contains(&format!("addappid({}, 1, \"{}", depot_id, key))),
                "Depot {} should have key starting with {}. Got:\n{}",
                depot_id,
                key,
                content
            );
        }

        // --- Verify shared depots (with keys) ---
        assert!(
            lines.iter().any(|l| l.contains("addappid(228989, 1, \"ad69276e")),
            "Shared depot 228989 (VC 2022 Redist) should be present with key. Got:\n{}",
            content
        );
        assert!(
            lines.iter().any(|l| l.contains("addappid(228990, 1, \"44d8c45c")),
            "Shared depot 228990 (DirectX Jun 2010 Redist) should be present with key. Got:\n{}",
            content
        );

        // --- Verify DLC depots with keys ---
        for (depot_id, key_prefix) in &[
            (2615191, "881b5265"),
            (3168021, "30cb9e85"),
            (3233541, "202206a2"),
        ] {
            assert!(
                lines.iter().any(|l| l.contains(&format!("addappid({}, 1, \"{}", depot_id, key_prefix))),
                "DLC depot {} should have key starting with {}. Got:\n{}",
                depot_id,
                key_prefix,
                content
            );
        }

        // --- CRITICAL: No depots without keys ---
        // Every addappid line should either be bare (no key) for the main app only,
        // or have a key. No depot should appear as addappid(id) without key.
        for line in &lines {
            if let Some(l) = line.strip_prefix("addappid(") {
                // Check if it's a bare addappid (no key)
                if !l.contains(", 1, \"") {
                    // Bare addappid — only allowed for main app 1971870
                    let id_str = l.trim_end_matches(')');
                    if let Ok(id) = id_str.parse::<u64>() {
                        assert_eq!(
                            id, 1971870,
                            "Bare addappid (no key) only allowed for main app 1971870, found for {}. Line: {}",
                            id, line
                        );
                    }
                }
            }
        }

        // --- Verify no depots without keys leaked ---
        // Count total addappid lines (excluding bare main app)
        let keyed_count = lines.iter()
            .filter(|l| l.starts_with("addappid(") && l.contains(", 1, \""))
            .count();
        assert_eq!(
            keyed_count,
            9,
            "Expected 9 keyed addappid lines (4 main depots + 2 shared + 3 DLC), got {}. Full:\n{}",
            keyed_count,
            content
        );

        // --- Verify structure matches Hubcap ---
        assert!(content.starts_with("-- lua by LumaForge"));
        assert!(content.contains("Mortal Kombat 1"));
    }

    /// Verify that depots without keys are never included in output.
    #[test]
    fn test_no_keyless_depots_in_output() {
        let tmp = TempDir::new().unwrap();

        // Simulate a game with multiple depots, some without keys
        let depots = vec![
            (100000u64, None),   // main app — no key
            (100001, Some("aaaa".to_string())),  // depot with key
            (100002, None),     // DLC depot WITHOUT key — should be excluded
            (100003, Some("bbbb".to_string())),  // DLC depot with key
        ];

        let path = generate_lua_file(tmp.path(), 100000, "Test Game", &depots, &[], &[]).unwrap();
        let content = fs::read_to_string(&path).unwrap();

        // Main app should be bare
        assert!(content.contains("addappid(100000) -- Test Game"));
        // Depots with keys should be present
        assert!(content.contains("addappid(100001, 1, \"aaaa\")"));
        assert!(content.contains("addappid(100003, 1, \"bbbb\")"));
        // Depot without key (100002) should NOT be present
        assert!(!content.contains("addappid(100002)"), "Keyless depot 100002 should not appear. Got:\n{}", content);
        assert!(!content.contains("addappid(100002, 1,"), "Keyless depot 100002 should not appear with key. Got:\n{}", content);
    }
}
