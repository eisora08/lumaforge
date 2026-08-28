use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Url, WebviewUrl};
use tokio::sync::oneshot;

use super::hydra_source::{url_hash, PENDING_FETCHES};

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
    app_handle: AppHandle,
    query: String,
    source: String,
    page: Option<u32>,
    safe_search: Option<bool>,
    width: Option<u32>,
    height: Option<u32>,
    transparent: Option<bool>,
) -> Result<Vec<ImageResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let page_num = page.unwrap_or(0);
    let safe = safe_search.unwrap_or(false);
    let trans = transparent.unwrap_or(false);

    match source.as_str() {
        "google" => {
            search_google_via_webview(&app_handle, &query, page_num, safe, width, height, trans).await
        }
        "duckduckgo" => {
            let client = reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
                .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
                .connect_timeout(std::time::Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::limited(5))
                .build()
                .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

            let mut images = search_duckduckgo(&client, &query, page_num, trans).await?;

            // Post-filter by dimensions if both provided
            if let (Some(min_w), Some(min_h)) = (width, height) {
                images.retain(|img| {
                    // Keep images that match or are close to the target size (within 20% tolerance)
                    // or have unknown dimensions (width=0/height=0 from some sources)
                    if img.width == 0 || img.height == 0 {
                        return true;
                    }
                    let w_ratio = img.width as f64 / min_w as f64;
                    let h_ratio = img.height as f64 / min_h as f64;
                    (0.5..2.0).contains(&w_ratio) && (0.5..2.0).contains(&h_ratio)
                });
            }

            Ok(images)
        }
        _ => Err(format!("Unknown search source: {}", source)),
    }
}

// ─── Google Images via WebView (bypasses bot detection) ──────────────────────

async fn search_google_via_webview(
    app_handle: &AppHandle,
    query: &str,
    page: u32,
    safe_search: bool,
    width: Option<u32>,
    height: Option<u32>,
    transparent: bool,
) -> Result<Vec<ImageResult>, String> {
    // Build query with imagesize:WxH (Playnite's approach) instead of broken tbs
    let mut full_query = query.to_string();
    if let (Some(w), Some(h)) = (width, height) {
        if !full_query.contains("imagesize:") {
            full_query = format!("{} imagesize:{w}x{h}", full_query);
        }
    }

    let start = page * 20;
    let safe = if safe_search { "&safe=active" } else { "" };
    let tbs = if transparent { "&tbs=ic:trans" } else { "" };

    let url = format!(
        "https://www.google.com/search?tbm=isch&client=firefox-b-d&source=lnt&q={}&start={}{}{}",
        urlencoding::encode(&full_query),
        start,
        safe,
        tbs,
    );

    let html = fetch_html_via_webview(app_handle, &url, "google-image-search", 10).await?;

    let images = parse_google_html(&html);
    Ok(images)
}

/// Fetch HTML from a URL using a hidden WebView (same pattern as hydra_source fetcher).
/// The WebView executes JavaScript to bypass bot detection (Cloudflare, Google, etc.)
async fn fetch_html_via_webview(
    app_handle: &AppHandle,
    url: &str,
    label: &str,
    wait_secs: u64,
) -> Result<String, String> {
    let window = match app_handle.get_webview_window(label) {
        Some(w) => w,
        None => {
            tauri::WebviewWindowBuilder::new(
                app_handle,
                label,
                WebviewUrl::External(Url::parse("about:blank").unwrap()),
            )
            .title("Fetch")
            .inner_size(1.0, 1.0)
            .skip_taskbar(true)
            .visible(false)
            .build()
            .map_err(|e| format!("[GOOGLE_WV] create: {}", e))?
        }
    };

    let target = Url::parse(url).map_err(|e| format!("[GOOGLE_WV] invalid URL: {}", e))?;
    let about_blank = Url::parse("about:blank").unwrap();

    eprintln!("[GOOGLE_WV] navigating to {}", url);
    window
        .navigate(target.clone())
        .map_err(|e| format!("[GOOGLE_WV] navigate: {}", e))?;

    let max_attempts: u32 = 3;

    for attempt in 1..=max_attempts {
        // Wait for JS to execute and content to render
        let wait_ms = if attempt == 1 {
            wait_secs * 1000
        } else {
            3000
        };
        tokio::time::sleep(tokio::time::Duration::from_millis(wait_ms)).await;

        let callback_id = format!("gimg_{}_{}", url_hash(url), attempt);
        let (tx, mut rx) = oneshot::channel::<String>();

        {
            let mut map = PENDING_FETCHES
                .lock()
                .map_err(|e| format!("[GOOGLE_WV] lock: {}", e))?;
            map.insert(callback_id.clone(), tx);
        }

        // Step 1: Extract page content via innerHTML (captures rendered DOM including dynamic content)
        // Store in window.name which survives navigation
        let store_js = r#"(function(){try{var el=document.querySelector('#islmp')||document.querySelector('#islrg')||document.querySelector('.isltc')||document.querySelector('[data-ri]')||document.body;var t=el?el.innerHTML:'';if(t.length>100){window.name=t;}}catch(e){window.name='';}})();"#;
        let _ = window.eval(store_js);

        // Step 2: Navigate to about:blank where __TAURI_INTERNALS__ is available
        let _ = window.navigate(about_blank.clone());
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // Step 3: Read window.name and invoke callback
        let invoke_js = format!(
            r#"window.__TAURI_INTERNALS__.invoke('webview_fetch_callback',{{callbackId:'{}',content:window.name||''}});"#,
            callback_id
        );
        let _ = window.eval(&invoke_js);

        eprintln!(
            "[GOOGLE_WV] attempt={}/{} url={}",
            attempt,
            max_attempts,
            if url.len() > 80 { &url[..80] } else { url },
        );

        // Wait for callback with 5s timeout
        tokio::select! {
            result = &mut rx => {
                let _ = PENDING_FETCHES.lock().map(|mut m| m.remove(&callback_id));
                match result {
                    Ok(content) if !content.is_empty() && content.len() > 100 => {
                        eprintln!("[GOOGLE_WV] success attempt={} len={}", attempt, content.len());
                        return Ok(content);
                    }
                    Ok(c) => {
                        eprintln!("[GOOGLE_WV] short content attempt={} len={}", attempt, c.len());
                        let _ = window.navigate(target.clone());
                    }
                    Err(_) => {
                        eprintln!("[GOOGLE_WV] rx cancelled attempt={}", attempt);
                        let _ = window.navigate(target.clone());
                    }
                }
            }
            _ = tokio::time::sleep(tokio::time::Duration::from_secs(5)) => {
                let _ = PENDING_FETCHES.lock().map(|mut m| m.remove(&callback_id));
                eprintln!("[GOOGLE_WV] timeout attempt={}", attempt);
                let _ = window.navigate(target.clone());
            }
        }
    }

    Err("[GOOGLE_WV] timed out after all attempts".to_string())
}

fn parse_google_html(html: &str) -> Vec<ImageResult> {
    let mut images = Vec::new();

    // Strategy 1: Parse data-ou attributes (most reliable — Playnite's primary method)
    // Google puts full original URL in data-ou and thumbnail in data-tbnid
    if let Ok(attr_re) = Regex::new(r#"data-ou="(https?://[^"]+)""#) {
        for cap in attr_re.captures_iter(html) {
            let url = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            if is_valid_image_url(url)
                && !images.iter().any(|i: &ImageResult| i.url == url)
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

    // Strategy 2: Parse AF_initDataCallback script blocks
    // Modern Google embeds image data in script blocks like:
    // AF_initDataCallback({key: 'ds:1', ... data: [...]});
    if images.is_empty() {
        if let Ok(script_re) =
            Regex::new(r#"AF_initDataCallback\(\{[^}]*data:\s*\[([\s\S]*?)\]\s*\}\)"#)
        {
            // Match ["url", width, height, "thumb"] tuples
            if let Ok(tuple_re) = Regex::new(
                r#"\["(https?://[^"]{20,})",\s*(\d+),\s*(\d+)(?:,\s*"(https?://[^"]*)")?\]"#,
            ) {
                for cap in script_re.captures_iter(html) {
                    if let Some(data_block) = cap.get(1) {
                        let block_str = data_block.as_str();
                        for tc in tuple_re.captures_iter(block_str) {
                            let url = tc.get(1).map(|m| m.as_str()).unwrap_or("");
                            let width = tc
                                .get(2)
                                .and_then(|m| m.as_str().parse::<u32>().ok())
                                .unwrap_or(0);
                            let height = tc
                                .get(3)
                                .and_then(|m| m.as_str().parse::<u32>().ok())
                                .unwrap_or(0);
                            let thumb = tc.get(4).map(|m| m.as_str()).unwrap_or(url);

                            if is_valid_image_url(url)
                                && width > 50
                                && height > 50
                                && !images.iter().any(|img: &ImageResult| img.url == url)
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
    }

    // Strategy 3: Parse ["ou","tu",width,height] tuples (newer Google format)
    if images.is_empty() {
        if let Ok(ou_re) = Regex::new(
            r#"\["(https?://[^"]+)",\s*"(https?://[^"]+)",\s*(\d+),\s*(\d+)"#,
        ) {
            for cap in ou_re.captures_iter(html) {
                let url = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                let thumb = cap.get(2).map(|m| m.as_str()).unwrap_or("");
                let width = cap
                    .get(3)
                    .and_then(|m| m.as_str().parse::<u32>().ok())
                    .unwrap_or(0);
                let height = cap
                    .get(4)
                    .and_then(|m| m.as_str().parse::<u32>().ok())
                    .unwrap_or(0);

                if is_valid_image_url(url)
                    && width > 50
                    && height > 50
                    && !images.iter().any(|i: &ImageResult| i.url == url)
                {
                    images.push(ImageResult {
                        url: url.to_string(),
                        thumb: if thumb.is_empty() { url.to_string() } else { thumb.to_string() },
                        width,
                        height,
                    });
                }
            }
        }
    }

    // Strategy 4: Parse JSON arrays ["url",width,height] in script content
    if images.is_empty() {
        if let Ok(arr_re) = Regex::new(r#"\["(https?://[^"]{20,})",(\d+),(\d+)\]"#) {
            for cap in arr_re.captures_iter(html) {
                let url = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                let width = cap
                    .get(2)
                    .and_then(|m| m.as_str().parse::<u32>().ok())
                    .unwrap_or(0);
                let height = cap
                    .get(3)
                    .and_then(|m| m.as_str().parse::<u32>().ok())
                    .unwrap_or(0);

                if is_valid_image_url(url)
                    && width > 50
                    && height > 50
                    && !images.iter().any(|i: &ImageResult| i.url == url)
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

    // Strategy 5: Broadest regex — find any image URLs in the page
    if images.is_empty() {
        if let Ok(broad_re) = Regex::new(
            r#""(https?://[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"#,
        ) {
            for cap in broad_re.captures_iter(html) {
                let url = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                if is_valid_image_url(url) && !images.iter().any(|i: &ImageResult| i.url == url) {
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

fn is_valid_image_url(url: &str) -> bool {
    !url.is_empty()
        && !url.contains("gstatic.com")
        && !url.contains("google.com/images")
        && !url.contains("googleapis.com/css")
        && !url.ends_with(".css")
        && !url.ends_with(".js")
        && !url.ends_with(".svg")
        && (url.starts_with("http://") || url.starts_with("https://"))
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
    transparent: bool,
) -> Result<Vec<ImageResult>, String> {
    // Step 1: Load the DDG images page to get the vqd token
    let iaf = if transparent { "&iaf=type:transparent" } else { "" };
    let page_url = format!(
        "https://duckduckgo.com/?q={}&ia=images&iax=images{}",
        urlencoding::encode(query),
        iaf,
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
