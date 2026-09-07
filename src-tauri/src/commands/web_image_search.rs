use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex as StdMutex};
use std::time::Instant;

use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Url, WebviewUrl};

/// Cache key: query + page + transparent. Value: (timestamp, results).
type ImageCache = StdMutex<HashMap<String, (Instant, Vec<ImageResult>)>>;
static IMAGE_QUERY_CACHE: LazyLock<ImageCache> = LazyLock::new(|| StdMutex::new(HashMap::new()));
const IMAGE_CACHE_TTL_SECS: u64 = 60;

/// Serializes all WebView-based fetches to prevent concurrent window manipulation.
static WEBVIEW_IMAGE_FETCH_MUTEX: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

/// Serializes DDG search: cache check + fetch + cache store all under one lock.
static DDG_SEARCH_MUTEX: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

/// Decode JSON string escapes: \uXXXX → char, \n → newline, \" → ", \\ → \
fn decode_json_escapes(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let chars: Vec<char> = s.chars().collect();
    let len = chars.len();
    let mut i = 0;
    while i < len {
        if chars[i] == '\\' && i + 1 < len {
            match chars[i + 1] {
                'n' => { out.push('\n'); i += 2; }
                'r' => { out.push('\r'); i += 2; }
                't' => { out.push('\t'); i += 2; }
                '"' => { out.push('"'); i += 2; }
                '\\' => { out.push('\\'); i += 2; }
                'u' if i + 5 < len => {
                    let hex: String = chars[i + 2..=i + 5].iter().collect();
                    if let Ok(cp) = u32::from_str_radix(&hex, 16) {
                        if let Some(c) = char::from_u32(cp) {
                            out.push(c);
                        }
                        i += 6;
                    } else {
                        out.push(chars[i]);
                        i += 1;
                    }
                }
                _ => { out.push(chars[i]); i += 1; }
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

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
            // WebView-based: navigate to DDG images, let it render, extract from DOM
            let images = search_duckduckgo_via_webview(&app_handle, &query, page_num, trans).await;

            let mut images = images?;

            // Post-filter by dimensions if both provided
            if let (Some(min_w), Some(min_h)) = (width, height) {
                images.retain(|img| {
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

// ─── DuckDuckGo Images via WebView + i.js JSON API ─────────────────────────
//
// Old approach: reqwest called i.js directly → DDG returns 403 to raw HTTP.
// New approach: Navigate hidden WebView to DDG (establishes session + cookies),
//               extract VQD from rendered page via eval, then call fetch('/i.js')
//               from within the page context. Returns JSON with real width/height.

async fn search_duckduckgo_via_webview(
    app_handle: &AppHandle,
    query: &str,
    page: u32,
    transparent: bool,
) -> Result<Vec<ImageResult>, String> {
    let _lock = DDG_SEARCH_MUTEX.lock().await;

    let iaf = if transparent { "&iaf=type:transparent" } else { "" };
    let ddg_url = format!(
        "https://duckduckgo.com/?q={}&ia=images&iax=images{}",
        urlencoding::encode(query),
        iaf,
    );

    // Cache check
    let cache_key = format!("ddg:{}:{}:{}", query, page, transparent);
    {
        let cache = IMAGE_QUERY_CACHE.lock().unwrap();
        if let Some((ts, cached)) = cache.get(&cache_key) {
            if ts.elapsed().as_secs() < IMAGE_CACHE_TTL_SECS && !cached.is_empty() {
                eprintln!("[DDG] cache hit '{}' ({} images)", query, cached.len());
                return Ok(cached.clone());
            }
        }
    }

    // Step 1: Navigate WebView to DDG to establish session + cookies
    let json_str = fetch_ddg_ivals_via_webview(app_handle, &ddg_url, query, page).await?;

    // Step 2: Parse the i.js JSON response
    let images = parse_ddg_json(&json_str);
    eprintln!(
        "[DDG] i.js parse: {} images from {} bytes JSON",
        images.len(),
        json_str.len()
    );

    if images.is_empty() {
        // Fallback: try parsing HTML in case i.js returned empty/malformed
        eprintln!("[DDG] i.js returned no images, falling back to HTML parse");
        let html = fetch_html_via_webview(app_handle, &ddg_url, "ddg-image-search", 5).await?;
        let images = parse_ddg_html(&html);
        if images.is_empty() {
            return Err("[DDG] No images found".to_string());
        }
        let mut cache = IMAGE_QUERY_CACHE.lock().unwrap();
        cache.insert(cache_key, (Instant::now(), images.clone()));
        return Ok(images);
    }

    // Store in cache
    {
        let mut cache = IMAGE_QUERY_CACHE.lock().unwrap();
        cache.insert(cache_key, (Instant::now(), images.clone()));
    }

    Ok(images)
}

/// Navigate to DDG images page, extract VQD from rendered JS, then call
/// `fetch('/i.js?vqd=...')` from within the page context. Returns the raw
/// JSON string from DDG's i.js API (which includes real width/height per image).
async fn fetch_ddg_ivals_via_webview(
    app_handle: &AppHandle,
    ddg_url: &str,
    query: &str,
    page: u32,
) -> Result<String, String> {
    let _lock = WEBVIEW_IMAGE_FETCH_MUTEX.lock().await;

    let label = "ddg-image-search";
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
            .map_err(|e| format!("[DDG_WV] create: {}", e))?
        }
    };

    let target = Url::parse(ddg_url).map_err(|e| format!("[DDG_WV] invalid URL: {}", e))?;

    eprintln!("[DDG_WV] navigating to {}", ddg_url);
    window
        .navigate(target.clone())
        .map_err(|e| format!("[DDG_WV] navigate: {}", e))?;

    // Synchronous JS: extract VQD from page scripts, then sync XHR to i.js.
    // eval_with_callback does NOT await Promises — it returns {} for async functions.
    // Must use synchronous XHR so the result is the actual response text.
    let escaped_query = query.replace('\\', "\\\\").replace('\'', "\\'");
    let ijs_js = format!(
        r#"(function(){{
            try {{
                // 1. Extract VQD from page HTML (inline scripts contain vqd= in DDG.deep.initialize URL)
                var vqd = '';
                var html = document.documentElement.outerHTML || '';
                var m = html.match(/vqd=([0-9][0-9\-]+[0-9])/);
                if (m) vqd = m[1];

                if (!vqd) return JSON.stringify({{results:[]}});

                // 2. Synchronous XHR to i.js (same origin — cookies/session included)
                var url = '/i.js?vqd=' + vqd + '&l=us-en&o=json&q=' + encodeURIComponent('{escaped_query}') + '&u=ddg&pa={page}';
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, false);
                xhr.send();
                if (xhr.status === 200 && xhr.responseText.length > 10) {{
                    return xhr.responseText;
                }}
                return JSON.stringify({{results:[], error:'i.js status=' + xhr.status + ' len=' + xhr.responseText.length}});
            }} catch(e) {{
                return JSON.stringify({{results:[], error: e.toString()}});
            }}
        }})()"#,
    );

    let max_attempts: u32 = 3;

    for attempt in 1..=max_attempts {
        let wait_ms = if attempt == 1 { 8000 } else { 4000 };
        tokio::time::sleep(tokio::time::Duration::from_millis(wait_ms)).await;

        let (tx, rx) = tokio::sync::oneshot::channel::<String>();
        let tx = Arc::new(StdMutex::new(Some(tx)));

        let tx_clone = tx.clone();
        window
            .eval_with_callback(&ijs_js, move |result| {
                let content = if result.starts_with('"') && result.ends_with('"') && result.len() >= 2 {
                    let inner = &result[1..result.len() - 1];
                    decode_json_escapes(inner)
                } else {
                    result.clone()
                };
                eprintln!(
                    "[DDG_WV] eval attempt={} raw_len={} clean_len={}",
                    attempt,
                    result.len(),
                    content.len()
                );
                if let Some(sender) = tx_clone.lock().unwrap().take() {
                    let _ = sender.send(content);
                }
            })
            .map_err(|e| format!("[DDG_WV] eval_with_callback: {}", e))?;

        eprintln!(
            "[DDG_WV] attempt={}/{} url={}",
            attempt,
            max_attempts,
            if ddg_url.len() > 80 { &ddg_url[..80] } else { ddg_url },
        );

        match tokio::time::timeout(tokio::time::Duration::from_secs(15), rx).await {
            Ok(Ok(content)) if content.contains("\"results\"") && !content.contains("\"results\":[]") => {
                eprintln!(
                    "[DDG_WV] success attempt={} len={}",
                    attempt,
                    content.len()
                );
                return Ok(content);
            }
            Ok(Ok(c)) => {
                eprintln!("[DDG_WV] empty/error results attempt={} preview={}", attempt, &c[..c.len().min(200)]);
                // Re-navigate and retry
                let _ = window.navigate(target.clone());
            }
            Ok(Err(_)) => {
                eprintln!("[DDG_WV] rx cancelled attempt={}", attempt);
                let _ = window.navigate(target.clone());
            }
            Err(_) => {
                eprintln!("[DDG_WV] timeout attempt={}", attempt);
                let _ = window.navigate(target.clone());
            }
        }
    }

    Err("[DDG_WV] timed out fetching i.js after all attempts".to_string())
}

/// Fetch HTML from a URL using a hidden WebView.
/// Uses `eval_with_callback` to extract the rendered DOM directly — no about:blank
/// bounce, no `__TAURI_INTERNALS__`. Works on any origin.
///
/// **Serialized** — only one fetch runs at a time to prevent concurrent manipulation
/// of the shared hidden WebView window.
async fn fetch_html_via_webview(
    app_handle: &AppHandle,
    url: &str,
    label: &str,
    wait_secs: u64,
) -> Result<String, String> {
    let _lock = WEBVIEW_IMAGE_FETCH_MUTEX.lock().await;

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

    eprintln!("[GOOGLE_WV] navigating to {}", url);
    window
        .navigate(target.clone())
        .map_err(|e| format!("[GOOGLE_WV] navigate: {}", e))?;

    // JS that extracts the rendered image container's innerHTML.
    // Tries Google-specific selectors, then DDG-specific, then body fallback.
    let extract_js = r#"(function(){
        try{
            var el=
                document.querySelector('#islmp')||
                document.querySelector('#islrg')||
                document.querySelector('.isltc')||
                document.querySelector('[data-ri]')||
                document.querySelector('[data-testid="image-result"]')||
                document.querySelector('.tile--img')||
                document.querySelector('#links')||
                document.body;
            return el?el.innerHTML:'';
        }catch(e){return '';}
    })();"#;

    let max_attempts: u32 = 3;

    for attempt in 1..=max_attempts {
        let wait_ms = if attempt == 1 { wait_secs * 1000 } else { 3000 };
        tokio::time::sleep(tokio::time::Duration::from_millis(wait_ms)).await;

        let (tx, rx) = tokio::sync::oneshot::channel::<String>();
        let tx = Arc::new(StdMutex::new(Some(tx)));

        let tx_clone = tx.clone();
        window
            .eval_with_callback(extract_js, move |result| {
                // eval_with_callback returns JSON-encoded string (wrapped in quotes).
                // Decode JSON escapes: unicode \uXXXX, \n, \", \\
                let content = if result.starts_with('"') && result.ends_with('"') && result.len() >= 2 {
                    let inner = &result[1..result.len() - 1];
                    decode_json_escapes(inner)
                } else {
                    result.clone()
                };
                eprintln!(
                    "[GOOGLE_WV] eval attempt={} raw_len={} clean_len={}",
                    attempt,
                    result.len(),
                    content.len()
                );
                if let Some(sender) = tx_clone.lock().unwrap().take() {
                    let _ = sender.send(content);
                }
            })
            .map_err(|e| format!("[GOOGLE_WV] eval_with_callback: {}", e))?;

        eprintln!(
            "[GOOGLE_WV] attempt={}/{} url={}",
            attempt,
            max_attempts,
            if url.len() > 80 { &url[..80] } else { url },
        );

        // Wait for the eval callback with a timeout
        match tokio::time::timeout(tokio::time::Duration::from_secs(10), rx).await {
            Ok(Ok(content)) if !content.is_empty() && content.len() > 100 => {
                eprintln!(
                    "[GOOGLE_WV] success attempt={} len={}",
                    attempt,
                    content.len()
                );
                return Ok(content);
            }
            Ok(Ok(c)) => {
                eprintln!(
                    "[GOOGLE_WV] short content attempt={} len={}",
                    attempt,
                    c.len()
                );
                let _ = window.navigate(target.clone());
            }
            Ok(Err(_)) => {
                eprintln!("[GOOGLE_WV] rx cancelled attempt={}", attempt);
                let _ = window.navigate(target.clone());
            }
            Err(_) => {
                eprintln!("[GOOGLE_WV] timeout attempt={}", attempt);
                let _ = window.navigate(target.clone());
            }
        }
    }

    Err("[GOOGLE_WV] timed out after all attempts".to_string())
}

fn parse_google_html(html: &str) -> Vec<ImageResult> {
    let mut images = Vec::new();

    // ── Step 1: Extract URLs from data-ou attributes (most reliable) ──
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

    // ── Step 2: Build dimension map from script blocks (Strategies 2-4) ──
    // These scripts contain ["url", width, height, "thumb"] tuples with real dimensions.
    // We extract them into a HashMap so we can merge with Step 1's URLs.
    let mut dim_map: HashMap<String, (u32, u32, String)> = HashMap::new();

    // Strategy 2: AF_initDataCallback blocks
    if let Ok(script_re) =
        Regex::new(r#"AF_initDataCallback\(\{[^}]*data:\s*\[([\s\S]*?)\]\s*\}\)"#)
    {
        if let Ok(tuple_re) = Regex::new(
            r#"\["(https?://[^"]{20,})",\s*(\d+),\s*(\d+)(?:,\s*"(https?://[^"]*)")?\]"#,
        ) {
            for cap in script_re.captures_iter(html) {
                if let Some(data_block) = cap.get(1) {
                    for tc in tuple_re.captures_iter(data_block.as_str()) {
                        let url = tc.get(1).map(|m| m.as_str()).unwrap_or("");
                        let w = tc.get(2).and_then(|m| m.as_str().parse::<u32>().ok()).unwrap_or(0);
                        let h = tc.get(3).and_then(|m| m.as_str().parse::<u32>().ok()).unwrap_or(0);
                        let thumb = tc.get(4).map(|m| m.as_str()).unwrap_or("").to_string();
                        if is_valid_image_url(url) && w > 50 && h > 50 {
                            dim_map.entry(url.to_string()).or_insert_with(|| (w, h, thumb));
                        }
                    }
                }
            }
        }
    }

    // Strategy 3: ["ou","tu",width,height] tuples
    if dim_map.is_empty() {
        if let Ok(ou_re) = Regex::new(
            r#"\["(https?://[^"]+)",\s*"(https?://[^"]+)",\s*(\d+),\s*(\d+)"#,
        ) {
            for cap in ou_re.captures_iter(html) {
                let url = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                let thumb = cap.get(2).map(|m| m.as_str()).unwrap_or("").to_string();
                let w = cap.get(3).and_then(|m| m.as_str().parse::<u32>().ok()).unwrap_or(0);
                let h = cap.get(4).and_then(|m| m.as_str().parse::<u32>().ok()).unwrap_or(0);
                if is_valid_image_url(url) && w > 50 && h > 50 {
                    dim_map.entry(url.to_string()).or_insert_with(|| (w, h, thumb));
                }
            }
        }
    }

    // Strategy 4: ["url",width,height] arrays
    if dim_map.is_empty() {
        if let Ok(arr_re) = Regex::new(r#"\["(https?://[^"]{20,})",(\d+),(\d+)\]"#) {
            for cap in arr_re.captures_iter(html) {
                let url = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                let w = cap.get(2).and_then(|m| m.as_str().parse::<u32>().ok()).unwrap_or(0);
                let h = cap.get(3).and_then(|m| m.as_str().parse::<u32>().ok()).unwrap_or(0);
                if is_valid_image_url(url) && w > 50 && h > 50 {
                    dim_map.entry(url.to_string()).or_insert_with(|| (w, h, url.to_string()));
                }
            }
        }
    }

    // ── Step 3: Merge — enrich Step 1 URLs with Step 2 dimensions ──
    if !images.is_empty() && !dim_map.is_empty() {
        for img in &mut images {
            if let Some(&(w, h, ref thumb)) = dim_map.get(&img.url) {
                img.width = w;
                img.height = h;
                if !thumb.is_empty() {
                    img.thumb = thumb.clone();
                }
            }
        }
    }

    // ── Step 4: If Step 1 found nothing, use dimension-map entries as results ──
    if images.is_empty() {
        for (url, (w, h, thumb)) in dim_map {
            images.push(ImageResult {
                url: url.clone(),
                thumb: if thumb.is_empty() { url } else { thumb },
                width: w,
                height: h,
            });
        }
    }

    // ── Step 5: Broadest regex fallback ──
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

#[derive(Deserialize)]
struct DdgImageResults {
    results: Vec<DdgImageResult>,
}

#[derive(Deserialize)]
struct DdgImageResult {
    #[serde(default)]
    image: String,
    #[serde(default)]
    thumbnail: String,
    #[serde(default)]
    width: u64,
    #[serde(default)]
    height: u64,
}

fn parse_ddg_json(json_str: &str) -> Vec<ImageResult> {
    // DDG i.js returns: {results: [{image, thumbnail, width, height, ...}, ...]}
    // But eval_with_callback wraps the response in extra JSON encoding, so the
    // actual string we receive may be double-encoded. Handle both cases.
    let mut images = Vec::new();

    // Try direct parse first
    if let Ok(results) = serde_json::from_str::<DdgImageResults>(json_str) {
        for r in results.results {
            if !r.image.is_empty() && r.width > 0 && r.height > 0 {
                let thumb = if r.thumbnail.is_empty() { r.image.clone() } else { r.thumbnail };
                images.push(ImageResult {
                    url: r.image,
                    thumb,
                    width: r.width as u32,
                    height: r.height as u32,
                });
            }
        }
        if !images.is_empty() {
            return images;
        }
    }

    // Fallback: regex extract ["image":"URL","thumbnail":"URL","width":W,"height":H] tuples
    if let Ok(tuple_re) = Regex::new(
        r#""image"\s*:\s*"(https?://[^"]+)".*?"thumbnail"\s*:\s*"(https?://[^"]+)".*?"width"\s*:\s*(\d+).*?"height"\s*:\s*(\d+)"#,
    ) {
        for cap in tuple_re.captures_iter(json_str) {
            let url = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let thumb = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            let width = cap.get(3).and_then(|m| m.as_str().parse::<u32>().ok()).unwrap_or(0);
            let height = cap.get(4).and_then(|m| m.as_str().parse::<u32>().ok()).unwrap_or(0);

            if !url.is_empty() && width > 0 && height > 0
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

    images
}

fn parse_ddg_html(html: &str) -> Vec<ImageResult> {
    let mut images = Vec::new();

    // Strategy 1: DDG's primary image pattern — <img> tags proxied through DDG.
    // Actual HTML: <img src="//external-content.duckduckgo.com/iu/?u=https%3A%2F%2Ftse3.mm.bing.net%2Fth%2Fid%2FOIP...&amp;..." alt="..." ...>
    // The u= parameter contains the URL-encoded Bing image URL.
    if let Ok(img_re) = Regex::new(
        r#"<img[^>]+src="(//external-content\.duckduckgo\.com/iu/\?u=([^"&]+))"[^>]*(?:alt="([^"]*)")?"#,
    ) {
        for cap in img_re.captures_iter(html) {
            let encoded_url = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            let thumb_src = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            if encoded_url.is_empty() {
                continue;
            }
            // Decode the u= parameter to get the real Bing URL
            let decoded_url = urlencoding::decode(encoded_url)
                .unwrap_or_default()
                .to_string();
            let thumb = if thumb_src.starts_with("//") {
                format!("https:{}", thumb_src)
            } else {
                thumb_src.to_string()
            };
            if !decoded_url.is_empty()
                && decoded_url.starts_with("http")
                && !images.iter().any(|i: &ImageResult| i.url == decoded_url)
            {
                images.push(ImageResult {
                    url: decoded_url,
                    thumb,
                    width: 0,
                    height: 0,
                });
            }
        }
    }

    // Strategy 2: Direct Bing CDN images (no DDG proxy — might appear in some layouts)
    if images.is_empty() {
        if let Ok(img_re) = Regex::new(
            r#"<img[^>]+src="(https?://tse\d*\.mm\.bing\.net/th\?[^"]+)"[^>]*>"#,
        ) {
            for cap in img_re.captures_iter(html) {
                let thumb = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                if !thumb.is_empty() && !images.iter().any(|i: &ImageResult| i.thumb == thumb) {
                    let full_url = thumb
                        .replace("=&w=128", "")
                        .replace("&w=128", "")
                        .replace("=&h=128", "")
                        .replace("&h=128", "");
                    images.push(ImageResult {
                        url: if full_url != thumb { full_url } else { thumb.to_string() },
                        thumb: thumb.to_string(),
                        width: 0,
                        height: 0,
                    });
                }
            }
        }
    }

    // Strategy 3: Any external-content.duckduckgo.com images (catches different URL formats)
    if images.is_empty() {
        if let Ok(proxy_re) = Regex::new(
            r#"(//external-content\.duckduckgo\.com/iu/\?u=[^"&\s]+)"#,
        ) {
            for cap in proxy_re.captures_iter(html) {
                let raw = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                let decoded = urlencoding::decode(
                    raw.trim_start_matches("//external-content.duckduckgo.com/iu/?u="),
                )
                .unwrap_or_default()
                .to_string();
                let thumb = format!("https:{}", raw);
                if decoded.starts_with("http")
                    && !images.iter().any(|i: &ImageResult| i.url == decoded)
                {
                    images.push(ImageResult {
                        url: decoded,
                        thumb,
                        width: 0,
                        height: 0,
                    });
                }
            }
        }
    }

    // Strategy 4: data-src with DDG proxy URLs
    if images.is_empty() {
        if let Ok(lazy_re) = Regex::new(
            r#"data-src="(//external-content\.duckduckgo\.com/iu/\?u=[^"]+)"#,
        ) {
            for cap in lazy_re.captures_iter(html) {
                let raw = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                let decoded = urlencoding::decode(
                    raw.trim_start_matches("//external-content.duckduckgo.com/iu/?u="),
                )
                .unwrap_or_default()
                .to_string();
                let thumb = format!("https:{}", raw);
                if decoded.starts_with("http")
                    && !images.iter().any(|i: &ImageResult| i.url == decoded)
                {
                    images.push(ImageResult {
                        url: decoded,
                        thumb,
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
