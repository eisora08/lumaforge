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

/// A single depot entry with metadata for categorized Lua output.
#[derive(Debug, Clone)]
pub struct LuaDepotEntry {
    pub depot_id: u64,
    pub key: Option<String>,
    pub is_shared: bool,
    pub from_app_id: Option<u64>,
    pub dlc_app_id: Option<u64>,
}

impl LuaDepotEntry {
    pub fn new(depot_id: u64) -> Self {
        Self { depot_id, key: None, is_shared: false, from_app_id: None, dlc_app_id: None }
    }

    pub fn with_key(mut self, key: String) -> Self {
        self.key = Some(key);
        self
    }

    pub fn with_shared(mut self, from_app_id: u64) -> Self {
        self.is_shared = true;
        self.from_app_id = Some(from_app_id);
        self
    }

    pub fn with_dlc(mut self, dlc_app_id: u64) -> Self {
        self.dlc_app_id = Some(dlc_app_id);
        self
    }
}

/// Generate a complete .lua file for a game with Hubcap-style section comments.
///
/// # Arguments
/// * `lua_dir` - Directory where the .lua file will be created (typically Steam's config/lua)
/// * `app_id` - The Steam App ID
/// * `game_name` - Human-readable game name (used as comment)
/// * `depots` - List of `LuaDepotEntry` with metadata for categorization
/// * `dlc_ids` - All DLC app IDs for this game (used to identify DLCs without dedicated depots)
/// * `tokens` - List of (app_id, token_hex) tuples
/// * `manifest_pins` - List of (depot_id, manifest_id, optional_size_on_disk) tuples to pin
///
/// # Returns
/// Path to the created .lua file
pub fn generate_lua_file(
    lua_dir: &Path,
    app_id: u64,
    game_name: &str,
    depots: &[LuaDepotEntry],
    dlc_ids: &[u64],
    tokens: &[(u64, String)],
    manifest_pins: &[(u64, String, Option<u64>)],
) -> Result<std::path::PathBuf, String> {
    let mut lines: Vec<String> = Vec::new();

    lines.push("-- lua by LumaForge".to_string());

    let name_comment = sanitize_lua_comment(game_name);

    // Classify depots into categories
    let main_app_entry = depots.iter().find(|d| d.depot_id == app_id);
    let main_app_key = main_app_entry.and_then(|d| d.key.as_ref());

    // Main app depots: not shared, not a DLC depot, not the main app itself
    let main_depots: Vec<&LuaDepotEntry> = depots.iter()
        .filter(|d| d.depot_id != app_id && !d.is_shared && (d.dlc_app_id.is_none() || d.dlc_app_id == Some(app_id)))
        .collect();

    // Shared depots
    let shared_depots: Vec<&LuaDepotEntry> = depots.iter()
        .filter(|d| d.is_shared)
        .collect();

    // DLC depots (have a DLC app ID, not the main app, not shared)
    let dlc_depots: Vec<&LuaDepotEntry> = depots.iter()
        .filter(|d| d.depot_id != app_id && !d.is_shared && d.dlc_app_id.is_some() && d.dlc_app_id != Some(app_id))
        .collect();

    // DLC app IDs that have at least one depot with a key
    let dlc_ids_with_depots: std::collections::HashSet<u64> = dlc_depots.iter()
        .filter_map(|d| d.dlc_app_id)
        .collect();

    // --- MAIN APPLICATION ---
    lines.push(String::new());
    lines.push("-- MAIN APPLICATION".to_string());
    if let Some(key) = main_app_key {
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

    // --- MAIN APP DEPOTS ---
    if !main_depots.is_empty() {
        lines.push(String::new());
        lines.push("-- MAIN APP DEPOTS".to_string());
        for d in &main_depots {
            if let Some(k) = &d.key {
                lines.push(format!("addappid({}, 1, \"{}\") -- Depot {}", d.depot_id, k, d.depot_id));
            }
        }
    }

    // --- SHARED DEPOTS ---
    if !shared_depots.is_empty() {
        lines.push(String::new());
        lines.push("-- SHARED DEPOTS (from other apps)".to_string());
        for d in &shared_depots {
            if let Some(k) = &d.key {
                let from = d.from_app_id.map(|id| format!(" (Shared from App {})", id)).unwrap_or_default();
                lines.push(format!("addappid({}, 1, \"{}\") -- Shared Depot {}{}", d.depot_id, k, d.depot_id, from));
            }
        }
    }

    // --- DLCS WITH DEDICATED DEPOTS ---
    if !dlc_depots.is_empty() {
        lines.push(String::new());
        lines.push("-- DLCS WITH DEDICATED DEPOTS".to_string());
        // Group by DLC app ID
        let mut dlc_groups: Vec<(u64, Vec<&LuaDepotEntry>)> = Vec::new();
        let mut seen_dlc: std::collections::HashSet<u64> = std::collections::HashSet::new();
        for d in &dlc_depots {
            if let Some(dlc_id) = d.dlc_app_id {
                if seen_dlc.insert(dlc_id) {
                    let group: Vec<&LuaDepotEntry> = dlc_depots.iter()
                        .copied()
                        .filter(|dd| dd.dlc_app_id == Some(dlc_id))
                        .collect();
                    dlc_groups.push((dlc_id, group));
                }
            }
        }
        for (dlc_id, group) in &dlc_groups {
            lines.push(format!("-- DLC {} (AppID: {})", dlc_id, dlc_id));
            // Add bare addappid for the DLC app itself
            lines.push(format!("addappid({})", dlc_id));
            for d in group {
                if let Some(k) = &d.key {
                    lines.push(format!("addappid({}, 1, \"{}\") -- Depot {}", d.depot_id, k, d.depot_id));
                }
            }
        }
    }

    // --- DLCS WITHOUT DEDICATED DEPOTS ---
    // DLC IDs from the full list that have no depots in the depots list
    let dlc_ids_without_depots: Vec<u64> = dlc_ids.iter()
        .copied()
        .filter(|id| *id != app_id && !dlc_ids_with_depots.contains(id))
        .collect();
    if !dlc_ids_without_depots.is_empty() {
        lines.push(String::new());
        lines.push("-- DLCS WITHOUT DEDICATED DEPOTS".to_string());
        for dlc_id in &dlc_ids_without_depots {
            lines.push(format!("addappid({})", dlc_id));
        }
    }

    // App access tokens
    if !tokens.is_empty() {
        lines.push(String::new());
        for (token_app_id, token_hex) in tokens {
            lines.push(format!("addtoken({}, \"{}\")", token_app_id, token_hex));
        }
    }

    // Manifest pins (commented out like Hubcap)
    if !manifest_pins.is_empty() {
        lines.push(String::new());
        for (depot_id, manifest_id, size_on_disk) in manifest_pins {
            if let Some(size) = size_on_disk {
                lines.push(format!("--setManifestid({}, \"{}\", {})", depot_id, manifest_id, size));
            } else {
                lines.push(format!("--setManifestid({}, \"{}\", 0)", depot_id, manifest_id));
            }
        }
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
    size_override: Option<u64>,
) -> Result<(), String> {
    let content = fs::read_to_string(lua_path)
        .map_err(|e| format!("Failed to read lua file: {e}"))?;

    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();

    // Regex that matches both active and commented setManifestid lines
    let re_any = Regex::new(
        r#"setManifestid\s*\(\s*(\d+)\s*,\s*"(\d+)"\s*(?:,\s*(\d+))?"#,
    )
    .unwrap();

    if pin {
        // Look for existing line (active or commented) to preserve the real size
        let existing_size = lines.iter()
            .filter_map(|l| re_any.captures(l))
            .find(|caps| {
                caps.get(1).and_then(|m| m.as_str().parse::<u64>().ok()) == Some(depot_id)
            })
            .and_then(|caps| caps.get(3))
            .and_then(|m| m.as_str().parse::<u64>().ok());

        let size = size_override.or(existing_size).unwrap_or(0);
        let new_line = format!("setManifestid({}, \"{}\", {})", depot_id, manifest_id, size);
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
    pins: &[(u64, String, Option<u64>)],
) -> Result<(), String> {
    let content = fs::read_to_string(lua_path)
        .map_err(|e| format!("Failed to read lua file: {e}"))?;

    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();

    for (depot_id, manifest_id, size_on_disk) in pins {
        let size = size_on_disk.unwrap_or(0);
        let new_line = format!("setManifestid({},\"{}\",{})", depot_id, manifest_id, size);
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
/// Returns a map of depot_id -> (manifest_id, size_on_disk) for active setManifestid lines.
pub fn parse_manifest_pins(lua_path: &Path) -> Result<HashMap<u64, (String, Option<u64>)>, String> {
    let content = fs::read_to_string(lua_path)
        .map_err(|e| format!("Failed to read lua file: {e}"))?;

    let re = re_setmanifest_active();
    let mut pins = HashMap::new();

    for line in content.lines() {
        if let Some(caps) = re.captures(line) {
            if let Some(id_match) = caps.get(1) {
                if let Some(manifest_match) = caps.get(2) {
                    if let Ok(depot_id) = id_match.as_str().parse::<u64>() {
                        // Try to parse size_on_disk from 3rd capture group
                        let size = caps.get(3)
                            .and_then(|s| s.as_str().parse::<u64>().ok());
                        pins.insert(depot_id, (manifest_match.as_str().to_string(), size));
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
            LuaDepotEntry::new(730).with_key("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2".to_string()),
            LuaDepotEntry::new(2555350).with_key("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef".to_string()),
        ];
        let tokens = vec![(730, "f8e7d6c5b4a3f8e7d6c5b4a3f8e7d6c5b4a3f8e7d6c5b4a3f8e7d6c5b4a3f8e7".to_string())];
        let pins = vec![(2555350u64, "1234567890123456789".to_string(), None)];

        let path = generate_lua_file(tmp.path(), 730, "Counter-Strike 2", &depots, &[], &tokens, &pins).unwrap();
        assert!(path.exists());

        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("addappid(730, 1, \"a1b2c3"));
        assert!(content.contains("Counter-Strike 2"));
        assert!(content.contains("addappid(2555350, 1, \"deadbeef"));
        assert!(content.contains("addtoken(730, \"f8e7d6"));
        assert!(content.contains("--setManifestid(2555350, \"1234567890123456789\", 0)"));
    }

    #[test]
    fn test_generate_lua_without_keys() {
        let tmp = TempDir::new().unwrap();
        let depots = vec![LuaDepotEntry::new(730)];
        let tokens: Vec<(u64, String)> = vec![];
        let pins: Vec<(u64, String, Option<u64>)> = vec![];

        // Should succeed with bare addappid (reference behavior)
        let path = generate_lua_file(tmp.path(), 730, "CS2", &depots, &[], &tokens, &pins).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("addappid(730) -- CS2"));
        assert!(!content.contains("addappid(730, 1,"));
    }

    #[test]
    fn test_generate_lua_skips_dlc_depots_without_key() {
        let tmp = TempDir::new().unwrap();
        let depots = vec![
            LuaDepotEntry::new(730).with_key("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2".to_string()),
            LuaDepotEntry::new(2555350),  // DLC depot without key — should be skipped
        ];
        let tokens: Vec<(u64, String)> = vec![];
        let pins: Vec<(u64, String, Option<u64>)> = vec![];

        let path = generate_lua_file(tmp.path(), 730, "CS2", &depots, &[], &tokens, &pins).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("addappid(730, 1, \"a1b2c3"));
        assert!(!content.contains("addappid(2555350)"));
    }

    #[test]
    fn test_set_manifest_pin() {
        let tmp = TempDir::new().unwrap();
        let lua_content = "addappid(730, 1, \"abc123\")\naddappid(2555350, 1, \"def456\")\n";
        let path = create_test_lua(tmp.path(), 730, lua_content);

        set_manifest_pin(&path, 2555350, "9876543210987654321", true, None).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("setManifestid(2555350, \"9876543210987654321\", 0)"));
    }

    #[test]
    fn test_set_manifest_pin_preserves_size_from_commented() {
        let tmp = TempDir::new().unwrap();
        // Commented line with real size
        let lua_content = "addappid(730, 1, \"abc123\")\n--setManifestid(730, \"11111111111111111\", 610379640)\n";
        let path = create_test_lua(tmp.path(), 730, lua_content);

        set_manifest_pin(&path, 730, "11111111111111111", true, None).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        // Should preserve the real size, not 0
        assert!(content.contains("setManifestid(730, \"11111111111111111\", 610379640)"));
        assert!(!content.contains("--setManifestid(730"));
    }

    #[test]
    fn test_set_manifest_pin_preserves_size_from_active() {
        let tmp = TempDir::new().unwrap();
        // Active line with real size
        let lua_content = "addappid(730, 1, \"abc123\")\nsetManifestid(730, \"11111111111111111\", 610379640)\n";
        let path = create_test_lua(tmp.path(), 730, lua_content);

        // Replace with new manifest id, should preserve size
        set_manifest_pin(&path, 730, "22222222222222222", true, None).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("setManifestid(730, \"22222222222222222\", 610379640)"));
        assert!(!content.contains("11111111111111111"));
    }

    #[test]
    fn test_set_manifest_pin_update_existing() {
        let tmp = TempDir::new().unwrap();
        let lua_content = "addappid(730, 1, \"abc123\")\nsetManifestid(730, \"11111111111111111\", 0)\n";
        let path = create_test_lua(tmp.path(), 730, lua_content);

        set_manifest_pin(&path, 730, "22222222222222222", true, None).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("setManifestid(730, \"22222222222222222\", 0)"));
        assert!(!content.contains("11111111111111111"));
    }

    #[test]
    fn test_set_manifest_unpin() {
        let tmp = TempDir::new().unwrap();
        let lua_content = "addappid(730, 1, \"abc123\")\nsetManifestid(730,\"11111111111111111\",0)\n";
        let path = create_test_lua(tmp.path(), 730, lua_content);

        set_manifest_pin(&path, 730, "11111111111111111", false, None).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("--setManifestid(730,\"11111111111111111\",0)"));
    }

    #[test]
    fn test_set_manifest_pin_size_override() {
        let tmp = TempDir::new().unwrap();
        let lua_content = "addappid(730, 1, \"abc123\")\n--setManifestid(730, \"11111111111111111\", 610379640)\n";
        let path = create_test_lua(tmp.path(), 730, lua_content);

        // Override size to a different value
        set_manifest_pin(&path, 730, "22222222222222222", true, Some(9999999999)).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("setManifestid(730, \"22222222222222222\", 9999999999)"));
        assert!(!content.contains("610379640"));
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
        assert_eq!(pins.get(&730).unwrap().0, "11111111111111111");
        assert_eq!(pins.get(&2555350).unwrap().0, "22222222222222222");
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
            (730, "22222222222222222".to_string(), Some(12345u64)),
            (2555350, "33333333333333333".to_string(), None),
        ];
        update_all_manifest_pins(&path, &pins).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("setManifestid(730,\"22222222222222222\",12345)"));
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
            LuaDepotEntry::new(1971870),
            // Main app depots (with keys)
            LuaDepotEntry::new(1971872).with_key("2fb68660ef98508853b7901a8c4758d2811c558bc23eb52105126af40209be9c".to_string()),
            LuaDepotEntry::new(1971873).with_key("1721fcefd622e29779c2aaf9b3c0b7fbad0d149f94d00e611b8185720bd65afb".to_string()),
            LuaDepotEntry::new(1971874).with_key("d7c65f47842d7fe05e6489fd6f86355ebfb7a3f1261c503cdbeebaba66849d82".to_string()),
            LuaDepotEntry::new(1971875).with_key("020f4d21f49e187c5ee0dc181a3d10cdc166bc935868f83e5add726947973b51".to_string()),
            // Shared depots (from App 228980)
            LuaDepotEntry::new(228989).with_key("ad69276eb476cf06c40312df7376d63deac0c838b9a2767005be8bb306ffb853".to_string()).with_shared(228980),
            LuaDepotEntry::new(228990).with_key("44d8c45ce229a11c4f231a3d2a350eaf80b0d69a8af938ec7ccca720f694b0e8".to_string()).with_shared(228980),
            // DLC depots with keys
            LuaDepotEntry::new(2615191).with_key("881b5265b81aaa6e34ba005510561510c74dca7c4ddf56e688110dc4708702f7".to_string()).with_dlc(2615190),
            LuaDepotEntry::new(3168021).with_key("30cb9e85c44a2e1796c48b863ad72b03f0c8c8944fc32e93af78420d958df89e".to_string()).with_dlc(3168020),
            LuaDepotEntry::new(3233541).with_key("202206a238ab830b8c5dc5506ae41300989cd12ceadff8bb3c6d554bf3feb56b".to_string()).with_dlc(3233540),
        ];
        let tokens: Vec<(u64, String)> = vec![];
        let pins: Vec<(u64, String, Option<u64>)> = vec![];
        // DLC IDs (3 with dedicated depots, matching the depots list)
        let dlc_ids = vec![2615190u64, 3168020, 3233540];

        let path = generate_lua_file(
            tmp.path(),
            1971870,
            "Mortal Kombat 1",
            &depots,
            &dlc_ids,
            &tokens,
            &pins,
        )
        .unwrap();
        let content = fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = content.lines().collect();

        // --- Verify section comments ---
        assert!(content.contains("-- lua by LumaForge"));
        assert!(content.contains("-- MAIN APPLICATION"));
        assert!(content.contains("-- MAIN APP DEPOTS"));
        assert!(content.contains("-- SHARED DEPOTS (from other apps)"));
        assert!(content.contains("-- DLCS WITH DEDICATED DEPOTS"));

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
            lines.iter().any(|l| l.contains("addappid(228989, 1, \"ad69276e") && l.contains("Shared")),
            "Shared depot 228989 (VC 2022 Redist) should be present with key and Shared comment. Got:\n{}",
            content
        );
        assert!(
            lines.iter().any(|l| l.contains("addappid(228990, 1, \"44d8c45c") && l.contains("Shared")),
            "Shared depot 228990 (DirectX Jun 2010 Redist) should be present with key and Shared comment. Got:\n{}",
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

        // --- Verify DLC app bare addappid entries ---
        assert!(content.contains("addappid(2615190)"), "DLC 2615190 should have bare addappid. Got:\n{}", content);
        assert!(content.contains("addappid(3168020)"), "DLC 3168020 should have bare addappid. Got:\n{}", content);
        assert!(content.contains("addappid(3233540)"), "DLC 3233540 should have bare addappid. Got:\n{}", content);

        // --- CRITICAL: No depots without keys ---
        // Bare addappid (no key) only allowed for main app and DLC app IDs with dedicated depots
        let allowed_bare: std::collections::HashSet<u64> = [1971870u64, 2615190, 3168020, 3233540].into();
        for line in &lines {
            if let Some(l) = line.strip_prefix("addappid(") {
                if !l.contains(", 1, \"") {
                    let id_str = l.trim_end_matches(')');
                    if let Ok(id) = id_str.parse::<u64>() {
                        assert!(
                            allowed_bare.contains(&id),
                            "Bare addappid (no key) only allowed for main app/DLC app IDs, found for {}. Line: {}",
                            id, line
                        );
                    }
                }
            }
        }

        // --- Verify keyed addappid count ---
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
    }

    /// Verify that depots without keys are never included in output.
    #[test]
    fn test_no_keyless_depots_in_output() {
        let tmp = TempDir::new().unwrap();

        // Simulate a game with multiple depots, some without keys
        let depots = vec![
            LuaDepotEntry::new(100000),   // main app — no key
            LuaDepotEntry::new(100001).with_key("aaaa".to_string()),  // depot with key
            LuaDepotEntry::new(100002),   // DLC depot WITHOUT key — should be excluded
            LuaDepotEntry::new(100003).with_key("bbbb".to_string()),  // DLC depot with key
        ];

        let path = generate_lua_file(tmp.path(), 100000, "Test Game", &depots, &[], &[], &[]).unwrap();
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
