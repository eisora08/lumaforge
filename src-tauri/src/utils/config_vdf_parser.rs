use regex::Regex;
use std::collections::HashMap;
use std::path::Path;

/// Parse Steam's config.vdf and extract depot decryption keys.
///
/// The config.vdf structure for depot keys looks like:
/// ```vdf
/// "InstallConfigStore"
/// {
///     "Software"
///     {
///         "Valve"
///         {
///             "Steam"
///             {
///                 "depots"
///                 {
///                     "2784470"
///                     {
///                         "DecryptionKey"    "a1b2c3d4..."
///                     }
///                 }
///             }
///         }
///     }
/// }
/// ```
///
/// We use a simple recursive approach: scan for `"DecryptionKey"` tokens
/// and extract the parent key (depot id) + value (hex key).
pub fn extract_keys_from_config_vdf(content: &str) -> HashMap<u64, String> {
    let mut keys = HashMap::new();

    // Strategy: find all `"DecryptionKey"` lines and extract the depot id
    // by looking backwards for the preceding quoted depot id.
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i].trim();

        if line.contains("DecryptionKey") {
            // Extract the key value: "DecryptionKey" "abcdef1234..."
            if let Some(value) = extract_vdf_value(line) {
                // Validate: 64 hex chars
                if value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit()) {
                    // Look backwards for the depot id (parent key)
                    if let Some(depot_id) = find_parent_key(&lines, i) {
                        keys.insert(depot_id, value);
                    }
                }
            }
        }

        i += 1;
    }

    keys
}

/// Read and parse config.vdf from a Steam installation.
pub fn extract_keys_from_config_vdf_path(config_path: &Path) -> Result<HashMap<u64, String>, String> {
    let content = std::fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read config.vdf: {e}"))?;
    Ok(extract_keys_from_config_vdf(&content))
}

/// Extract a VDF key-value pair from a line like: `"key"    "value"`
fn extract_vdf_value(line: &str) -> Option<String> {
    let re = Regex::new(r#"^"([^"]+)"\s+"([^"]+)"$"#).ok()?;
    let caps = re.captures(line)?;
    Some(caps.get(2)?.as_str().to_string())
}

/// Look backwards from the current line to find the parent depot id.
/// In VDF format, the depot id is the last unquoted string before a `{`.
fn find_parent_key(lines: &[&str], current_idx: usize) -> Option<u64> {
    let re_key = Regex::new(r#"^"(\d+)"\s*$"#).ok()?;
    let mut depth = 0;

    // Scan backwards to find the nearest key before the opening brace
    for i in (0..current_idx).rev() {
        let line = lines[i].trim();

        if line == "}" {
            depth += 1;
        } else if line == "{" {
            if depth == 0 {
                // Found the opening brace for the current block
                // The key before this brace is the depot id
                if i > 0 {
                    let prev = lines[i - 1].trim();
                    if let Some(caps) = re_key.captures(prev) {
                        return caps.get(1)?.as_str().parse::<u64>().ok();
                    }
                }
            } else {
                depth -= 1;
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_keys() {
        let vdf = r#"
"InstallConfigStore"
{
    "Software"
    {
        "Valve"
        {
            "Steam"
            {
                "depots"
                {
                    "2784470"
                    {
                        "DecryptionKey"    "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
                    }
                    "2784471"
                    {
                        "DecryptionKey"    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
                    }
                }
            }
        }
    }
}
"#;
        let keys = extract_keys_from_config_vdf(vdf);
        assert_eq!(keys.len(), 2);
        assert!(keys.contains_key(&2784470));
        assert!(keys.contains_key(&2784471));
    }
}
