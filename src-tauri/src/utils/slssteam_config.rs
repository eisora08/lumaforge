use regex::Regex;
use std::fs;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Config path resolution
// ---------------------------------------------------------------------------

/// Get the path to SLSsteam's config.yaml.
/// Uses XDG_CONFIG_HOME if set, otherwise defaults to ~/.config/SLSsteam/
pub fn get_config_path() -> PathBuf {
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        PathBuf::from(xdg).join("SLSsteam").join("config.yaml")
    } else {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".config")
            .join("SLSsteam")
            .join("config.yaml")
    }
}

/// Check if the SLSsteam config file exists.
pub fn config_exists() -> bool {
    get_config_path().exists()
}

// ---------------------------------------------------------------------------
// Read / Write helpers
// ---------------------------------------------------------------------------

fn read_config(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("Failed to read config.yaml: {e}"))
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("yaml.tmp");
    fs::write(&tmp, content).map_err(|e| format!("Failed to write temp config: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("Failed to rename temp config: {e}"))
}

// ---------------------------------------------------------------------------
// AdditionalApps
// ---------------------------------------------------------------------------

/// Add an AppID to the AdditionalApps list.
/// Returns true if added, false if already present.
pub fn add_additional_app(app_id: &str, comment: &str) -> Result<bool, String> {
    let path = get_config_path();

    if !path.exists() {
        // Create config with new entry
        let entry = if comment.is_empty() {
            format!("AdditionalApps:\n  - {app_id}\n")
        } else {
            format!("AdditionalApps:\n  - {app_id}   # {comment}\n")
        };
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {e}"))?;
        }
        atomic_write(&path, &entry)?;
        return Ok(true);
    }

    let content = read_config(&path)?;

    // Check if already present
    let existing = Regex::new(&format!(
        r"(?m)^\s*-\s*{}\s*(?:#.*)?$",
        regex::escape(app_id)
    ))
    .map_err(|e| format!("Regex error: {e}"))?;

    if existing.is_match(&content) {
        return Ok(false);
    }

    // Find AdditionalApps section
    let section_re = Regex::new(r"(?m)^AdditionalApps:\s*$")
        .map_err(|e| format!("Regex error: {e}"))?;

    let new_entry = if comment.is_empty() {
        format!("  - {app_id}\n")
    } else {
        format!("  - {app_id}   # {comment}\n")
    };

    if let Some(mat) = section_re.find(&content) {
        // Start AFTER the newline following "AdditionalApps:"
        let after_header = &content[mat.end()..];
        let skip = if after_header.starts_with('\n') { 1 } else { 0 };
        let mut last_item_end = mat.end() + skip;

        // Find last list item in the section
        let after = &content[last_item_end..];
        let lines: Vec<&str> = after.lines().collect();

        for line in &lines {
            let trimmed = line.trim();
            if trimmed.starts_with('-') {
                let line_start = content[..last_item_end].len() + content[last_item_end..].find(line).unwrap_or(0);
                last_item_end = line_start + line.len();
                // Include trailing newline
                if content.get(last_item_end..last_item_end + 1) == Some("\n") {
                    last_item_end += 1;
                }
            } else if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            } else {
                break;
            }
        }

        let mut new_content = content.clone();
        new_content.insert_str(last_item_end, &new_entry);
        atomic_write(&path, &new_content)?;
    } else {
        // Create new section
        let mut new_content = content;
        if !new_content.ends_with('\n') {
            new_content.push('\n');
        }
        new_content.push_str(&format!("\nAdditionalApps:\n{new_entry}"));
        atomic_write(&path, &new_content)?;
    }

    Ok(true)
}

/// Remove an AppID from the AdditionalApps list.
/// Returns true if removed, false if not found.
pub fn remove_additional_app(app_id: &str) -> Result<bool, String> {
    let path = get_config_path();
    if !path.exists() {
        return Ok(false);
    }

    let content = read_config(&path)?;
    let pattern = Regex::new(&format!(
        r"(?m)^\s*-\s*{}\s*(?:#.*)?\n?$",
        regex::escape(app_id)
    ))
    .map_err(|e| format!("Regex error: {e}"))?;

    if pattern.find(&content).is_none() {
        return Ok(false);
    }

    let new_content = pattern.replace_all(&content, "");
    atomic_write(&path, &new_content)?;
    Ok(true)
}

// ---------------------------------------------------------------------------
// AppTokens
// ---------------------------------------------------------------------------

/// Add an AppToken to the AppTokens section.
/// Returns true if added/updated, false if already present with same value.
pub fn add_app_token(app_id: &str, token: &str) -> Result<bool, String> {
    let path = get_config_path();
    if !path.exists() {
        return Ok(false);
    }

    let content = read_config(&path)?;

    // Find AppTokens section
    let section_re = Regex::new(r"(?m)^AppTokens:\s*$")
        .map_err(|e| format!("Regex error: {e}"))?;

    let existing_re = Regex::new(&format!(
        r"(?m)^  {}\s*:\s*(.+)$",
        regex::escape(app_id)
    ))
    .map_err(|e| format!("Regex error: {e}"))?;

    if let Some(mat) = section_re.find(&content) {
        let after_section = &content[mat.end()..];

        // Check if token already exists with same value
        if let Some(caps) = existing_re.captures(after_section) {
            let existing_val = caps.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            if existing_val == token {
                return Ok(false);
            }
            // Update existing token
            let mut new_content = content.clone();
            let full_match = caps.get(0).unwrap();
            let abs_start = mat.end() + full_match.start();
            let abs_end = mat.end() + full_match.end();
            let new_line = format!("  {app_id}: {token}");
            new_content.replace_range(abs_start..abs_end, &new_line);
            atomic_write(&path, &new_content)?;
            return Ok(true);
        }

        // Add new token after AppTokens: line
        let insert_pos = mat.end();
        let new_line = format!("\n  {app_id}: {token}");
        let mut new_content = content.clone();
        new_content.insert_str(insert_pos, &new_line);
        atomic_write(&path, &new_content)?;
        Ok(true)
    } else {
        // Create new AppTokens section
        let mut new_content = content;
        if !new_content.ends_with('\n') {
            new_content.push('\n');
        }
        new_content.push_str(&format!("\nAppTokens:\n  {app_id}: {token}\n"));
        atomic_write(&path, &new_content)?;
        Ok(true)
    }
}

// ---------------------------------------------------------------------------
// FakeAppIds
// ---------------------------------------------------------------------------

/// Add an AppID to the FakeAppIds section.
/// Returns true if added, false if already present.
pub fn add_fake_app_id(app_id: &str, fake_appid: &str, comment: &str) -> Result<bool, String> {
    let path = get_config_path();
    if !path.exists() {
        return Ok(false);
    }

    let content = read_config(&path)?;

    // Check if already present
    let existing_re = Regex::new(&format!(
        r"(?m)^\s*{}\s*:\s*{}",
        regex::escape(app_id),
        regex::escape(fake_appid)
    ))
    .map_err(|e| format!("Regex error: {e}"))?;

    if existing_re.is_match(&content) {
        return Ok(false);
    }

    let section_re = Regex::new(r"(?m)^FakeAppIds:\s*$")
        .map_err(|e| format!("Regex error: {e}"))?;

    let suffix = if fake_appid == "480" { "Spacewar" } else { "SLSonline" };
    let new_entry = if comment.is_empty() {
        format!("  {app_id}: {fake_appid}\n")
    } else {
        format!("  {app_id}: {fake_appid}   # {comment} -> {suffix}\n")
    };

    if let Some(mat) = section_re.find(&content) {
        // Start AFTER the newline following "FakeAppIds:"
        let after_header = &content[mat.end()..];
        let skip = if after_header.starts_with('\n') { 1 } else { 0 };
        let mut last_entry_end = mat.end() + skip;

        // Find last entry in section
        let after = &content[last_entry_end..];
        let lines: Vec<&str> = after.lines().collect();

        for line in &lines {
            let trimmed = line.trim();
            if !trimmed.is_empty() && !trimmed.starts_with('#') && trimmed.chars().next().map_or(false, |c| c.is_ascii_digit()) {
                let line_start = content[..last_entry_end].len() + content[last_entry_end..].find(line).unwrap_or(0);
                last_entry_end = line_start + line.len();
                if content.get(last_entry_end..last_entry_end + 1) == Some("\n") {
                    last_entry_end += 1;
                }
            } else if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            } else {
                break;
            }
        }

        let mut new_content = content.clone();
        new_content.insert_str(last_entry_end, &new_entry);
        atomic_write(&path, &new_content)?;
    } else {
        let mut new_content = content;
        if !new_content.ends_with('\n') {
            new_content.push('\n');
        }
        new_content.push_str(&format!("\nFakeAppIds:\n{new_entry}"));
        atomic_write(&path, &new_content)?;
    }

    Ok(true)
}

/// Remove an AppID from the FakeAppIds section.
pub fn remove_fake_app_id(app_id: &str, fake_appid: &str) -> Result<bool, String> {
    let path = get_config_path();
    if !path.exists() {
        return Ok(false);
    }

    let content = read_config(&path)?;
    let pattern = Regex::new(&format!(
        r"(?m)^\s*{}\s*:\s*{}.*\n?$",
        regex::escape(app_id),
        regex::escape(fake_appid)
    ))
    .map_err(|e| format!("Regex error: {e}"))?;

    if pattern.find(&content).is_none() {
        return Ok(false);
    }

    let new_content = pattern.replace_all(&content, "");
    atomic_write(&path, &new_content)?;
    Ok(true)
}

// ---------------------------------------------------------------------------
// YAML boolean values (PlayNotOwnedGames, API, etc.)
// ---------------------------------------------------------------------------

/// Update a boolean value in the YAML config (yes/no format).
/// Returns true if updated, false if already correct or key not found.
pub fn update_yaml_boolean(key: &str, value: bool) -> Result<bool, String> {
    let path = get_config_path();
    if !path.exists() {
        return Ok(false);
    }

    let content = read_config(&path)?;
    let pattern = Regex::new(&format!(
        r"(?m)^(\s*){}\s*:\s*(yes|no|true|false|Yes|No|True|False)\b",
        regex::escape(key)
    ))
    .map_err(|e| format!("Regex error: {e}"))?;

    let mat = match pattern.find(&content) {
        Some(m) => m,
        None => return Ok(false),
    };

    let indent = pattern.captures(&content[mat.start()..mat.end()])
        .and_then(|c| c.get(1))
        .map(|m| m.as_str())
        .unwrap_or("");

    let old_val = pattern.captures(&content[mat.start()..mat.end()])
        .and_then(|c| c.get(2))
        .map(|m| m.as_str())
        .unwrap_or("");

    let new_val = if value { "yes" } else { "no" };
    if old_val.eq_ignore_ascii_case(new_val) {
        return Ok(false);
    }

    let replacement = format!("{indent}{key}: {new_val}");
    let new_content = pattern.replace(&content, replacement.as_str());
    atomic_write(&path, &new_content)?;
    Ok(true)
}

// ---------------------------------------------------------------------------
// Indentation fix
// ---------------------------------------------------------------------------

/// Fix indentation of AdditionalApps list items (ensure 2-space indent).
pub fn fix_additional_apps_indentation() -> Result<bool, String> {
    let path = get_config_path();
    if !path.exists() {
        return Ok(false);
    }

    let content = read_config(&path)?;
    let section_re = Regex::new(r"(?m)^AdditionalApps:\s*$")
        .map_err(|e| format!("Regex error: {e}"))?;

    let mat = match section_re.find(&content) {
        Some(m) => m,
        None => return Ok(false),
    };

    // Find section end
    let after = &content[mat.end()..];
    let next_key = Regex::new(r"(?m)^[A-Za-z]").map_err(|e| format!("Regex error: {e}"))?;
    let section_end = next_key.find(after).map(|m| mat.end() + m.start()).unwrap_or(content.len());

    let section = &content[mat.end()..section_end];
    let fix_re = Regex::new(r"(?m)^(\s*)- ?").map_err(|e| format!("Regex error: {e}"))?;
    let fixed = fix_re.replace_all(section, "  - ");

    if fixed == section {
        return Ok(false);
    }

    let mut new_content = content.clone();
    new_content.replace_range(mat.end()..section_end, &fixed);
    atomic_write(&path, &new_content)?;
    Ok(true)
}

/// Fix indentation of AppTokens entries (ensure 2-space indent).
pub fn fix_app_tokens_indentation() -> Result<bool, String> {
    let path = get_config_path();
    if !path.exists() {
        return Ok(false);
    }

    let content = read_config(&path)?;
    let section_re = Regex::new(r"(?m)^AppTokens:\s*$")
        .map_err(|e| format!("Regex error: {e}"))?;

    let mat = match section_re.find(&content) {
        Some(m) => m,
        None => return Ok(false),
    };

    let after = &content[mat.end()..];
    let next_key = Regex::new(r"(?m)^[A-Za-z][A-Za-z0-9]*:\s*$").map_err(|e| format!("Regex error: {e}"))?;
    let section_end = next_key.find(after).map(|m| mat.end() + m.start()).unwrap_or(content.len());

    let section = &content[mat.end()..section_end];
    let fix_re = Regex::new(r"(?m)^(\s*)(\d+\s*:.*)$").map_err(|e| format!("Regex error: {e}"))?;
    let fixed = fix_re.replace_all(section, "  $2");

    if fixed == section {
        return Ok(false);
    }

    let mut new_content = content.clone();
    new_content.replace_range(mat.end()..section_end, &fixed);
    atomic_write(&path, &new_content)?;
    Ok(true)
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

/// Check if a game AppID is in AdditionalApps.
pub fn is_in_additional_apps(app_id: &str) -> Result<bool, String> {
    let path = get_config_path();
    if !path.exists() {
        return Ok(false);
    }

    let content = read_config(&path)?;
    let re = Regex::new(&format!(
        r"(?m)^\s*-\s*{}\s*(?:#.*)?$",
        regex::escape(app_id)
    ))
    .map_err(|e| format!("Regex error: {e}"))?;

    Ok(re.is_match(&content))
}

/// Get all AppIDs from AdditionalApps.
pub fn get_additional_apps() -> Result<Vec<String>, String> {
    let path = get_config_path();
    if !path.exists() {
        return Ok(vec![]);
    }

    let content = read_config(&path)?;
    let section_re = Regex::new(r"(?m)^AdditionalApps:\s*$")
        .map_err(|e| format!("Regex error: {e}"))?;

    let mat = match section_re.find(&content) {
        Some(m) => m,
        None => return Ok(vec![]),
    };

    let after = &content[mat.end()..];
    let next_key = Regex::new(r"(?m)^[A-Za-z]").map_err(|e| format!("Regex error: {e}"))?;
    let section_end = next_key.find(after).map(|m| mat.end() + m.start()).unwrap_or(content.len());

    let section = &content[mat.end()..section_end];
    let item_re = Regex::new(r"(?m)^\s*-\s*(\d+)").map_err(|e| format!("Regex error: {e}"))?;

    Ok(item_re
        .captures_iter(section)
        .filter_map(|c| c.get(1).map(|m| m.as_str().to_string()))
        .collect())
}

/// Ensure the API setting is enabled in config.
pub fn ensure_api_enabled() -> Result<bool, String> {
    update_yaml_boolean("API", true)
}
