use tauri::command;

use crate::utils::cloud_config;
use crate::utils::cloud_redirect;
use crate::utils::oauth2;

// ---------------------------------------------------------------------------
// Request/Response types for frontend
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
pub struct CloudConnectRequest {
    pub provider: String,
}

#[derive(serde::Deserialize)]
pub struct CloudAddAppRequest {
    pub app_id: u64,
}

#[derive(serde::Deserialize)]
pub struct CloudRemoveAppRequest {
    pub app_id: u64,
}

#[derive(serde::Deserialize)]
pub struct CloudSetLocalPathRequest {
    pub path: String,
}

#[derive(serde::Deserialize)]
pub struct CloudSetR2CredentialsRequest {
    pub account_id: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub bucket: String,
    pub key_prefix: Option<String>,
    pub endpoint: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct CloudSetS3CredentialsRequest {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub bucket: String,
    pub endpoint: String,
    pub region: String,
    pub key_prefix: Option<String>,
    pub sign_payload: Option<bool>,
    pub allow_insecure_http: Option<bool>,
    pub allow_insecure_tls: Option<bool>,
    pub ca_cert_path: Option<String>,
}

#[derive(serde::Serialize)]
pub struct CloudStatusResult {
    pub success: bool,
    pub configured: bool,
    pub provider: Option<String>,
    pub dll_installed: bool,
    pub message: String,
}

#[derive(serde::Serialize)]
pub struct CloudProviderInfo {
    pub id: String,
    pub name: String,
    pub configured: bool,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Get the current cloud redirect status.
#[command]
pub async fn cloud_get_status() -> Result<CloudStatusResult, String> {
    let config = cloud_config::read_config();
    let steam_paths = crate::utils::path_utils::detect_steam_paths();
    let dll_installed = steam_paths
        .as_ref()
        .map(|p| cloud_redirect::dll_exists(std::path::Path::new(&p.steam_root)))
        .unwrap_or(false);

    let configured = !config.provider.is_empty();
    let provider = if configured {
        Some(config.provider.clone())
    } else {
        None
    };

    let message = if !dll_installed {
        "CloudRedirect DLL not installed".to_string()
    } else if !configured {
        "Cloud provider not configured".to_string()
    } else {
        format!("Connected to {}", cloud_config::CloudProvider::from_str(&config.provider)
            .map(|p| p.display_name())
            .unwrap_or("Unknown"))
    };

    Ok(CloudStatusResult {
        success: true,
        configured,
        provider,
        dll_installed,
        message,
    })
}

/// Get the list of available cloud providers.
#[command]
pub async fn cloud_get_providers() -> Result<Vec<CloudProviderInfo>, String> {
    let config = cloud_config::read_config();
    let providers = vec![
        CloudProviderInfo {
            id: "gdrive".to_string(),
            name: "Google Drive".to_string(),
            configured: config.provider == "gdrive",
        },
        CloudProviderInfo {
            id: "onedrive".to_string(),
            name: "OneDrive".to_string(),
            configured: config.provider == "onedrive",
        },
        CloudProviderInfo {
            id: "s3".to_string(),
            name: "S3 Compatible".to_string(),
            configured: config.provider == "s3",
        },
        CloudProviderInfo {
            id: "r2".to_string(),
            name: "Cloudflare R2".to_string(),
            configured: config.provider == "r2",
        },
        CloudProviderInfo {
            id: "folder".to_string(),
            name: "Local Folder".to_string(),
            configured: config.provider == "folder",
        },
    ];
    Ok(providers)
}

/// Connect to a cloud provider (writes config, triggers OAuth2 flow if needed).
#[command]
pub async fn cloud_connect(request: CloudConnectRequest) -> Result<CloudStatusResult, String> {
    let provider = cloud_config::CloudProvider::from_str(&request.provider)
        .ok_or_else(|| format!("Unknown provider: {}", request.provider))?;

    // Get the token path for this provider
    let token_path = cloud_config::get_token_path(provider)
        .map_err(|e| format!("Failed to get token path: {e}"))?;

    // Write the config
    cloud_config::write_provider_config(provider, token_path.to_str().unwrap_or(""))
        .map_err(|e| format!("Failed to write config: {e}"))?;

    // Auto-patch OpenSteamTool [cloud] config if installed
    let mut message = format!("Connected to {}", provider.display_name());
    if let Some(steam_paths) = crate::utils::path_utils::detect_steam_paths() {
        let steam_root = std::path::Path::new(&steam_paths.steam_root);
        match cloud_config::patch_opensteamtool_cloud_enabled(steam_root) {
            Ok(patch_result) if patch_result == "created" || patch_result == "updated" => {
                message.push_str(&format!(" (OpenSteamTool cloud enabled: {patch_result})"));
            }
            _ => {}
        }
    }

    Ok(CloudStatusResult {
        success: true,
        configured: true,
        provider: Some(provider.as_str().to_string()),
        dll_installed: true,
        message,
    })
}

/// Connect to local folder provider.
#[command]
pub async fn cloud_connect_local(request: CloudSetLocalPathRequest) -> Result<CloudStatusResult, String> {
    cloud_config::write_local_config(&request.path)
        .map_err(|e| format!("Failed to write config: {e}"))?;

    // Auto-patch OpenSteamTool [cloud] config if installed
    let mut message = format!("Connected to local folder: {}", request.path);
    if let Some(steam_paths) = crate::utils::path_utils::detect_steam_paths() {
        let steam_root = std::path::Path::new(&steam_paths.steam_root);
        match cloud_config::patch_opensteamtool_cloud_enabled(steam_root) {
            Ok(patch_result) if patch_result == "created" || patch_result == "updated" => {
                message.push_str(&format!(" (OpenSteamTool cloud enabled: {patch_result})"));
            }
            _ => {}
        }
    }

    Ok(CloudStatusResult {
        success: true,
        configured: true,
        provider: Some("folder".to_string()),
        dll_installed: true,
        message,
    })
}

/// Set R2 credentials and connect to Cloudflare R2 provider.
#[command]
pub async fn cloud_set_r2_credentials(request: CloudSetR2CredentialsRequest) -> Result<CloudStatusResult, String> {
    let creds = cloud_config::R2Credentials {
        account_id: request.account_id,
        access_key_id: request.access_key_id,
        secret_access_key: request.secret_access_key,
        bucket: request.bucket,
        key_prefix: request.key_prefix,
        endpoint: request.endpoint,
    };
    cloud_config::write_r2_credentials(&creds)?;

    let token_path = cloud_config::get_token_path(cloud_config::CloudProvider::R2)?;
    cloud_config::write_provider_config(cloud_config::CloudProvider::R2, token_path.to_str().unwrap_or(""))?;

    let mut message = "Connected to Cloudflare R2".to_string();
    if let Some(steam_paths) = crate::utils::path_utils::detect_steam_paths() {
        let steam_root = std::path::Path::new(&steam_paths.steam_root);
        match cloud_config::patch_opensteamtool_cloud_enabled(steam_root) {
            Ok(patch_result) if patch_result == "created" || patch_result == "updated" => {
                message.push_str(&format!(" (OpenSteamTool cloud enabled: {patch_result})"));
            }
            _ => {}
        }
    }

    Ok(CloudStatusResult {
        success: true,
        configured: true,
        provider: Some("r2".to_string()),
        dll_installed: true,
        message,
    })
}

/// Set S3-compatible credentials and connect to S3 provider.
#[command]
pub async fn cloud_set_s3_credentials(request: CloudSetS3CredentialsRequest) -> Result<CloudStatusResult, String> {
    let creds = cloud_config::S3Credentials {
        access_key_id: request.access_key_id,
        secret_access_key: request.secret_access_key,
        bucket: request.bucket,
        key_prefix: request.key_prefix,
        endpoint: Some(request.endpoint),
        region: Some(request.region),
    };
    cloud_config::write_s3_credentials(&creds)?;

    let token_path = cloud_config::get_token_path(cloud_config::CloudProvider::S3)?;
    cloud_config::write_provider_config(cloud_config::CloudProvider::S3, token_path.to_str().unwrap_or(""))?;

    let mut message = "Connected to S3-compatible storage".to_string();
    if let Some(steam_paths) = crate::utils::path_utils::detect_steam_paths() {
        let steam_root = std::path::Path::new(&steam_paths.steam_root);
        match cloud_config::patch_opensteamtool_cloud_enabled(steam_root) {
            Ok(patch_result) if patch_result == "created" || patch_result == "updated" => {
                message.push_str(&format!(" (OpenSteamTool cloud enabled: {patch_result})"));
            }
            _ => {}
        }
    }

    Ok(CloudStatusResult {
        success: true,
        configured: true,
        provider: Some("s3".to_string()),
        dll_installed: true,
        message,
    })
}

/// Get R2 credentials (returns None if not configured).
#[command]
pub async fn cloud_get_r2_credentials() -> Result<Option<cloud_config::R2Credentials>, String> {
    match cloud_config::read_r2_credentials() {
        Ok(creds) => Ok(Some(creds)),
        Err(_) => Ok(None),
    }
}

/// Get S3 credentials (returns None if not configured).
#[command]
pub async fn cloud_get_s3_credentials() -> Result<Option<cloud_config::S3Credentials>, String> {
    match cloud_config::read_s3_credentials() {
        Ok(creds) => Ok(Some(creds)),
        Err(_) => Ok(None),
    }
}

/// Disconnect from the cloud provider.
#[command]
pub async fn cloud_disconnect() -> Result<CloudStatusResult, String> {
    let config = cloud_config::CloudConfig {
        provider: String::new(),
        token_path: None,
        sync_path: None,
        token_paths: None,
        max_upload_mb: Some(50),
        sync_luas: Some(true),
        sync_achievements: Some(false),
        sync_playtime: Some(false),
    };
    cloud_config::write_config(&config)
        .map_err(|e| format!("Failed to write config: {e}"))?;

    Ok(CloudStatusResult {
        success: true,
        configured: false,
        provider: None,
        dll_installed: true,
        message: "Disconnected from cloud provider".to_string(),
    })
}

/// Add an app to the CloudRedirect set.
#[command]
pub async fn cloud_add_app(request: CloudAddAppRequest) -> Result<CloudStatusResult, String> {
    cloud_redirect::add_app(request.app_id as u32)?;

    Ok(CloudStatusResult {
        success: true,
        configured: true,
        provider: cloud_config::read_config().provider.into(),
        dll_installed: true,
        message: format!("App {} added to cloud sync", request.app_id),
    })
}

/// Remove an app from the CloudRedirect set.
#[command]
pub async fn cloud_remove_app(request: CloudRemoveAppRequest) -> Result<CloudStatusResult, String> {
    cloud_redirect::remove_app(request.app_id as u32)?;

    Ok(CloudStatusResult {
        success: true,
        configured: true,
        provider: cloud_config::read_config().provider.into(),
        dll_installed: true,
        message: format!("App {} removed from cloud sync", request.app_id),
    })
}

/// Check if an app is registered with CloudRedirect.
#[command]
pub async fn cloud_is_app_registered(app_id: u64) -> Result<bool, String> {
    cloud_redirect::is_app(app_id as u32)
}

/// Start the OAuth2 flow for a cloud provider (Google Drive / OneDrive).
/// Opens a WebView to the provider's auth page, waits for the callback,
/// exchanges the code for tokens, and closes the window.
#[command]
pub async fn cloud_start_oauth(app: tauri::AppHandle, provider: String) -> Result<oauth2::OAuthResult, String> {
    let provider_enum = cloud_config::CloudProvider::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {provider}"))?;

    // Run the OAuth2 flow async — WebView + local server, no spawn_blocking
    oauth2::start_oauth_flow(app, provider_enum).await
}
