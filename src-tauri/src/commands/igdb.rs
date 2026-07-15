use reqwest::header::{HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const IGDB_BASE_URL: &str = "https://api.igdb.com/v4";
const TWITCH_OAUTH_URL: &str = "https://id.twitch.tv/oauth2/token";

// ── Response types ──

#[derive(Debug, Serialize, Deserialize)]
pub struct IgdbAccessToken {
    pub access_token: String,
    pub expires_in: u64,
    pub token_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IgdbArtworkBySteamIdResult {
    pub cover_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IgdbGameBySteamId {
    cover: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct IgdbCover {
    url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IgdbGameSearchResult {
    pub igdb_id: Option<u64>,
    pub name: Option<String>,
    pub summary: Option<String>,
    pub release_date: Option<String>,
    pub genres: Option<Vec<String>>,
    pub developers: Option<Vec<String>>,
    pub publishers: Option<Vec<String>>,
    pub cover_url: Option<String>,
    pub screenshot_urls: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct IgdbGameRaw {
    id: Option<u64>,
    name: Option<String>,
    summary: Option<String>,
    first_release_date: Option<u64>,
    genres: Option<Vec<IgdbNamedRef>>,
    involved_companies: Option<Vec<IgdbInvolvedCompany>>,
    cover: Option<IgdbImageRef>,
    screenshots: Option<Vec<IgdbImageRef>>,
}

#[derive(Debug, Deserialize)]
struct IgdbNamedRef {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IgdbInvolvedCompany {
    company: Option<IgdbNamedRef>,
    publisher: Option<bool>,
    developer: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct IgdbImageRef {
    url: Option<String>,
}

// ── Helpers ──

fn simple_url_encode(s: &str) -> String {
    let mut encoded = String::with_capacity(s.len() * 3);
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                encoded.push('%');
                encoded.push_str(&format!("{:02X}", byte));
            }
        }
    }
    encoded
}

fn build_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("LumaForge/0.1.0")
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("[IGDB][CLIENT] Failed to build HTTP client: {}", e))
}

fn build_headers(client_id: &str, access_token: &str) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "Client-ID",
        HeaderValue::from_str(client_id)
            .map_err(|e| format!("[IGDB][HEADERS] Invalid Client-ID: {}", e))?,
    );
    headers.insert(
        "Authorization",
        HeaderValue::from_str(&format!("Bearer {}", access_token))
            .map_err(|e| format!("[IGDB][HEADERS] Invalid access token: {}", e))?,
    );
    headers.insert("Content-Type", HeaderValue::from_static("text/plain"));
    Ok(headers)
}

fn normalize_url(raw: &str) -> String {
    if raw.starts_with("//") {
        format!("https:{}", raw)
    } else {
        raw.to_string()
    }
}

fn normalize_url_cover(raw: &str) -> String {
    normalize_url(raw).replace("t_thumb", "t_cover_big")
}

fn normalize_url_screenshot(raw: &str) -> String {
    normalize_url(raw).replace("t_thumb", "t_screenshot_big")
}

fn timestamp_to_date(ts: u64) -> String {
    let total_days = (ts / 86400) as i64;
    let mut year = 1970i64;
    loop {
        let next = days_in_year_from_epoch(year + 1);
        if total_days < next {
            break;
        }
        year += 1;
        if year > 2100 { return "2100-01-01".to_string(); }
    }
    let year_start_days = days_in_year_from_epoch(year);
    let day_of_year = (total_days - year_start_days) as u32;
    let (month, day) = day_of_year_to_month_day(day_of_year, is_leap(year));
    format!("{:04}-{:02}-{:02}", year, month, day)
}

fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

fn days_in_year_from_epoch(year: i64) -> i64 {
    let mut total = 0i64;
    for y in 1970..year {
        total += if is_leap(y) { 366 } else { 365 };
    }
    total
}

fn day_of_year_to_month_day(day_of_year: u32, leap: bool) -> (u32, u32) {
    let month_days: &[(u32, u32)] = if leap {
        &[(1, 31), (2, 29), (3, 31), (4, 30), (5, 31), (6, 30),
          (7, 31), (8, 31), (9, 30), (10, 31), (11, 30), (12, 31)]
    } else {
        &[(1, 31), (2, 28), (3, 31), (4, 30), (5, 31), (6, 30),
          (7, 31), (8, 31), (9, 30), (10, 31), (11, 30), (12, 31)]
    };
    let mut remaining = day_of_year;
    for &(m, days) in month_days {
        if remaining < days {
            return (m, remaining + 1);
        }
        remaining -= days;
    }
    (12, 31)
}

// ── Commands ──

/// Get a Twitch/IGDB OAuth access token.
/// This is a standard client_credentials grant — no user context.
#[tauri::command]
pub fn igdb_get_access_token(
    client_id: String,
    client_secret: String,
) -> Result<IgdbAccessToken, String> {
    let client = build_client()?;

    let url = format!(
        "{}?client_id={}&client_secret={}&grant_type=client_credentials",
        TWITCH_OAUTH_URL,
        simple_url_encode(&client_id),
        simple_url_encode(&client_secret),
    );

    let response = client
        .post(&url)
        .send()
        .map_err(|e| format!("[IGDB][TOKEN] Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().unwrap_or_default();
        return Err(format!(
            "[IGDB][TOKEN] Authentication failed (HTTP {}): {}",
            status,
            truncate(&body, 200)
        ));
    }

    let token: IgdbAccessToken = response
        .json()
        .map_err(|e| format!("[IGDB][TOKEN] Failed to parse response: {}", e))?;

    Ok(token)
}

/// Search for a game by Steam application ID and return its IGDB cover URL.
/// Used by the artwork priority chain for Steam games.
#[tauri::command]
pub fn igdb_search_by_steam_app_id(
    client_id: String,
    access_token: String,
    app_id: String,
) -> Result<IgdbArtworkBySteamIdResult, String> {
    if client_id.is_empty() || access_token.is_empty() {
        return Err("[IGDB][ARTWORK] Missing credentials".to_string());
    }

    let client = build_client()?;
    let headers = build_headers(&client_id, &access_token)?;

    // Step 1: Find the IGDB game by steam_application_id
    let game_query = format!(
        "fields cover; where steam_application_id = {}; limit 1;",
        app_id
    );

    let game_res = client
        .post(format!("{}/games", IGDB_BASE_URL))
        .headers(headers.clone())
        .body(game_query)
        .send()
        .map_err(|e| format!("[IGDB][ARTWORK] Game search failed: {}", e))?;

    if !game_res.status().is_success() {
        let status = game_res.status().as_u16();
        let body = game_res.text().unwrap_or_default();
        return Err(format!(
            "[IGDB][ARTWORK] Game search HTTP {}: {}",
            status,
            truncate(&body, 200)
        ));
    }

    let games: Vec<IgdbGameBySteamId> = game_res
        .json()
        .map_err(|e| format!("[IGDB][ARTWORK] Failed to parse game response: {}", e))?;

    let cover_id = match games.first().and_then(|g| g.cover) {
        Some(id) => id,
        None => return Ok(IgdbArtworkBySteamIdResult { cover_url: None }),
    };

    // Step 2: Resolve cover ID to URL
    let cover_query = format!("fields url; where id = {}; limit 1;", cover_id);

    let cover_res = client
        .post(format!("{}/covers", IGDB_BASE_URL))
        .headers(headers)
        .body(cover_query)
        .send()
        .map_err(|e| format!("[IGDB][ARTWORK] Cover fetch failed: {}", e))?;

    if !cover_res.status().is_success() {
        return Ok(IgdbArtworkBySteamIdResult { cover_url: None });
    }

    let covers: Vec<IgdbCover> = cover_res
        .json()
        .map_err(|e| format!("[IGDB][ARTWORK] Failed to parse cover response: {}", e))?;

    let cover_url = covers
        .first()
        .and_then(|c| c.url.as_deref())
        .map(|url| normalize_url_cover(url));

    Ok(IgdbArtworkBySteamIdResult { cover_url })
}

/// Search IGDB by game name and return metadata + artwork URLs.
/// Used for manual/non-Steam games that don't have a Steam App ID.
#[tauri::command]
pub fn igdb_search_games_by_name(
    client_id: String,
    access_token: String,
    name: String,
    limit: Option<u32>,
) -> Result<Vec<IgdbGameSearchResult>, String> {
    if client_id.is_empty() || access_token.is_empty() {
        return Err("[IGDB][SEARCH] Missing credentials".to_string());
    }

    let query_limit = limit.unwrap_or(3).min(10);

    let client = build_client()?;
    let headers = build_headers(&client_id, &access_token)?;

    // Escape double quotes in the search name
    let safe_name = name.replace('"', "\\\"");

    let body = format!(
        "fields name, summary, first_release_date, genres.name, \
         involved_companies.company.name, involved_companies.publisher, involved_companies.developer, \
         cover.url, screenshots.url; \
         search \"{}\"; limit {};",
        safe_name, query_limit
    );

    let response = client
        .post(format!("{}/games", IGDB_BASE_URL))
        .headers(headers)
        .body(body)
        .send()
        .map_err(|e| format!("[IGDB][SEARCH] Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().unwrap_or_default();
        return Err(format!(
            "[IGDB][SEARCH] HTTP {} for \"{}\": {}",
            status,
            truncate(&safe_name, 50),
            truncate(&body, 200)
        ));
    }

    let games: Vec<IgdbGameRaw> = response
        .json()
        .map_err(|e| format!("[IGDB][SEARCH] Failed to parse response: {}", e))?;

    let results: Vec<IgdbGameSearchResult> = games
        .into_iter()
        .map(|g| {
            let developers: Option<Vec<String>> = g.involved_companies.as_ref().map(|ics| {
                ics.iter()
                    .filter_map(|ic| {
                        if ic.developer.unwrap_or(false) {
                            ic.company.as_ref().and_then(|c| c.name.clone())
                        } else {
                            None
                        }
                    })
                    .collect()
            });

            let publishers: Option<Vec<String>> = g.involved_companies.as_ref().map(|ics| {
                ics.iter()
                    .filter_map(|ic| {
                        if ic.publisher.unwrap_or(false) {
                            ic.company.as_ref().and_then(|c| c.name.clone())
                        } else {
                            None
                        }
                    })
                    .collect()
            });

            let genres: Option<Vec<String>> = g.genres.as_ref().map(|gs| {
                gs.iter()
                    .filter_map(|g| g.name.clone())
                    .collect()
            });

            let cover_url = g.cover.as_ref().and_then(|c| c.url.as_deref()).map(|url| {
                normalize_url_cover(url)
            });

            let screenshot_urls: Option<Vec<String>> = g.screenshots.as_ref().map(|ss| {
                ss.iter()
                    .filter_map(|s| s.url.as_deref().map(|url| normalize_url_screenshot(url)))
                    .collect()
            });

            let release_date = g.first_release_date.map(|ts| timestamp_to_date(ts));

            IgdbGameSearchResult {
                igdb_id: g.id,
                name: g.name,
                summary: g.summary,
                release_date,
                genres,
                developers,
                publishers,
                cover_url,
                screenshot_urls,
            }
        })
        .collect();

    Ok(results)
}

// ── IGDB Catalog Query ──

#[derive(Debug, Serialize, Deserialize)]
pub struct IgdbCatalogGame {
    pub igdb_id: u64,
    pub name: Option<String>,
    pub summary: Option<String>,
    pub first_release_date: Option<String>,
    pub genres: Option<Vec<String>>,
    pub rating: Option<f64>,
    pub popularity: Option<f64>,
    pub cover_url: Option<String>,
    pub screenshot_urls: Option<Vec<String>>,
    pub developers: Option<Vec<String>>,
    pub publishers: Option<Vec<String>>,
    pub steam_app_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IgdbCatalogRaw {
    id: Option<u64>,
    name: Option<String>,
    summary: Option<String>,
    first_release_date: Option<u64>,
    genres: Option<Vec<IgdbNamedRef>>,
    rating: Option<f64>,
    popularity: Option<f64>,
    cover: Option<IgdbImageRef>,
    screenshots: Option<Vec<IgdbImageRef>>,
    involved_companies: Option<Vec<IgdbInvolvedCompany>>,
    external_games: Option<Vec<IgdbExternalGame>>,
}

#[derive(Debug, Deserialize)]
struct IgdbExternalGame {
    category: Option<u64>,
    url: Option<String>,
    uid: Option<String>,
}

/// Query IGDB for catalog sections (popular games, new releases, genre-filtered).
/// `query` is an IGDB query string (e.g., "sort popularity desc; limit 20;").
#[tauri::command]
pub fn igdb_query_catalog(
    client_id: String,
    access_token: String,
    query: String,
) -> Result<Vec<IgdbCatalogGame>, String> {
    if client_id.is_empty() || access_token.is_empty() {
        return Err("[IGDB][CATALOG] Missing credentials".to_string());
    }

    let client = build_client()?;
    let headers = build_headers(&client_id, &access_token)?;

    let response = client
        .post(format!("{}/games", IGDB_BASE_URL))
        .headers(headers)
        .body(query)
        .send()
        .map_err(|e| format!("[IGDB][CATALOG] Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().unwrap_or_default();
        return Err(format!(
            "[IGDB][CATALOG] HTTP {}: {}",
            status,
            truncate(&body, 200)
        ));
    }

    let games: Vec<IgdbCatalogRaw> = response
        .json()
        .map_err(|e| format!("[IGDB][CATALOG] Failed to parse response: {}", e))?;

    let results: Vec<IgdbCatalogGame> = games
        .into_iter()
        .filter_map(|g| {
            let id = g.id?;
            let developers = g.involved_companies.as_ref().map(|ics| {
                ics.iter()
                    .filter_map(|ic| {
                        if ic.developer.unwrap_or(false) {
                            ic.company.as_ref().and_then(|c| c.name.clone())
                        } else {
                            None
                        }
                    })
                    .collect()
            });
            let publishers = g.involved_companies.as_ref().map(|ics| {
                ics.iter()
                    .filter_map(|ic| {
                        if ic.publisher.unwrap_or(false) {
                            ic.company.as_ref().and_then(|c| c.name.clone())
                        } else {
                            None
                        }
                    })
                    .collect()
            });
            let genres = g.genres.as_ref().map(|gs| {
                gs.iter()
                    .filter_map(|g| g.name.clone())
                    .collect()
            });
            let cover_url = g.cover.as_ref().and_then(|c| c.url.as_deref()).map(|url| {
                format!("https:{}", url)
            });
            let screenshot_urls = g.screenshots.as_ref().map(|ss| {
                ss.iter()
                    .filter_map(|s| s.url.as_deref().map(|url| format!("https:{}", url)))
                    .collect()
            });
            let release_date = g.first_release_date.map(|ts| timestamp_to_date(ts));

            // Extract Steam app ID from external_games (category 1 = Steam)
            let steam_app_id = g.external_games.as_ref().and_then(|egs| {
                egs.iter().find_map(|eg| {
                    let is_steam = eg.category == Some(1);
                    if !is_steam {
                        return None;
                    }
                    // Try uid first (clean numeric ID), fall back to URL parsing
                    if let Some(ref uid) = eg.uid {
                        if !uid.is_empty() {
                            return Some(uid.clone());
                        }
                    }
                    if let Some(ref url) = eg.url {
                        // Extract app ID from URL: https://store.steampowered.com/app/12345
                        if let Some(app_id) = url.rsplit('/').next() {
                            if !app_id.is_empty() && app_id.chars().all(|c| c.is_ascii_digit()) {
                                return Some(app_id.to_string());
                            }
                        }
                    }
                    None
                })
            });

            Some(IgdbCatalogGame {
                igdb_id: id,
                name: g.name,
                summary: g.summary,
                first_release_date: release_date,
                genres,
                rating: g.rating,
                popularity: g.popularity,
                cover_url,
                screenshot_urls,
                developers,
                publishers,
                steam_app_id,
            })
        })
        .collect();

    Ok(results)
}

fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}…", &s[..max_len])
    }
}
