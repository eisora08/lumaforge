use serde::{Deserialize, Serialize};
use std::time::Duration;

use super::epic_auth;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpicAchievementSchema {
    pub product_id: String,
    pub sandbox_id: String,
    pub achievements: Vec<EpicAchievementEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpicAchievementEntry {
    pub api_name: String,
    pub display_name: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub icon_gray_url: Option<String>,
    pub hidden: bool,
    pub xp: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpicPlayerAchievement {
    pub achievement_name: String,
    pub unlocked: bool,
    pub unlock_date: Option<String>,
    pub xp: Option<i32>,
}

// REST API response types

#[derive(Debug, Deserialize)]
struct EpicAchievementsResponse {
    #[serde(default)]
    achievements: Vec<EpicAchievementWrapper>,
    #[serde(default, alias = "productId")]
    product_id: Option<String>,
    #[serde(default, alias = "sandboxId")]
    sandbox_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EpicAchievementWrapper {
    #[serde(default)]
    achievement: Option<EpicAchievementElement>,
}

#[derive(Debug, Deserialize)]
struct EpicAchievementElement {
    #[serde(default)]
    name: Option<String>,
    #[serde(default, alias = "id")]
    id: Option<String>,
    #[serde(default, alias = "unlockedDisplayName")]
    display_name: Option<String>,
    #[serde(default, alias = "unlockedDescription")]
    description: Option<String>,
    #[serde(default)]
    flavorText: Option<String>,
    #[serde(default)]
    hidden: Option<bool>,
    #[serde(default, alias = "XP")]
    xp: Option<i32>,
    #[serde(default, alias = "unlockedIconLink")]
    unlocked_icon: Option<String>,
    #[serde(default, alias = "lockedIconLink")]
    locked_icon: Option<String>,
}

// GraphQL response types

#[derive(Debug, Deserialize)]
struct GraphQLResponse {
    data: Option<GraphQLData>,
    #[serde(default)]
    errors: Option<Vec<GraphQLError>>,
}

#[derive(Debug, Deserialize)]
struct GraphQLData {
    #[serde(default, alias = "Achievements")]
    achievements: Option<GraphQLAchievementsWrapper>,
    #[serde(default, alias = "PlayerProfile")]
    player_profile: Option<GraphQLPlayerProfileWrapper>,
}

// GraphQL response has double nesting: data.PlayerProfile.playerProfile
#[derive(Debug, Deserialize)]
struct GraphQLPlayerProfileWrapper {
    #[serde(default, alias = "playerProfile")]
    inner: Option<GraphQLPlayerProfile>,
}

#[derive(Debug, Deserialize)]
struct GraphQLAchievementsWrapper {
    #[serde(default, alias = "achievements")]
    elements: Option<Vec<GraphQLAchievementWrapperItem>>,
}

#[derive(Debug, Deserialize)]
struct GraphQLAchievementWrapperItem {
    #[serde(default)]
    achievement: Option<GraphQLAchievementElement>,
}

#[derive(Debug, Deserialize)]
struct GraphQLAchievementElement {
    #[serde(default)]
    name: Option<String>,
    #[serde(default, alias = "id")]
    id: Option<String>,
    #[serde(default, alias = "unlockedDisplayName")]
    display_name: Option<String>,
    #[serde(default, alias = "unlockedDescription")]
    description: Option<String>,
    #[serde(default)]
    flavorText: Option<String>,
    #[serde(default)]
    hidden: Option<bool>,
    #[serde(default, alias = "XP")]
    xp: Option<i32>,
    #[serde(default, alias = "unlockedIconLink")]
    unlocked_icon: Option<String>,
    #[serde(default, alias = "lockedIconLink")]
    locked_icon: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GraphQLPlayerProfile {
    #[serde(default, alias = "epicAccountId")]
    epic_account_id: Option<String>,
    #[serde(default, alias = "displayName")]
    display_name: Option<String>,
    #[serde(default, alias = "productAchievements")]
    product_achievements: Option<GraphQLPlayerAchievementsResponse>,
}

#[derive(Debug, Deserialize)]
struct GraphQLPlayerAchievementsResponse {
    #[serde(default, alias = "data")]
    data: Option<GraphQLPlayerAchievementsData>,
}

#[derive(Debug, Deserialize)]
struct GraphQLPlayerAchievementsData {
    #[serde(default, alias = "totalXP")]
    total_xp: Option<i64>,
    #[serde(default, alias = "totalUnlocked")]
    total_unlocked: Option<i32>,
    #[serde(default, alias = "playerAchievements")]
    player_achievements: Option<Vec<GraphQLPlayerAchievementWrapper>>,
}

#[derive(Debug, Deserialize)]
struct GraphQLPlayerAchievementWrapper {
    #[serde(default, alias = "playerAchievement")]
    player_achievement: Option<GraphQLPlayerAchievementInner>,
}

#[derive(Debug, Deserialize)]
struct GraphQLPlayerAchievementInner {
    #[serde(default, alias = "achievementName")]
    achievement_name: Option<String>,
    #[serde(default)]
    unlocked: Option<bool>,
    #[serde(default, alias = "unlockDate")]
    unlock_date: Option<String>,
    #[serde(default)]
    xp: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct GraphQLError {
    message: Option<String>,
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) EpicGamesLauncher")
        .timeout(Duration::from_secs(30))
        .build()
        .expect("Failed to build HTTP client")
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Fetch achievement schema for an Epic game from the public REST API,
/// falling back to GraphQL if the REST endpoint returns no results.
/// Tries multiple IDs in priority order: namespace → productId → appName.
#[tauri::command]
pub async fn epic_fetch_achievement_schema(
    product_id: String,
    namespace_id: String,
) -> Result<EpicAchievementSchema, String> {
    // Build list of IDs to try for REST API (priority order from reference app)
    let mut ids_to_try: Vec<&str> = Vec::new();
    if !namespace_id.is_empty() {
        ids_to_try.push(&namespace_id);
    }
    if !product_id.is_empty() && product_id != namespace_id {
        ids_to_try.push(&product_id);
    }
    eprintln!("[EPIC_ACH] schema_fetch product_id={product_id} namespace_id={namespace_id} ids_to_try={ids_to_try:?}");
    // If both empty, nothing to try
    if ids_to_try.is_empty() {
        return Ok(EpicAchievementSchema {
            product_id,
            sandbox_id: namespace_id,
            achievements: Vec::new(),
        });
    }

    // Try REST API (public, no auth needed) with each ID
    for id in &ids_to_try {
        let schema = fetch_schema_rest(id).await?;
        eprintln!("[EPIC_ACH] REST try id={id} achievements={} discovered_product_id={}", schema.achievements.len(), schema.product_id);
        if !schema.achievements.is_empty() {
            return Ok(EpicAchievementSchema {
                product_id: schema.product_id,
                sandbox_id: schema.sandbox_id,
                achievements: schema.achievements,
            });
        }
    }

    // Fallback to GraphQL (needs auth) — try namespace first, then product_id
    let http = client();
    let token_result = epic_auth::get_valid_token().await;
    let auth_header = match token_result {
        Ok((token_type, access_token)) => Some(format!("{token_type} {access_token}")),
        Err(_) => None,
    };

    // Try namespace as sandboxId
    if !namespace_id.is_empty() {
        let schema = fetch_schema_graphql_with_auth(&http, &namespace_id, auth_header.as_deref()).await?;
        if !schema.achievements.is_empty() {
            return Ok(EpicAchievementSchema {
                product_id: product_id.clone(),
                sandbox_id: namespace_id.clone(),
                achievements: schema.achievements,
            });
        }
    }

    // Try product_id as sandboxId (if different from namespace)
    if product_id != namespace_id {
        let schema = fetch_schema_graphql_with_auth(&http, &product_id, auth_header.as_deref()).await?;
        if !schema.achievements.is_empty() {
            return Ok(EpicAchievementSchema {
                product_id: product_id.clone(),
                sandbox_id: product_id.clone(),
                achievements: schema.achievements,
            });
        }
    }

    Ok(EpicAchievementSchema {
        product_id,
        sandbox_id: namespace_id,
        achievements: Vec::new(),
    })
}

/// Fetch player achievement progress from Epic GraphQL API.
/// Requires a valid Epic auth token.
#[tauri::command]
pub async fn epic_fetch_player_achievements(
    product_id: String,
    epic_account_id: String,
) -> Result<Vec<EpicPlayerAchievement>, String> {
    let (token_type, access_token) = epic_auth::get_valid_token().await?;
    let http = client();

    let query = r#"query playerProfileAchievementsByProductId($EpicAccountId: String!, $ProductId: String!) {
  PlayerProfile {
    playerProfile(epicAccountId: $EpicAccountId) {
      epicAccountId
      displayName
      productAchievements(productId: $ProductId) {
        ... on PlayerProductAchievementsResponseSuccess {
          data {
            totalXP
            totalUnlocked
            playerAchievements {
              playerAchievement {
                achievementName
                unlocked
                unlockDate
                XP
              }
            }
          }
        }
      }
    }
  }
}"#;

    let variables = serde_json::json!({
        "EpicAccountId": epic_account_id,
        "ProductId": product_id,
    });

    let body = serde_json::json!({
        "query": query,
        "variables": variables,
    });

    let resp = http
        .post("https://launcher.store.epicgames.com/graphql")
        .header("Authorization", format!("{token_type} {access_token}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    // Log raw response for debugging (truncate to 2000 chars)
    let preview = if text.len() > 2000 { &text[..2000] } else { &text };
    eprintln!("[EPIC_ACH] GraphQL player progress response ({} chars): {}", text.len(), preview);

    if !status.is_success() {
        return Err(format!("Epic GraphQL error ({status}): {text}"));
    }

    let gql: GraphQLResponse =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse GraphQL response: {e}"))?;

    if let Some(errors) = gql.errors {
        if !errors.is_empty() {
            let msgs: Vec<&str> = errors.iter().filter_map(|e| e.message.as_deref()).collect();
            return Err(format!("GraphQL errors: {}", msgs.join(", ")));
        }
    }

    let profile = gql
        .data
        .and_then(|d| d.player_profile)
        .and_then(|w| w.inner)
        .ok_or("No player profile in response")?;

    // Try nested data first, then fall back to product_achievements directly
    let product_data = profile
        .product_achievements
        .as_ref()
        .and_then(|pa| {
            if let Some(data) = &pa.data {
                Some(data) // Standard path: productAchievements.data
            } else {
                None
            }
        });

    // If nested data is None, log what we got and return empty
    if product_data.is_none() {
        let pa_debug = profile.product_achievements.as_ref().map(|pa| {
            format!("productAchievements={{ data=None }}")
        }).unwrap_or_else(|| "productAchievements=None".to_string());
        eprintln!("[EPIC_ACH] player progress: {} — returning empty", pa_debug);
        return Ok(Vec::new());
    }

    let product = product_data.unwrap();
    let mut result = Vec::new();

    if let Some(achievements) = &product.player_achievements {
        for wrapper in achievements {
            if let Some(inner) = &wrapper.player_achievement {
                result.push(EpicPlayerAchievement {
                    achievement_name: inner.achievement_name.clone().unwrap_or_default(),
                    unlocked: inner.unlocked.unwrap_or(false),
                    unlock_date: inner.unlock_date.clone(),
                    xp: inner.xp,
                });
            }
        }
    }

    eprintln!("[EPIC_ACH] player progress: got {} achievements", result.len());
    Ok(result)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async fn fetch_schema_rest(product_id: &str) -> Result<EpicAchievementSchema, String> {
    let http = client();

    let url = format!(
        "https://api.epicgames.dev/epic/achievements/v1/public/achievements/product/{}/locale/en?includeAchievements=true",
        product_id
    );

    let resp = http
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    if !status.is_success() {
        return Ok(EpicAchievementSchema {
            product_id: product_id.to_string(),
            sandbox_id: String::new(),
            achievements: Vec::new(),
        });
    }

    let response: EpicAchievementsResponse =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse REST response: {e}"))?;

    let mut achievements = Vec::new();
    for wrapper in response.achievements {
        let elem = match wrapper.achievement {
            Some(e) => e,
            None => continue,
        };
        let api_name = elem.name.clone().or(elem.id).unwrap_or_default();
        if api_name.is_empty() {
            continue;
        }
        achievements.push(EpicAchievementEntry {
            api_name: api_name.clone(),
            display_name: elem.display_name.or_else(|| Some(elem.name.unwrap_or_else(|| api_name.clone()))).unwrap_or_default(),
            description: elem.description.or(elem.flavorText).unwrap_or_default(),
            icon_url: elem.unlocked_icon,
            icon_gray_url: elem.locked_icon,
            hidden: elem.hidden.unwrap_or(false),
            xp: elem.xp,
        });
    }

    Ok(EpicAchievementSchema {
        product_id: response.product_id.unwrap_or_else(|| product_id.to_string()),
        sandbox_id: response.sandbox_id.unwrap_or_default(),
        achievements,
    })
}

async fn fetch_schema_graphql_with_auth(
    http: &reqwest::Client,
    sandbox_id: &str,
    auth_header: Option<&str>,
) -> Result<EpicAchievementSchema, String> {
    let query = r#"query Achievement($SandboxId: String!, $Locale: String!) {
  Achievement {
    productAchievementsRecordBySandbox(
      sandboxId: $SandboxId,
      locale: $Locale
    ) {
      productId
      sandboxId
      totalAchievements
      totalProductXP
      achievements {
        achievement {
          name
          unlockedDisplayName
          unlockedDescription
          unlockedIconLink
          lockedIconLink
          XP
          hidden
          rarity {
            percent
          }
        }
      }
    }
  }
}"#;

    let variables = serde_json::json!({
        "SandboxId": sandbox_id,
        "Locale": "en-US",
    });

    let body = serde_json::json!({
        "query": query,
        "variables": variables,
    });

    let mut request = http
        .post("https://launcher.store.epicgames.com/graphql")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&body);

    if let Some(auth) = auth_header {
        request = request.header("Authorization", auth);
    }

    let resp = request
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    if !status.is_success() {
        return Ok(EpicAchievementSchema {
            product_id: String::new(),
            sandbox_id: sandbox_id.to_string(),
            achievements: Vec::new(),
        });
    }

    let gql: GraphQLResponse =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse GraphQL response: {e}"))?;

    if let Some(errors) = gql.errors {
        if !errors.is_empty() {
            return Ok(EpicAchievementSchema {
                product_id: String::new(),
                sandbox_id: sandbox_id.to_string(),
                achievements: Vec::new(),
            });
        }
    }

    let achievements_data = gql
        .data
        .and_then(|d| d.achievements)
        .and_then(|a| a.elements)
        .unwrap_or_default();

    let mut result = Vec::new();
    for wrapper_item in achievements_data {
        let elem = match wrapper_item.achievement {
            Some(e) => e,
            None => continue,
        };
        let api_name = elem.name.clone().or(elem.id).unwrap_or_default();
        if api_name.is_empty() {
            continue;
        }
        result.push(EpicAchievementEntry {
            api_name: api_name.clone(),
            display_name: elem.display_name.or_else(|| Some(elem.name.unwrap_or_else(|| api_name.clone()))).unwrap_or_default(),
            description: elem.description.or(elem.flavorText).unwrap_or_default(),
            icon_url: elem.unlocked_icon,
            icon_gray_url: elem.locked_icon,
            hidden: elem.hidden.unwrap_or(false),
            xp: elem.xp,
        });
    }

    Ok(EpicAchievementSchema {
        product_id: String::new(),
        sandbox_id: sandbox_id.to_string(),
        achievements: result,
    })
}
