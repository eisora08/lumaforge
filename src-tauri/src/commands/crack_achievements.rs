use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrackAchievementEntry {
    pub api_name: String,
    pub earned: bool,
    #[serde(default)]
    pub earned_time: u64,
    #[serde(default)]
    pub progress: Option<f64>,
    #[serde(default)]
    pub max_progress: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrackAchievementsResult {
    pub entries: Vec<CrackAchievementEntry>,
    pub format: String,
    pub file_path: String,
}

// ---------------------------------------------------------------------------
// Tenoke user_stats.ini parser
// ---------------------------------------------------------------------------
// Format:
//   [STATS]
//   "AchievementName" = 100
//
//   [ACHIEVEMENTS]
//   "AchievementName" = {unlocked=true, time=1700000000, progress=100}

#[tauri::command]
pub fn parse_tenoke_user_stats(path: String) -> Result<Option<CrackAchievementsResult>, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(p).map_err(|e| format!("Failed to read {}: {}", path, e))?;
    let mut entries: HashMap<String, CrackAchievementEntry> = HashMap::new();
    let mut current_section = String::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
            continue;
        }

        // Section header
        if let Some(name) = trimmed.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            current_section = name.trim().to_uppercase();
            continue;
        }

        // Quoted key = value
        let kv = if let Some(rest) = trimmed.strip_prefix('"') {
            if let Some(eq_pos) = rest.find('"') {
                let key = rest[..eq_pos].to_string();
                // eq_pos is index in rest; +1 skips the closing ", +1 more for the leading " stripped
                let val_start = eq_pos + 2;
                let val = if val_start < trimmed.len() {
                    trimmed[val_start..]
                        .trim()
                        .trim_start_matches('=')
                        .trim()
                        .to_string()
                } else {
                    String::new()
                };
                Some((key, val))
            } else {
                None
            }
        } else {
            None
        };

        let (key, value) = match kv {
            Some((k, v)) => (k, v),
            None => continue,
        };

        match current_section.as_str() {
            "STATS" => {
                let numeric: f64 = value
                    .trim_end_matches(',')
                    .trim()
                    .parse()
                    .unwrap_or(0.0);
                if numeric.is_finite() {
                    entries
                        .entry(key.clone())
                        .or_insert_with(|| CrackAchievementEntry {
                            api_name: key.clone(),
                            earned: false,
                            earned_time: 0,
                            progress: None,
                            max_progress: None,
                        })
                        .progress = Some(numeric);
                }
            }
            "ACHIEVEMENTS" => {
                let mut earned = false;
                let mut time: u64 = 0;
                let mut progress: Option<f64> = None;

                // Parse {unlocked=true, time=123, progress=45}
                if let Some(inner) = value
                    .strip_prefix('{')
                    .and_then(|s| s.strip_suffix('}'))
                {
                    for part in inner.split(',') {
                        let kv: Vec<&str> = part.splitn(2, '=').collect();
                        if kv.len() != 2 {
                            continue;
                        }
                        let k = kv[0].trim().to_lowercase();
                        let v = kv[1].trim();
                        match k.as_str() {
                            "unlocked" => {
                                earned = v.to_lowercase() == "true"
                                    || v == "1"
                                    || v.to_lowercase() == "yes"
                            }
                            "time" => {
                                if let Ok(t) = v.parse::<u64>() {
                                    time = t;
                                }
                            }
                            "progress" | "value" => {
                                if let Ok(p) = v.parse::<f64>() {
                                    progress = Some(p);
                                }
                            }
                            _ => {}
                        }
                    }
                }

                entries
                    .entry(key.clone())
                    .and_modify(|e| {
                        e.earned = earned;
                        e.earned_time = normalize_epoch(time);
                        if progress.is_some() {
                            e.progress = progress;
                        }
                    })
                    .or_insert_with(|| CrackAchievementEntry {
                        api_name: key.clone(),
                        earned,
                        earned_time: normalize_epoch(time),
                        progress,
                        max_progress: None,
                    });
            }
            _ => {}
        }
    }

    if entries.is_empty() {
        return Ok(None);
    }

    let result = CrackAchievementsResult {
        entries: entries.into_values().collect(),
        format: "tenoke-user-stats".to_string(),
        file_path: path,
    };
    Ok(Some(result))
}

// ---------------------------------------------------------------------------
// OnlineFix Stats/achievements.ini parser
// ---------------------------------------------------------------------------
// Format (Type 2 — human-readable):
//   [AchievementName]
//   State = 1
//   Time = 1700000000
//   CurProgress = 100
//   MaxProgress = 100
//
// Format (Type 1 — hex-encoded binary):
//   [AchievementName]
//   State = 00000001
//   Time = 5A8F5D00
//   CurProgress = 00000005
//   MaxProgress = 0000000A

#[tauri::command]
pub fn parse_onlinefix_achievements_ini(
    path: String,
) -> Result<Option<CrackAchievementsResult>, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(None);
    }

    let raw_bytes = fs::read(p).map_err(|e| format!("Failed to read {}: {}", path, e))?;
    let raw = decode_with_bom_detection(&raw_bytes);
    let raw = raw.trim_start_matches('\u{FEFF}'); // strip BOM

    // Simple INI parser — handles sections and key=value
    let mut sections: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut current_section = String::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
            continue;
        }

        if let Some(name) = trimmed.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            current_section = name.trim().to_string();
            continue;
        }

        if let Some(eq_pos) = trimmed.find('=') {
            let key = trimmed[..eq_pos].trim().to_string();
            let value = trimmed[eq_pos + 1..].trim().to_string();
            sections
                .entry(current_section.clone())
                .or_default()
                .insert(key, value);
        }
    }

    let mut entries: Vec<CrackAchievementEntry> = Vec::new();

    for (section_name, fields) in &sections {
        // Skip non-achievement sections
        if section_name.eq_ignore_ascii_case("Steam") || section_name.is_empty() {
            continue;
        }

        // Detect type: Type 2 has human-readable keys, Type 1 has hex-encoded
        let has_type2 = fields.keys().any(|k| {
            matches!(
                k.to_lowercase().as_str(),
                "achieved"
                    | "unlocked"
                    | "unlock"
                    | "unlocktime"
                    | "unlockedtime"
                    | "timestamp"
                    | "earned"
                    | "earnedtime"
            )
        });

        let has_type1 = fields.keys().any(|k| {
            matches!(
                k.to_lowercase().as_str(),
                "state" | "curprogress" | "maxprogress" | "time" | "progress" | "max"
            )
        });

        let entry = if has_type2 || (has_type2 && has_type1) {
            parse_type2_section(fields)
        } else {
            parse_type1_section(fields)
        };

        entries.push(CrackAchievementEntry {
            api_name: section_name.clone(),
            earned: entry.0,
            earned_time: entry.1,
            progress: entry.2,
            max_progress: entry.3,
        });
    }

    if entries.is_empty() {
        return Ok(None);
    }

    Ok(Some(CrackAchievementsResult {
        entries,
        format: "onlinefix-ini".to_string(),
        file_path: path,
    }))
}

// ---------------------------------------------------------------------------
// Type 2 parser (human-readable keys)
// ---------------------------------------------------------------------------

fn parse_type2_section(
    fields: &HashMap<String, String>,
) -> (bool, u64, Option<f64>, Option<f64>) {
    let get = |keys: &[&str]| -> Option<String> {
        for k in keys {
            if let Some(v) = fields.get(*k) {
                return Some(v.clone());
            }
            // Case-insensitive fallback
            for (fk, fv) in fields {
                if fk.eq_ignore_ascii_case(k) {
                    return Some(fv.clone());
                }
            }
        }
        None
    };

    let earned = get(&[
        "Achieved",
        "Earned",
        "Unlock",
        "Unlocked",
        "unlock",
        "unlocked",
    ])
    .map(|v| {
        let low = v.trim().to_lowercase();
        low == "1" || low == "true" || low == "yes"
    })
    .unwrap_or(false);

    let time = get(&[
        "UnlockTime",
        "unlockTime",
        "UnlockedTime",
        "unlockedTime",
        "Time",
        "time",
        "timestamp",
    ])
    .and_then(|v| v.parse::<u64>().ok())
    .unwrap_or(0);

    let progress = get(&["CurProgress", "curProgress", "progress", "Progress"])
        .and_then(|v| v.parse::<f64>().ok());

    let max_progress = get(&["MaxProgress", "maxProgress", "max_progress", "Max", "max"])
        .and_then(|v| v.parse::<f64>().ok());

    (earned, normalize_epoch(time), progress, max_progress)
}

// ---------------------------------------------------------------------------
// Type 1 parser (hex-encoded binary keys)
// ---------------------------------------------------------------------------

fn parse_type1_section(
    fields: &HashMap<String, String>,
) -> (bool, u64, Option<f64>, Option<f64>) {
    let state_raw = fields.get("State");
    let cur_raw = fields.get("CurProgress");
    let max_raw = fields.get("MaxProgress");
    let time_raw = fields.get("Time");
    let unlock_raw = fields.get("Unlock").or_else(|| fields.get("Unlocked"));

    let state_hex = state_raw.and_then(|v| hex_le32_from_str(v));
    let cur_hex = cur_raw.and_then(|v| hex_le32_from_str(v));
    let max_hex = max_raw.and_then(|v| hex_le32_from_str(v));
    let time_hex = time_raw.and_then(|v| hex_le32_from_str(v));

    let cur_val = cur_hex.or_else(|| cur_raw.and_then(|v| v.parse::<f64>().ok()));
    let max_val = max_hex.or_else(|| max_raw.and_then(|v| v.parse::<f64>().ok()));
    let time_val = time_hex.or_else(|| time_raw.and_then(|v| v.parse::<f64>().ok()));

    let unlocked = unlock_raw
        .map(|v| {
            let low = v.trim().to_lowercase();
            low == "1" || low == "true" || low == "yes"
        })
        .unwrap_or(false);

    let earned = unlocked
        || state_hex.map_or(false, |s| s > 0.0)
        || matches!(
            (cur_val, max_val),
            (Some(c), Some(m)) if m > 0.0 && c >= m
        );

    let time_u64 = time_val.map(|t| t as u64).unwrap_or(0);

    (
        earned,
        normalize_epoch(time_u64),
        cur_val,
        max_val,
    )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Decode bytes to string, auto-detecting UTF-16LE/BE via BOM or NUL bytes.
fn decode_with_bom_detection(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        // UTF-16LE BOM
        return String::from_utf16_lossy(
            &bytes[2..]
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect::<Vec<u16>>(),
        );
    }
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        // UTF-16BE BOM
        return String::from_utf16_lossy(
            &bytes[2..]
                .chunks_exact(2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect::<Vec<u16>>(),
        );
    }
    // Check for NUL bytes (indicates UTF-16 without BOM)
    if bytes.len() >= 2 && bytes.windows(2).any(|w| w[1] == 0x00 && w[0] != 0x00) {
        return String::from_utf16_lossy(
            &bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect::<Vec<u16>>(),
        );
    }
    String::from_utf8_lossy(bytes).to_string()
}

/// Parse hex string as little-endian u32.
fn hex_le32_from_str(s: &str) -> Option<f64> {
    let hex_str: String = s.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex_str.len() < 8 {
        return None;
    }
    let hex_pair = &hex_str[..8];
    let mut bytes = [0u8; 4];
    for i in 0..4 {
        let hi = hex_char_to_val(hex_pair.as_bytes()[i * 2])?;
        let lo = hex_char_to_val(hex_pair.as_bytes()[i * 2 + 1])?;
        bytes[i] = (hi << 4) | lo;
    }
    let val = u32::from_le_bytes(bytes);
    Some(val as f64)
}

fn hex_char_to_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Normalize epoch: if < 10 billion, assume seconds → multiply by 1000.
fn normalize_epoch(t: u64) -> u64 {
    if t == 0 {
        return 0;
    }
    if t < 10_000_000_000 {
        t * 1000
    } else {
        t
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_tenoke_basic() {
        let content = r#"
; Tenoke test
[STATS]
"Achievement1" = 100
"Achievement2" = 42,

[ACHIEVEMENTS]
"Achievement1" = {unlocked=true, time=1700000000, progress=100}
"Achievement2" = {unlocked=false, time=0}
"#;
        let tmp = std::env::temp_dir().join("test_tenoke.ini");
        fs::write(&tmp, content).unwrap();
        let result = parse_tenoke_user_stats(tmp.to_string_lossy().to_string()).unwrap();
        fs::remove_file(&tmp).unwrap();

        let r = result.expect("should have entries");
        assert_eq!(r.format, "tenoke-user-stats");
        assert_eq!(r.entries.len(), 2);

        let a1 = r.entries.iter().find(|e| e.api_name == "Achievement1").unwrap();
        assert!(a1.earned);
        assert_eq!(a1.earned_time, 1700000000 * 1000);
        assert_eq!(a1.progress, Some(100.0));

        let a2 = r.entries.iter().find(|e| e.api_name == "Achievement2").unwrap();
        assert!(!a2.earned);
        assert_eq!(a2.progress, Some(42.0)); // from STATS fallback
    }

    #[test]
    fn test_parse_onlinefix_type2() {
        let content = r#"
[Achievement One]
Achieved=1
CurProgress=5
MaxProgress=10
Time=1700000000

[Achievement Two]
Achieved=0
CurProgress=0
MaxProgress=0
"#;
        let tmp = std::env::temp_dir().join("test_onlinefix.ini");
        fs::write(&tmp, content).unwrap();
        let result = parse_onlinefix_achievements_ini(tmp.to_string_lossy().to_string()).unwrap();
        fs::remove_file(&tmp).unwrap();

        let r = result.expect("should have entries");
        assert_eq!(r.format, "onlinefix-ini");
        assert_eq!(r.entries.len(), 2);

        let a1 = r.entries.iter().find(|e| e.api_name == "Achievement One").unwrap();
        assert!(a1.earned);
        assert_eq!(a1.progress, Some(5.0));
        assert_eq!(a1.max_progress, Some(10.0));

        let a2 = r.entries.iter().find(|e| e.api_name == "Achievement Two").unwrap();
        assert!(!a2.earned);
    }

    #[test]
    fn test_parse_onlinefix_hex_type1() {
        // Hex values are little-endian byte strings
        // State=01000000 → LE u32 = 1 (unlocked)
        // Time=5A8F5D00 → LE u32 = 0x005D8F5A = 6131546 (seconds)
        // CurProgress=05000000 → LE u32 = 5
        // MaxProgress=0A000000 → LE u32 = 10
        let content = r#"
[Achievement Hex]
State=01000000
Time=5A8F5D00
CurProgress=05000000
MaxProgress=0A000000
"#;
        let tmp = std::env::temp_dir().join("test_onlinefix_hex.ini");
        fs::write(&tmp, content).unwrap();
        let result = parse_onlinefix_achievements_ini(tmp.to_string_lossy().to_string()).unwrap();
        fs::remove_file(&tmp).unwrap();

        let r = result.expect("should have entries");
        let a = &r.entries[0];
        assert!(a.earned); // State LE = 1 > 0
        assert_eq!(a.progress, Some(5.0));
        assert_eq!(a.max_progress, Some(10.0));
    }

    #[test]
    fn test_empty_file_returns_none() {
        let tmp = std::env::temp_dir().join("test_empty.ini");
        fs::write(&tmp, "").unwrap();
        assert!(parse_tenoke_user_stats(tmp.to_string_lossy().to_string())
            .unwrap()
            .is_none());
        assert!(parse_onlinefix_achievements_ini(tmp.to_string_lossy().to_string())
            .unwrap()
            .is_none());
        fs::remove_file(&tmp).unwrap();
    }

    #[test]
    fn test_nonexistent_file_returns_none() {
        assert!(parse_tenoke_user_stats("/nonexistent/path".to_string())
            .unwrap()
            .is_none());
        assert!(parse_onlinefix_achievements_ini("/nonexistent/path".to_string())
            .unwrap()
            .is_none());
    }
}
