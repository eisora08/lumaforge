//! Epic Games Store — Online library, catalog, and playtime fetching.
//!
//! Uses the undocumented Epic Games API (same endpoints as the launcher)
//! to fetch the user's owned games, catalog metadata, and playtime.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::epic_auth::{
    self, EpicCatalogItem, EpicOwnedGame, EpicPlaytimeItem, LibraryItemsResponse,
};

// ─── Constants ─────────────────────────────────────────────────────────────

/// Filter: skip Unreal Engine namespace.
const SKIP_NAMESPACE: &str = "ue";

/// Filter: skip private sandbox type.
const SKIP_SANDBOX: &str = "PRIVATE";

/// Filter: skip apps starting with this prefix.
const SKIP_APP_PREFIX: &str = "UE_";

// ─── Raw catalog response (bulk items) ─────────────────────────────────────

/// Response from the catalog bulk items endpoint.
#[derive(Debug, Clone, Deserialize)]
struct CatalogBulkResponse {
    /// The items are keyed by catalogItemId in the response.
    #[serde(flatten)]
    items: HashMap<String, EpicCatalogItem>,
}

// ─── Commands ──────────────────────────────────────────────────────────────

/// Fetch all owned games from the Epic library API.
///
/// Returns a list of owned game assets (not filtered — filtering happens on
/// the frontend or in a separate step).
#[tauri::command]
pub async fn epic_fetch_owned_games() -> Result<Vec<EpicOwnedGame>, String> {
    let (token_type, access_token) = epic_auth::get_valid_token().await?;
    let library_url = epic_auth::library_url();

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) EpicGamesLauncher")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let mut all_games: Vec<EpicOwnedGame> = Vec::new();
    let mut url = format!("{library_url}?includeMetadata=true&platform=Windows");

    loop {
        let resp = client
            .get(&url)
            .header("Authorization", format!("{token_type} {access_token}"))
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {e}"))?;

        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read response: {e}"))?;

        if !status.is_success() {
            return Err(format!("Epic library API error ({status}): {body}"));
        }

        let response: LibraryItemsResponse =
            serde_json::from_str(&body).map_err(|e| format!("Failed to parse library response: {e}"))?;

        all_games.extend(response.records);

        // Check for next page
        if let Some(metadata) = response.response_metadata {
            if let Some(cursor) = metadata.next_cursor {
                url = format!("{library_url}?includeMetadata=true&platform=Windows&cursor={cursor}");
                continue;
            }
        }

        break;
    }

    Ok(all_games)
}

/// Fetch owned games, filtered to eligible titles (no UE, no private, no DLC).
#[tauri::command]
pub async fn epic_fetch_filtered_owned_games() -> Result<Vec<EpicOwnedGame>, String> {
    let all_games = epic_fetch_owned_games().await?;

    let filtered: Vec<EpicOwnedGame> = all_games
        .into_iter()
        .filter(|g| {
            // Skip UE namespace
            if g.namespace.as_deref() == Some(SKIP_NAMESPACE) {
                return false;
            }
            // Skip private sandbox
            if g.sandbox_type.as_deref() == Some(SKIP_SANDBOX) {
                return false;
            }
            // Skip UE launcher itself
            if g.app_name.starts_with(SKIP_APP_PREFIX) {
                return false;
            }
            // Must have an appName
            if g.app_name.is_empty() {
                return false;
            }
            true
        })
        .collect();

    Ok(filtered)
}

/// Fetch catalog metadata for a specific item.
///
/// Returns the raw JSON string and parsed catalog items (keyed by catalogItemId).
#[tauri::command]
pub async fn epic_get_catalog_items(
    namespace: String,
    catalog_item_ids: Vec<String>,
) -> Result<HashMap<String, EpicCatalogItem>, String> {
    let (token_type, access_token) = epic_auth::get_valid_token().await?;
    let catalog_base = epic_auth::catalog_url();

    let ids_param = catalog_item_ids.join("&id=");
    let url = format!(
        "{catalog_base}{namespace}/bulk/items?id={ids_param}&country=US&locale=en-US&includeMainGameDetails=true"
    );

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) EpicGamesLauncher")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .header("Authorization", format!("{token_type} {access_token}"))
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    if !status.is_success() {
        return Err(format!("Epic catalog API error ({status}): {body}"));
    }

    let items: HashMap<String, EpicCatalogItem> =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse catalog response: {e}"))?;

    Ok(items)
}

/// Fetch playtime data for all games.
#[tauri::command]
pub async fn epic_fetch_playtime() -> Result<Vec<EpicPlaytimeItem>, String> {
    let (token_type, access_token) = epic_auth::get_valid_token().await?;
    let account_id = epic_auth::get_stored_account_id()?;
    let playtime_template = epic_auth::playtime_url();

    let url = playtime_template.replace("{account_id}", &account_id);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) EpicGamesLauncher")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .header("Authorization", format!("{token_type} {access_token}"))
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    if !status.is_success() {
        return Err(format!("Epic playtime API error ({status}): {body}"));
    }

    let items: Vec<EpicPlaytimeItem> =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse playtime response: {e}"))?;

    Ok(items)
}

/// Combined result for a full library sync.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicLibrarySyncResult {
    pub owned_games: Vec<EpicOwnedGame>,
    pub playtime: Vec<EpicPlaytimeItem>,
}

/// Fetch both owned games and playtime in one call.
#[tauri::command]
pub async fn epic_sync_library() -> Result<EpicLibrarySyncResult, String> {
    let owned = epic_fetch_filtered_owned_games().await?;
    let playtime = epic_fetch_playtime().await?;

    Ok(EpicLibrarySyncResult {
        owned_games: owned,
        playtime,
    })
}
