use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// CloudRedirect config types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudConfig {
    pub provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_paths: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_upload_mb: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_luas: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_achievements: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_playtime: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S3Credentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub bucket: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_prefix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct R2Credentials {
    pub account_id: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub bucket: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_prefix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
}

// ---------------------------------------------------------------------------
// Supported providers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CloudProvider {
    GoogleDrive,
    OneDrive,
    S3,
    R2,
    Local,
}

impl CloudProvider {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::GoogleDrive => "gdrive",
            Self::OneDrive => "onedrive",
            Self::S3 => "s3",
            Self::R2 => "r2",
            Self::Local => "folder",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "gdrive" | "google" => Some(Self::GoogleDrive),
            "onedrive" | "one" => Some(Self::OneDrive),
            "s3" => Some(Self::S3),
            "r2" => Some(Self::R2),
            "folder" | "local" => Some(Self::Local),
            _ => None,
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::GoogleDrive => "Google Drive",
            Self::OneDrive => "OneDrive",
            Self::S3 => "S3 Compatible",
            Self::R2 => "Cloudflare R2",
            Self::Local => "Local Folder",
        }
    }
}

// ---------------------------------------------------------------------------
// Config directory and file paths
// ---------------------------------------------------------------------------

/// Get the CloudRedirect config directory (`%APPDATA%/CloudRedirect`).
pub fn get_config_dir() -> Result<PathBuf, String> {
    let app_data = dirs::config_dir()
        .or_else(|| dirs::data_dir())
        .ok_or("Cannot resolve AppData directory")?;
    let config_dir = app_data.join("CloudRedirect");
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config dir: {e}"))?;
    Ok(config_dir)
}

/// Get the path to `config.json`.
pub fn get_config_path() -> Result<PathBuf, String> {
    Ok(get_config_dir()?.join("config.json"))
}

/// Get the token file path for a given provider.
pub fn get_token_path(provider: CloudProvider) -> Result<PathBuf, String> {
    let config_dir = get_config_dir()?;
    let filename = match provider {
        CloudProvider::GoogleDrive => "google_tokens.json",
        CloudProvider::OneDrive => "onedrive_tokens.json",
        CloudProvider::S3 => "s3_credentials.json",
        CloudProvider::R2 => "r2_credentials.json",
        CloudProvider::Local => "local_config.json",
    };
    Ok(config_dir.join(filename))
}

// ---------------------------------------------------------------------------
// Read / Write config.json
// ---------------------------------------------------------------------------

/// Read the existing config.json (returns default if not found).
pub fn read_config() -> CloudConfig {
    let config_path = match get_config_path() {
        Ok(p) => p,
        Err(_) => return default_config(),
    };
    let content = match fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return default_config(),
    };
    serde_json::from_str(&content).unwrap_or_else(|_| default_config())
}

/// Write config.json with the given provider and token path.
pub fn write_config(config: &CloudConfig) -> Result<(), String> {
    let config_path = get_config_path()?;
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    fs::write(&config_path, json)
        .map_err(|e| format!("Failed to write config.json: {e}"))?;
    Ok(())
}

/// Write config.json for a specific provider.
pub fn write_provider_config(provider: CloudProvider, token_path: &str) -> Result<(), String> {
    let mut token_paths = HashMap::new();
    token_paths.insert(provider.as_str().to_string(), token_path.to_string());

    let config = CloudConfig {
        provider: provider.as_str().to_string(),
        token_path: Some(token_path.to_string()),
        sync_path: None,
        token_paths: Some(token_paths),
        max_upload_mb: Some(50),
        sync_luas: Some(true),
        sync_achievements: Some(false),
        sync_playtime: Some(false),
    };
    write_config(&config)
}

/// Write config.json for a local folder provider.
pub fn write_local_config(sync_path: &str) -> Result<(), String> {
    let config = CloudConfig {
        provider: "folder".to_string(),
        token_path: None,
        sync_path: Some(sync_path.to_string()),
        token_paths: None,
        max_upload_mb: Some(50),
        sync_luas: Some(true),
        sync_achievements: Some(false),
        sync_playtime: Some(false),
    };
    write_config(&config)
}

fn default_config() -> CloudConfig {
    CloudConfig {
        provider: String::new(),
        token_path: None,
        sync_path: None,
        token_paths: None,
        max_upload_mb: Some(50),
        sync_luas: Some(true),
        sync_achievements: Some(false),
        sync_playtime: Some(false),
    }
}

// ---------------------------------------------------------------------------
// Read / Write token files
// ---------------------------------------------------------------------------

/// Read OAuth tokens for a provider.
pub fn read_oauth_tokens(provider: CloudProvider) -> Result<OAuthTokens, String> {
    let token_path = get_token_path(provider)?;
    let content = fs::read_to_string(&token_path)
        .map_err(|e| format!("Failed to read token file: {e}"))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse token file: {e}"))
}

/// Write OAuth tokens for a provider.
pub fn write_oauth_tokens(provider: CloudProvider, tokens: &OAuthTokens) -> Result<(), String> {
    let token_path = get_token_path(provider)?;
    let json = serde_json::to_string_pretty(tokens)
        .map_err(|e| format!("Failed to serialize tokens: {e}"))?;
    fs::write(&token_path, json)
        .map_err(|e| format!("Failed to write token file: {e}"))?;
    Ok(())
}

/// Read S3 credentials.
pub fn read_s3_credentials() -> Result<S3Credentials, String> {
    let token_path = get_token_path(CloudProvider::S3)?;
    let content = fs::read_to_string(&token_path)
        .map_err(|e| format!("Failed to read S3 credentials: {e}"))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse S3 credentials: {e}"))
}

/// Write S3 credentials.
pub fn write_s3_credentials(creds: &S3Credentials) -> Result<(), String> {
    let token_path = get_token_path(CloudProvider::S3)?;
    // Normalize empty strings to None for optional fields
    let normalized = S3Credentials {
        access_key_id: creds.access_key_id.clone(),
        secret_access_key: creds.secret_access_key.clone(),
        bucket: creds.bucket.clone(),
        key_prefix: creds.key_prefix.as_ref().and_then(|s| {
            let trimmed = s.trim();
            if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
        }),
        endpoint: creds.endpoint.as_ref().and_then(|s| {
            let trimmed = s.trim();
            if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
        }),
        region: creds.region.as_ref().and_then(|s| {
            let trimmed = s.trim();
            if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
        }),
    };
    let json = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("Failed to serialize S3 credentials: {e}"))?;
    fs::write(&token_path, json)
        .map_err(|e| format!("Failed to write S3 credentials: {e}"))?;
    Ok(())
}

/// Read R2 credentials.
pub fn read_r2_credentials() -> Result<R2Credentials, String> {
    let token_path = get_token_path(CloudProvider::R2)?;
    let content = fs::read_to_string(&token_path)
        .map_err(|e| format!("Failed to read R2 credentials: {e}"))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse R2 credentials: {e}"))
}

/// Write R2 credentials.
pub fn write_r2_credentials(creds: &R2Credentials) -> Result<(), String> {
    let token_path = get_token_path(CloudProvider::R2)?;
    // Normalize empty strings to None for optional fields
    let normalized = R2Credentials {
        account_id: creds.account_id.clone(),
        access_key_id: creds.access_key_id.clone(),
        secret_access_key: creds.secret_access_key.clone(),
        bucket: creds.bucket.clone(),
        key_prefix: creds.key_prefix.as_ref().and_then(|s| {
            let trimmed = s.trim();
            if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
        }),
        endpoint: creds.endpoint.as_ref().and_then(|s| {
            let trimmed = s.trim();
            if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
        }),
    };
    let json = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("Failed to serialize R2 credentials: {e}"))?;
    fs::write(&token_path, json)
        .map_err(|e| format!("Failed to write R2 credentials: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/// Get the current cloud redirect status.
pub fn get_status() -> CloudConfig {
    read_config()
}

/// Check if cloud redirect is configured (has a provider set).
pub fn is_configured() -> bool {
    let config = read_config();
    !config.provider.is_empty()
}

// ---------------------------------------------------------------------------
// OpenSteamTool TOML config patching
// ---------------------------------------------------------------------------

/// Patch `opensteamtool.toml` to enable `[cloud]` section.
/// This replicates what CloudRedirect's companion app does in
/// `OpenSteamToolIntegration.EnsureCloudEnabled()`.
///
/// Returns a description of what was done:
/// - `"already_enabled"` — `[cloud].enabled` was already `true`
/// - `"created"` — new `[cloud]` section was appended
/// - `"updated"` — `enabled = false` was changed to `true`
/// - `"not_found"` — `opensteamtool.toml` does not exist
pub fn patch_opensteamtool_cloud_enabled(steam_root: &Path) -> Result<String, String> {
    let toml_path = steam_root.join("opensteamtool.toml");

    if !toml_path.exists() {
        fs::write(&toml_path, "[cloud]\nenabled = true\n")
            .map_err(|e| format!("Failed to create opensteamtool.toml: {e}"))?;
        return Ok("created".to_string());
    }

    let content = fs::read_to_string(&toml_path)
        .map_err(|e| format!("Failed to read opensteamtool.toml: {e}"))?;

    // Detect newline style
    let newline = if content.contains("\r\n") { "\r\n" } else { "\n" };

    let lines: Vec<&str> = content.split('\n').collect();
    let mut cloud_section_found = false;
    let mut cloud_enabled_found = false;
    let mut cloud_enabled_value = false;

    // Find the [cloud] section and its enabled key
    let mut in_cloud_section = false;
    let mut cloud_section_line_idx = None;

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        // Detect section headers (any [section] that's not a sub-table like [a.b])
        if trimmed.starts_with('[')
            && !trimmed.starts_with("[[")
            && trimmed.ends_with(']')
            && !trimmed.contains('.')
        {
            if trimmed.eq_ignore_ascii_case("[cloud]") {
                in_cloud_section = true;
                cloud_section_found = true;
                cloud_section_line_idx = Some(i);
            } else {
                in_cloud_section = false;
            }
        }

        // Inside [cloud] section, look for enabled = ...
        if in_cloud_section && trimmed.starts_with("enabled") {
            let parts: Vec<&str> = trimmed.splitn(2, '=').collect();
            if parts.len() == 2 && parts[0].trim().eq_ignore_ascii_case("enabled") {
                cloud_enabled_found = true;
                cloud_enabled_value = parts[1].trim().eq_ignore_ascii_case("true");
            }
        }
    }

    // Backup before modifying
    if cloud_section_found && !cloud_enabled_value {
        let bak_path = toml_path.with_extension("toml.cloudredirect.bak");
        let _ = fs::copy(&toml_path, &bak_path);
    }

    if cloud_section_found && cloud_enabled_found && cloud_enabled_value {
        // Already enabled
        return Ok("already_enabled".to_string());
    }

    if cloud_section_found && cloud_enabled_found && !cloud_enabled_value {
        // Replace enabled = false with enabled = true
        let mut new_lines = Vec::new();
        let mut in_cloud = false;
        for line in &lines {
            let trimmed = line.trim();
            if trimmed.eq_ignore_ascii_case("[cloud]") {
                in_cloud = true;
                new_lines.push(line.to_string());
                continue;
            }
            if in_cloud && trimmed.starts_with("enabled") {
                let parts: Vec<&str> = trimmed.splitn(2, '=').collect();
                if parts.len() == 2 && parts[0].trim().eq_ignore_ascii_case("enabled") {
                    new_lines.push(format!("enabled = true"));
                    in_cloud = false;
                    continue;
                }
            }
            // Exit cloud section on next section header
            if in_cloud && trimmed.starts_with('[') && trimmed.ends_with(']') {
                in_cloud = false;
            }
            new_lines.push(line.to_string());
        }
        let new_content = new_lines.join(newline);
        fs::write(&toml_path, new_content)
            .map_err(|e| format!("Failed to write opensteamtool.toml: {e}"))?;
        return Ok("updated".to_string());
    }

    if !cloud_section_found {
        // Append [cloud]\nenabled = true\n to end of file
        let mut new_content = content.trim_end().to_string();
        new_content.push_str(newline);
        new_content.push_str("[cloud]");
        new_content.push_str(newline);
        new_content.push_str("enabled = true");
        new_content.push_str(newline);
        fs::write(&toml_path, new_content)
            .map_err(|e| format!("Failed to write opensteamtool.toml: {e}"))?;
        return Ok("created".to_string());
    }

    // Section exists but no enabled key found — insert after section header
    if cloud_section_found && !cloud_enabled_found {
        let mut new_lines = Vec::new();
        let mut inserted = false;
        for (i, line) in lines.iter().enumerate() {
            new_lines.push(line.to_string());
            if !inserted && i == cloud_section_line_idx.unwrap_or(0) {
                new_lines.push("enabled = true".to_string());
                inserted = true;
            }
        }
        let new_content = new_lines.join(newline);
        fs::write(&toml_path, new_content)
            .map_err(|e| format!("Failed to write opensteamtool.toml: {e}"))?;
        return Ok("created".to_string());
    }

    Ok("already_enabled".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_as_str() {
        assert_eq!(CloudProvider::GoogleDrive.as_str(), "gdrive");
        assert_eq!(CloudProvider::OneDrive.as_str(), "onedrive");
        assert_eq!(CloudProvider::S3.as_str(), "s3");
        assert_eq!(CloudProvider::R2.as_str(), "r2");
        assert_eq!(CloudProvider::Local.as_str(), "folder");
    }

    #[test]
    fn test_provider_from_str() {
        assert_eq!(CloudProvider::from_str("gdrive"), Some(CloudProvider::GoogleDrive));
        assert_eq!(CloudProvider::from_str("onedrive"), Some(CloudProvider::OneDrive));
        assert_eq!(CloudProvider::from_str("s3"), Some(CloudProvider::S3));
        assert_eq!(CloudProvider::from_str("r2"), Some(CloudProvider::R2));
        assert_eq!(CloudProvider::from_str("folder"), Some(CloudProvider::Local));
        assert_eq!(CloudProvider::from_str("invalid"), None);
    }

    #[test]
    fn test_config_serialization() {
        let config = CloudConfig {
            provider: "gdrive".to_string(),
            token_path: Some("/path/to/tokens.json".to_string()),
            sync_path: None,
            token_paths: None,
            max_upload_mb: Some(50),
            sync_luas: Some(true),
            sync_achievements: None,
            sync_playtime: None,
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("gdrive"));
        assert!(json.contains("/path/to/tokens.json"));
    }
}
