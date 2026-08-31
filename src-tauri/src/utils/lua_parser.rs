use regex::Regex;
use std::collections::HashMap;
use std::path::Path;

/// Parsed depot entry from a .lua file.
#[derive(Debug, Clone)]
pub struct LuaDepotEntry {
    pub depot_id: u64,
    pub key: Option<String>,
    pub manifest_id: Option<String>,
    pub size_on_disk: Option<u64>,
    pub comment: Option<String>,
    pub is_active: bool,
}

/// Parse a single .lua file and extract all depot entries.
pub fn parse_lua_file(path: &Path) -> Result<Vec<LuaDepotEntry>, String> {
    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read lua file: {e}"))?;
    parse_lua_content(&content)
}

/// Parse lua file content and extract depot entries.
pub fn parse_lua_content(content: &str) -> Result<Vec<LuaDepotEntry>, String> {
    let re_addappid = Regex::new(
        r#"(?i)addappid\s*\(\s*(\d+)\s*(?:,\s*\d+\s*(?:,\s*"([^"]*)")?)?\s*\)[ \t]*(?:--[ \t]*(.*?)[ \t]*)?$"#,
    )
    .map_err(|e| format!("Regex compile error: {e}"))?;

    let re_setmanifest = Regex::new(
        r#"(?i)setManifestid\s*\(\s*(\d+)\s*,\s*"(\d+)"\s*(?:,\s*(\d+))?"#,
    )
    .map_err(|e| format!("Regex compile error: {e}"))?;

    // Track entries by depot_id for both active and commented lines
    let mut entries: HashMap<u64, LuaDepotEntry> = HashMap::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        let is_active = !line.starts_with("--");

        // Try setManifestid first (works on both active and commented lines)
        if let Some(caps) = re_setmanifest.captures(line) {
            if let Some(id_str) = caps.get(1).map(|m| m.as_str()) {
                if let Ok(depot_id) = id_str.parse::<u64>() {
                    let manifest_id = caps
                        .get(2)
                        .map(|m| m.as_str().to_string());
                    let size = caps
                        .get(3)
                        .and_then(|m| m.as_str().parse::<u64>().ok());

                    let entry = entries.entry(depot_id).or_insert_with(|| LuaDepotEntry {
                        depot_id,
                        key: None,
                        manifest_id: None,
                        size_on_disk: None,
                        comment: None,
                        is_active,
                    });
                    if is_active {
                        entry.manifest_id = manifest_id;
                    }
                    if let Some(s) = size {
                        entry.size_on_disk = Some(s);
                    }
                    entry.is_active = entry.is_active || is_active;
                }
            }
        }

        // Try addappid
        // Strip leading "--" for commented lines so regex can match
        let stripped = if !is_active {
            line.trim_start_matches('-').trim_start()
        } else {
            line
        };

        if let Some(caps) = re_addappid.captures(stripped) {
            if let Some(id_str) = caps.get(1).map(|m| m.as_str()) {
                if let Ok(depot_id) = id_str.parse::<u64>() {
                    let key = caps
                        .get(2)
                        .map(|m| m.as_str().to_string())
                        .filter(|k| !k.is_empty());
                    let comment = caps
                        .get(3)
                        .map(|m| m.as_str().trim().to_string())
                        .filter(|c| !c.is_empty());

                    let entry = entries.entry(depot_id).or_insert_with(|| LuaDepotEntry {
                        depot_id,
                        key: None,
                        manifest_id: None,
                        size_on_disk: None,
                        comment: None,
                        is_active,
                    });
                    // Keys are only set on active lines
                    if is_active && key.is_some() {
                        entry.key = key;
                    }
                    if comment.is_some() {
                        entry.comment = comment;
                    }
                    entry.is_active = entry.is_active || is_active;
                }
            }
        }
    }

    let mut result: Vec<LuaDepotEntry> = entries.into_values().collect();
    result.sort_by_key(|e| e.depot_id);
    Ok(result)
}

/// Resolve depot keys from lua files in the given directory for a specific app.
/// Returns a map of depot_id -> hex_key (64-char hex string).
pub fn resolve_keys_from_lua(lua_dir: &Path, app_id: u64) -> HashMap<u64, String> {
    let lua_path = lua_dir.join(format!("{app_id}.lua"));
    let mut keys = HashMap::new();

    // Try active .lua file first
    if lua_path.exists() {
        if let Ok(entries) = parse_lua_file(&lua_path) {
            for entry in entries {
                if let Some(key) = &entry.key {
                    keys.insert(entry.depot_id, key.clone());
                }
            }
        }
    }

    // Also try .lua.disabled (disabled entries still have valid keys)
    let disabled_path = lua_dir.join(format!("{app_id}.lua.disabled"));
    if disabled_path.exists() {
        if let Ok(entries) = parse_lua_file(&disabled_path) {
            for entry in entries {
                if let Some(key) = &entry.key {
                    // Don't overwrite active keys
                    keys.entry(entry.depot_id).or_insert_with(|| key.clone());
                }
            }
        }
    }

    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_lua_content() {
        let lua = r#"
addappid(2784470, 1, "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2")
setManifestid(2784470, "1234567890123456789", 45000000000)
addappid(2784471, 1, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
setManifestid(2784471, "9876543210987654321", 5000000000)
-- addappid(2784472, 1, "disabledkey1234567890123456789012345678901234567890123456789012")
addappid(2784473)
"#;

        let entries = parse_lua_content(lua).unwrap();
        assert_eq!(entries.len(), 4);

        let e0 = entries.iter().find(|e| e.depot_id == 2784470).unwrap();
        assert!(e0.is_active);
        assert!(e0.key.is_some());
        assert_eq!(e0.manifest_id.as_deref(), Some("1234567890123456789"));
        assert_eq!(e0.size_on_disk, Some(45000000000));

        let e3 = entries.iter().find(|e| e.depot_id == 2784473).unwrap();
        assert!(e3.is_active);
        assert!(e3.key.is_none());
    }
}
