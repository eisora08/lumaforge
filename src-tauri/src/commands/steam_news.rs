use std::time::Duration;

use serde::Serialize;

#[derive(Serialize)]
pub struct RawSteamNewsItem {
    pub gid: String,
    pub title: String,
    pub url: String,
    pub is_external_url: bool,
    pub author: String,
    pub contents: String,
    pub feedlabel: String,
    pub date: u64,
    pub feedname: String,
    pub feed_type: i64,
    pub appid: u32,
}

#[tauri::command]
pub async fn fetch_steam_news(
    app_id: u32,
    count: Option<u32>,
    maxlength: Option<u32>,
) -> Result<Vec<RawSteamNewsItem>, String> {
    let count = count.unwrap_or(10).min(50);
    let maxlength = maxlength.unwrap_or(800).min(5000);

    let url = format!(
        "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid={}&count={}&maxlength={}&format=json",
        app_id, count, maxlength
    );

    let client = reqwest::Client::builder()
        .user_agent("LumaForge/0.1.0")
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Steam news request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Steam news API returned HTTP {}", response.status()));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Steam news response: {}", e))?;

    let newsitems = json
        .get("appnews")
        .and_then(|appnews| appnews.get("newsitems"))
        .and_then(|items| items.as_array())
        .ok_or_else(|| "Steam news response missing appnews.newsitems".to_string())?;

    let mut output = Vec::with_capacity(newsitems.len());

    for item in newsitems {
        let gid = item
            .get("gid")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let title = item
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let url = item
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let is_external_url = item
            .get("is_external_url")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let author = item
            .get("author")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let contents = item
            .get("contents")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let feedlabel = item
            .get("feedlabel")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let date = item
            .get("date")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let feedname = item
            .get("feedname")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let feed_type = item
            .get("feed_type")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        let appid = item
            .get("appid")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;

        output.push(RawSteamNewsItem {
            gid,
            title,
            url,
            is_external_url,
            author,
            contents,
            feedlabel,
            date,
            feedname,
            feed_type,
            appid,
        });
    }

    Ok(output)
}
