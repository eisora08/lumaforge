use regex::Regex;
use serde::{Deserialize, Serialize};

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT_SECS: u64 = 15;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageResult {
    pub url: String,
    pub thumb: String,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub async fn search_web_images(
    query: String,
    source: String,
    page: Option<u32>,
) -> Result<Vec<ImageResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .connect_timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    match source.as_str() {
        "google" => search_google(&client, &query, page.unwrap_or(0)).await,
        "duckduckgo" => search_duckduckgo(&client, &query, page.unwrap_or(0)).await,
        _ => Err(format!("Unknown search source: {}", source)),
    }
}

// ─── Google Images (no API key — HTML scraping) ──────────────────────────────

async fn search_google(
    client: &reqwest::Client,
    query: &str,
    _page: u32,
) -> Result<Vec<ImageResult>, String> {
    let url = format!(
        "https://www.google.com/search?tbm=isch&q={}",
        urlencoding::encode(query)
    );

    let resp = client
        .get(&url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Cookie", "CONSENT=YES+; NID=511")
        .header("Sec-Fetch-Dest", "document")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", "none")
        .header("Sec-Fetch-User", "?1")
        .send()
        .await
        .map_err(|e| format!("Google request failed: {}", e))?;

    let html = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read Google response: {}", e))?;

    let images = parse_google_html(&html);
    Ok(images)
}

fn parse_google_html(html: &str) -> Vec<ImageResult> {
    let mut images = Vec::new();

    // Strategy 1: Parse AF_initDataCallback script blocks
    // Modern Google embeds image data in script blocks like:
    // AF_initDataCallback({key: 'ds:1', ... data: [...]});
    // The image entries contain ["full_url", width, height, "thumb_url"] arrays
    if let Ok(script_re) = Regex::new(r#"AF_initDataCallback\(\{[^}]*data:\s*\[(.+?)\]\s*\}\)"#) {
        let tuple_re_result = Regex::new(
            r#"\["(https?://[^"]{20,})",\s*(\d+),\s*(\d+)(?:,\s*"(https?://[^"]*)")?\]"#,
        );
        if let Ok(tuple_re) = tuple_re_result {
            for cap in script_re.captures_iter(html) {
                if let Some(data_block) = cap.get(1) {
                    let block_str = data_block.as_str();
                    for tc in tuple_re.captures_iter(block_str) {
                        let url = tc.get(1).map(|m| m.as_str()).unwrap_or("");
                        let width = tc.get(2).and_then(|m| m.as_str().parse::<u32>().ok()).unwrap_or(0);
                        let height = tc.get(3).and_then(|m| m.as_str().parse::<u32>().ok()).unwrap_or(0);
                        let thumb = tc.get(4).map(|m| m.as_str()).unwrap_or(url);

                        if !url.is_empty()
                            && width > 50 && height > 50
                            && !images.iter().any(|img: &ImageResult| img.url == url)
                            && !url.contains("gstatic.com/images")
                            && !url.contains("google.com/images")
                        {
                            images.push(ImageResult {
                                url: url.to_string(),
                                thumb: thumb.to_string(),
                                width,
                                height,
                            });
                        }
                    }
                }
            }
        }
    }

    // Strategy 2: Parse data-ou / data-tbn attributes from img/a tags
    // Google puts full URL in data-ou and thumbnail ID in data-tbnid
    if images.is_empty() {
        if let Ok(attr_re) = Regex::new(r#"data-ou="(https?://[^"]+)""#) {
            for cap in attr_re.captures_iter(html) {
                let url = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                if !url.is_empty()
                    && !images.iter().any(|i: &ImageResult| i.url == url)
                    && !url.contains("gstatic.com")
                    && !url.contains("google.com")
                {
                    images.push(ImageResult {
                        url: url.to_string(),
                        thumb: url.to_string(),
                        width: 0,
                        height: 0,
                    });
                }
            }
        }
    }

    // Strategy 3: Parse JSON arrays embedded in script content
    // Pattern: ["https://...",width,height] found in various script blocks
    if images.is_empty() {
        if let Ok(arr_re) = Regex::new(
            r#"\["(https?://[^"]{20,})",(\d+),(\d+)\]"#,
        ) {
            for cap in arr_re.captures_iter(html) {
                let url = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                let width = cap.get(2).and_then(|m| m.as_str().parse::<u32>().ok()).unwrap_or(0);
                let height = cap.get(3).and_then(|m| m.as_str().parse::<u32>().ok()).unwrap_or(0);

                if !url.is_empty()
                    && width > 50 && height > 50
                    && !images.iter().any(|i: &ImageResult| i.url == url)
                    && !url.contains("gstatic.com/images")
                    && !url.contains("google.com/images")
                    && !url.contains("googleapis.com/css")
                {
                    images.push(ImageResult {
                        url: url.to_string(),
                        thumb: url.to_string(),
                        width,
                        height,
                    });
                }
            }
        }
    }

    // Strategy 4: Broadest regex — find any image URLs in the page
    if images.is_empty() {
        if let Ok(broad_re) = Regex::new(
            r#""(https?://[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"#,
        ) {
            for cap in broad_re.captures_iter(html) {
                let url = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                if !url.is_empty()
                    && !images.iter().any(|i: &ImageResult| i.url == url)
                    && !url.contains("gstatic.com/images")
                    && !url.contains("google.com/images")
                    && !url.contains("googleapis.com/css")
                    && !url.ends_with(".css")
                    && !url.ends_with(".js")
                {
                    images.push(ImageResult {
                        url: url.to_string(),
                        thumb: url.to_string(),
                        width: 0,
                        height: 0,
                    });
                }
            }
        }
    }

    images
}

// ─── DuckDuckGo Images (JSON API — no key needed) ────────────────────────────

#[derive(Deserialize)]
struct DdgImageResults {
    results: Vec<DdgImageResult>,
}

#[derive(Deserialize)]
struct DdgImageResult {
    #[serde(default)]
    height: u64,
    #[serde(default)]
    width: u64,
    #[serde(default)]
    thumbnail: String,
    #[serde(default)]
    image: String,
}

async fn search_duckduckgo(
    client: &reqwest::Client,
    query: &str,
    page: u32,
) -> Result<Vec<ImageResult>, String> {
    // Step 1: Load the DDG images page to get the vqd token
    let page_url = format!(
        "https://duckduckgo.com/?q={}&ia=images&iax=images",
        urlencoding::encode(query)
    );

    let resp = client
        .get(&page_url)
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("DDG page request failed: {}", e))?;

    let html = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read DDG page: {}", e))?;

    // Extract vqd token from the page HTML
    let vqd = extract_vqd(&html)
        .ok_or_else(|| "Failed to extract vqd token from DuckDuckGo page".to_string())?;

    // Step 2: Fetch the image results JSON
    let api_url = format!(
        "https://duckduckgo.com/i.js?l=us-en&o=json&q={}&u=ddg&pa={}&vqd={}",
        urlencoding::encode(query),
        page,
        vqd
    );

    let api_resp = client
        .get(&api_url)
        .header("Accept", "application/json")
        .header("Referer", &page_url)
        .send()
        .await
        .map_err(|e| format!("DDG API request failed: {}", e))?;

    let body = api_resp
        .text()
        .await
        .map_err(|e| format!("Failed to read DDG API response: {}", e))?;

    let results: DdgImageResults =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse DDG JSON: {}", e))?;

    let images = results
        .results
        .into_iter()
        .map(|r| ImageResult {
            url: r.image,
            thumb: r.thumbnail,
            width: r.width as u32,
            height: r.height as u32,
        })
        .collect();

    Ok(images)
}

fn extract_vqd(html: &str) -> Option<String> {
    // Try vqd="..." pattern
    let re1 = Regex::new(r#"vqd="([^"]+)""#).ok()?;
    if let Some(cap) = re1.captures(html) {
        return cap.get(1).map(|m| m.as_str().to_string());
    }

    // Try vqd='...' pattern
    let re2 = Regex::new(r#"vqd='([^']+)'"#).ok()?;
    if let Some(cap) = re2.captures(html) {
        return cap.get(1).map(|m| m.as_str().to_string());
    }

    // Try vqd:{...} pattern (JSON-like)
    let re3 = Regex::new(r#""vqd"\s*:\s*"([^"]+)""#).ok()?;
    if let Some(cap) = re3.captures(html) {
        return cap.get(1).map(|m| m.as_str().to_string());
    }

    None
}
