use anyhow::{Context, Result as AnyResult};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};
use tauri::{Emitter, Manager};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ONLINE_FIX_URL: &str = "https://api.perondepot.xyz/all/";
const ONLINE_FIX_RAR_PASSWORD: &str = "online-fix.me";
const ONLINE_FIX_ME_BASE: &str = "https://online-fix.me";
const ONLINE_FIX_ME_SEARCH_URL: &str =
    "https://online-fix.me/index.php?do=search&subaction=search&story=";
const ONLINE_FIX_CACHE_TTL_SECS: u64 = 86400;
const ONLINE_FIX_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const SMOKE_API_OWNER: &str = "acidicoala";
const SMOKE_API_REPO: &str = "SmokeAPI";
const STEAMLESS_OWNER: &str = "atom0s";
const STEAMLESS_REPO: &str = "Steamless";
const KOALOADER_OWNER: &str = "acidicoala";
const KOALOADER_REPO: &str = "Koaloader";
const PROXY_DLL_CANDIDATES: &[&str] = &["version.dll", "winhttp.dll", "winmm.dll"];
const GITHUB_API_BASE: &str = "https://api.github.com";
const CONNECT_TIMEOUT_SECS: u64 = 30;
const DOWNLOAD_TIMEOUT_SECS: u64 = 300;
const RELEASE_CACHE_TTL_SECS: u64 = 86400;
const MAX_MANUAL_FILES: usize = 10;
const APP_USER_AGENT: &str = concat!(
    env!("CARGO_PKG_NAME"),
    "/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/user/luma-lite)"
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameFixInfo {
    pub app_id: u64,
    pub name: String,
    pub installed: bool,
    pub install_path: Option<String>,
    pub has_lua: bool,
    pub lua_count: u32,
    pub last_revision: Option<String>,
    pub has_online_fix: bool,
    pub has_steam_api_64: bool,
    pub has_steam_api_32: bool,
    pub game_arch: Option<String>,
    pub main_exe: Option<String>,
    /// SteamStub DRM present on the main executable (Steamless applicability).
    pub has_steam_stub_drm: bool,
    /// Full path of the resolved main executable (what Steamless would target).
    pub exe_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameFixResult {
    pub ok: bool,
    pub tool: String,
    pub message: String,
    pub files_installed: Vec<String>,
    pub errors: Vec<String>,
    pub requires_manual_selection: bool,
    pub available_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameFixEntry {
    pub app_id: u64,
    pub install_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixInstallationStatus {
    pub smoke_api_installed: bool,
    pub steamless_installed: bool,
    pub koaloader_installed: bool,
    pub goldberg_installed: bool,
    pub smoke_api_path: Option<String>,
    pub steamless_path: Option<String>,
    pub koaloader_path: Option<String>,
    pub goldberg_path: Option<String>,
}

#[derive(Debug, Clone)]
struct FileEntry {
    url: String,
    display_name: String,
}

#[derive(Debug, Clone)]
struct ReleaseInfo {
    zip_url: String,
    zip_name: String,
}

struct CachedRelease {
    info: ReleaseInfo,
    cached_at: SystemTime,
}

struct ReleaseCache {
    entries: HashMap<String, CachedRelease>,
}

// ---------------------------------------------------------------------------
// Global cache
// ---------------------------------------------------------------------------

static GITHUB_CACHE: OnceLock<Mutex<ReleaseCache>> = OnceLock::new();

struct CachedOnlineFixDirectory {
    entries: Vec<FileEntry>,
    cached_at: SystemTime,
}

static ONLINE_FIX_DIR_CACHE: OnceLock<Mutex<CachedOnlineFixDirectory>> = OnceLock::new();

fn online_fix_dir_cache() -> &'static Mutex<CachedOnlineFixDirectory> {
    ONLINE_FIX_DIR_CACHE.get_or_init(|| {
        Mutex::new(CachedOnlineFixDirectory {
            entries: Vec::new(),
            cached_at: SystemTime::UNIX_EPOCH,
        })
    })
}

fn github_cache() -> &'static Mutex<ReleaseCache> {
    GITHUB_CACHE.get_or_init(|| {
        Mutex::new(ReleaseCache {
            entries: HashMap::new(),
        })
    })
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

fn app_data_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .unwrap_or_default()
}

fn temp_fix_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    let dir = app_data_dir(app_handle).join("temp").join("game_fixes");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn smoke_api_plugins_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app_handle).join("thirdparty").join("smokeapi")
}

fn steamless_plugins_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app_handle).join("thirdparty").join("steamless")
}

fn koaloader_plugins_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app_handle).join("thirdparty").join("koaloader")
}

fn goldberg_plugins_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app_handle).join("thirdparty").join("goldberg_fork")
}

fn is_dir_populated(dir: &Path) -> bool {
    dir.is_dir()
        && std::fs::read_dir(dir)
            .ok()
            .and_then(|mut entries| entries.next())
            .is_some()
}

// ---------------------------------------------------------------------------
// Game EXE directory (handles Win64-Shipping.exe)
// ---------------------------------------------------------------------------

/// Win64-preference score for a game executable path. Higher wins.
/// 3 = filename contains "Win64-Shipping" (the real shipped game binary)
/// 2 = filename contains "Win64" (e.g. `FooWin64.exe`)
/// 1 = parent directory path contains "Win64" (e.g. `Binaries/Win64/`)
/// 0 = anything else
///
/// Matching is case-insensitive: engine/repack layouts frequently ship
/// lowercase variants (e.g. `win64-shipping.exe`) and the size tiebreak used
/// to wrongly pick an unrelated bigger executable over the real game binary.
fn exe_win64_priority(path: &Path) -> u32 {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let parent_base = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let parent = path
        .parent()
        .map(|p| p.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if name.ends_with("win64-shipping.exe") {
        4
    } else if parent_base == "win64" {
        3
    } else if name.contains("win64") {
        2
    } else if parent.contains("win64") {
        1
    } else {
        0
    }
}

/// Executable basenames that are engine/launcher/installer binaries and must
/// NEVER be treated as the game's main executable for Steamless unpacking.
/// Entries are compared lowercased (exact match or prefix for versioned names).
const NON_GAME_EXE_NAMES: &[&str] = &[
    // Unreal Engine editor/CEF binaries
    "unrealeditor.exe",
    "ue4editor.exe",
    "ue5editor.exe",
    "crashreportclient.exe",
    "crashreportclienteditor.exe",
    "unrealcefsubprocess.exe",
    "shadercompileworker.exe",
    "unrealpak.exe",
    "unrealinsights.exe",
    "unrealcer.exe",
    // Store/launcher shells
    "epicgameslauncher.exe",
    // Installers / redistributables — never the shipped game binary
    "setup.exe",
    "install.exe",
    "installer.exe",
    "autorun.exe",
    "dxsetup.exe",
    "redist.exe",
];

/// Returns true when `name_lower` is a non-game engine/launcher/installer
/// binary. Versioned redistributable prefixes (`vcredist*`, `vc_redist*`,
/// `dotnet*`) and Unreal's uninstaller (`*unins000.exe`) also match.
fn is_non_game_exe(name_lower: &str) -> bool {
    NON_GAME_EXE_NAMES.contains(&name_lower)
        || name_lower.starts_with("crashreportclient")
        || name_lower.starts_with("unitycrashhandler")
        || name_lower.starts_with("crashpad")
        || name_lower.starts_with("vcredist")
        || name_lower.starts_with("vc_redist")
        || name_lower.starts_with("dotnet")
        || name_lower.ends_with("unins000.exe")
}

/// Removes non-game EXEs from the candidate list (in place). If every EXE in
/// the tree is non-game, the list is kept as-is so a repack root containing
/// only an installer still yields a usable candidate.
fn filter_non_game_exes(exes: &mut Vec<(u64, PathBuf)>) {
    if exes.is_empty() {
        return;
    }
    let keep: Vec<(u64, PathBuf)> = exes
        .iter()
        .filter(|(_, p)| {
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_lowercase();
            !is_non_game_exe(&name)
        })
        .cloned()
        .collect();
    if !keep.is_empty() {
        *exes = keep;
    }
}

/// Descending comparator: win64 priority first, then file size (larger wins).
fn compare_exes_win64_first(a: &(u64, PathBuf), b: &(u64, PathBuf)) -> std::cmp::Ordering {
    exe_win64_priority(&b.1)
        .cmp(&exe_win64_priority(&a.1))
        .then_with(|| b.0.cmp(&a.0))
}

fn find_game_exe_dir(game_path: &Path) -> PathBuf {
    let mut exes: Vec<(u64, PathBuf)> = Vec::new();
    collect_exes_recursive(game_path, &mut exes);
    filter_non_game_exes(&mut exes);
    exes.sort_by(compare_exes_win64_first);
    if let Some(exe) = exes.first() {
        if let Some(parent) = exe.1.parent() {
            return parent.to_path_buf();
        }
    }
    game_path.to_path_buf()
}

// ---------------------------------------------------------------------------
// PE import table scanner
// ---------------------------------------------------------------------------

fn get_game_imported_dlls(game_path: &Path) -> Vec<String> {
    let mut exes: Vec<(u64, PathBuf)> = Vec::new();
    collect_exes_recursive(game_path, &mut exes);
    filter_non_game_exes(&mut exes);
    exes.sort_by(compare_exes_win64_first);

    let exe = match exes.into_iter().next() {
        Some(e) => e.1,
        None => return Vec::new(),
    };

    let data = match std::fs::read(&exe) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };

    let pe = match goblin::pe::PE::parse(&data) {
        Ok(pe) => pe,
        Err(_) => return Vec::new(),
    };

    let mut imported = Vec::new();
    for import in pe.imports {
        imported.push(import.dll.to_lowercase());
    }
    imported
}

// ---------------------------------------------------------------------------
// Architecture detection
// ---------------------------------------------------------------------------

/// Max depth when searching for Steam API DLLs inside a game tree. Steam keeps
/// them in folders like `Engine/Binaries/ThirdParty/Steamworks/Steamv153/Win64`
/// (~6 levels), so a shallow bound would miss legitimately-installed DLLs.
const FIND_DLL_DEPTH: u32 = 12;

fn detect_architecture(game_path: &Path) -> (Option<String>, bool, bool) {
    let exe_dir = find_game_exe_dir(game_path);
    // Recursive (depth-bounded) scan so dlls living in subfolders like
    // `Binaries/Win64/` are detected even when the exe dir differs from root.
    let has_64 = find_file_recursive_bounded(game_path, "steam_api64.dll", FIND_DLL_DEPTH).is_some();
    let has_32 = find_file_recursive_bounded(game_path, "steam_api.dll", FIND_DLL_DEPTH).is_some();

    let arch = if has_64 {
        Some("x64".to_string())
    } else if has_32 {
        Some("x86".to_string())
    } else {
        find_main_exe(game_path).and_then(|exe| detect_exe_arch(&exe).ok().flatten())
    };

    eprintln!(
        "[FIX][SMOKE] game_path={} exe_dir={} has_steam_api64={} has_steam_api32={} arch={:?}",
        game_path.display(),
        exe_dir.display(),
        has_64,
        has_32,
        arch
    );

    (arch, has_64, has_32)
}

fn find_main_exe(game_path: &Path) -> Option<PathBuf> {
    find_candidate_exes(game_path).into_iter().next()
}

/// Returns ALL candidate executables for a game, ordered by priority:
/// Win64-Shipping exes first, then exes inside a `Win64` folder, then exes
/// whose name/path contains `win64`, then everything else (tiebreak by size).
/// Non-game binaries (crash handlers, redistributables, installers, etc.) are
/// filtered out unless that would leave an empty list.
fn find_candidate_exes(game_path: &Path) -> Vec<PathBuf> {
    let mut exes: Vec<(u64, PathBuf)> = Vec::new();
    collect_exes_recursive(game_path, &mut exes);
    filter_non_game_exes(&mut exes);
    exes.sort_by(compare_exes_win64_first);
    exes.into_iter().map(|(_, p)| p).collect()
}

fn collect_exes_recursive(dir: &Path, exes: &mut Vec<(u64, PathBuf)>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_exes_recursive(&path, exes);
            } else if path.extension().and_then(|e| e.to_str()) == Some("exe") {
                if let Ok(meta) = std::fs::metadata(&path) {
                    exes.push((meta.len(), path));
                }
            }
        }
    }
}

fn detect_exe_arch(exe_path: &Path) -> AnyResult<Option<String>> {
    let data = std::fs::read(exe_path)?;
    let pe = goblin::pe::PE::parse(&data).map_err(|e| anyhow::anyhow!("PE parse error: {e}"))?;
    if pe.is_64 {
        Ok(Some("x64".to_string()))
    } else {
        Ok(Some("x86".to_string()))
    }
}

// ---------------------------------------------------------------------------
// Online-Fix: HTML scraping
// ---------------------------------------------------------------------------

/// Encode non-ASCII bytes as percent-encoded while preserving already-encoded
/// `%XX` sequences and safe ASCII characters.
fn encode_non_ascii_href(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut output = String::with_capacity(input.len() * 2);
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && bytes[i + 1].is_ascii_hexdigit()
            && bytes[i + 2].is_ascii_hexdigit()
        {
            // Already percent-encoded; keep as-is
            output.push_str(&input[i..i + 3]);
            i += 3;
        } else if bytes[i] < 128 {
            output.push(bytes[i] as char);
            i += 1;
        } else {
            // Non-ASCII byte → percent-encode
            output.push_str(&format!("%{:02X}", bytes[i]));
            i += 1;
        }
    }
    output
}

async fn fetch_online_fix_directory(_client: &reqwest::Client) -> AnyResult<Vec<FileEntry>> {
    {
        let cache = online_fix_dir_cache()
            .lock()
            .map_err(|e| anyhow::anyhow!("Lock: {e}"))?;
        let age = cache.cached_at.elapsed().unwrap_or(Duration::from_secs(0));
        if age.as_secs() < ONLINE_FIX_CACHE_TTL_SECS && !cache.entries.is_empty() {
            eprintln!(
                "[luma-lite] online-fix: using cached directory ({} entries, {}s old)",
                cache.entries.len(),
                age.as_secs()
            );
            return Ok(cache.entries.clone());
        }
    }

    // Use a browser-like UA to avoid Cloudflare bot detection on perondepot
    let client = reqwest::Client::builder()
        .user_agent(ONLINE_FIX_USER_AGENT)
        .timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .build()
        .map_err(|e| anyhow::anyhow!("Failed to build perondepot client: {e}"))?;

    eprintln!("[luma-lite] online-fix: fetching directory from {ONLINE_FIX_URL}");
    let resp = client
        .get(ONLINE_FIX_URL)
        .send()
        .await
        .context("Failed to connect to online-fix")?;

    let status = resp.status();
    eprintln!("[luma-lite] online-fix: HTTP {status}");
    if !status.is_success() {
        anyhow::bail!("perondepot returned HTTP {status}");
    }

    let html = resp
        .text()
        .await
        .context("Failed to read online-fix response")?;

    eprintln!(
        "[luma-lite] online-fix: response {} bytes, first 200: {:?}",
        html.len(),
        &html[..html.len().min(200)]
    );

    let document = Html::parse_document(&html);
    let selector =
        Selector::parse("a").map_err(|e| anyhow::anyhow!("Failed to parse selector: {e:?}"))?;

    let mut entries = Vec::new();
    for element in document.select(&selector) {
        let href = element.value().attr("href").unwrap_or("");
        let text = element.text().collect::<String>().trim().to_string();

        if !href.is_empty() && (href.ends_with(".rar") || text.ends_with(".rar")) {
            let url = if href.starts_with("http") {
                encode_non_ascii_href(href)
            } else {
                format!(
                    "https://api.perondepot.xyz/all/{}",
                    encode_non_ascii_href(href.trim_start_matches('/'))
                )
            };
            // Use URL-decoded filename from href instead of truncated display text
            let filename = href.rsplit('/').next().unwrap_or(href);
            let decoded = urlencoding::decode(filename)
                .map(|d| d.into_owned())
                .unwrap_or_else(|_| filename.to_string());
            let display_name = decoded.strip_suffix(".rar").unwrap_or(&decoded).to_string();

            entries.push(FileEntry { url, display_name });
        }
    }

    eprintln!(
        "[luma-lite] online-fix: parsed {} entries from directory",
        entries.len()
    );

    {
        let mut cache = online_fix_dir_cache()
            .lock()
            .map_err(|e| anyhow::anyhow!("Lock: {e}"))?;
        cache.entries = entries.clone();
        cache.cached_at = SystemTime::now();
    }

    Ok(entries)
}

// ---------------------------------------------------------------------------
// Online-Fix: Fuzzy matching
// ---------------------------------------------------------------------------

fn normalize_text(text: &str) -> String {
    let cleaned = text
        .replace("по сети", "")
        .replace("  ", " ")
        .trim()
        .to_lowercase();
    let normalized = cleaned
        .replace(['.', '_', '-'], " ")
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>();
    normalized.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn extract_game_name_from_filename(display_name: &str) -> String {
    let without_ext = display_name.strip_suffix(".rar").unwrap_or(display_name);

    if let Some(pos) = without_ext.find('_') {
        let prefix = without_ext[..pos].trim().to_string();
        let lower = prefix.to_lowercase();
        if lower == "fix" || lower == "crack" || lower == "update" || lower == "patch" {
            return without_ext.trim().to_string();
        }
        return prefix;
    }

    if let Some(pos) = without_ext.find('-') {
        let prefix = without_ext[..pos].trim().to_string();
        let lower = prefix.to_lowercase();
        if lower == "fix" || lower == "crack" || lower == "update" || lower == "patch" {
            return without_ext.trim().to_string();
        }
        return prefix;
    }

    without_ext.trim().to_string()
}

fn fuzzy_match_game(game_name: &str, files: &[FileEntry]) -> (Option<String>, Vec<String>) {
    let normalized_game = normalize_text(game_name);
    eprintln!(
        "[luma-lite] online-fix: fuzzy match for '{}' → normalized: '{}'",
        game_name, normalized_game
    );
    let game_words: Vec<String> = normalized_game
        .split_whitespace()
        .filter(|w| w.len() > 1)
        .map(String::from)
        .collect();

    let abbreviation: String = game_words.iter().filter_map(|w| w.chars().next()).collect();

    let mut scored: Vec<(usize, &FileEntry)> = files
        .iter()
        .enumerate()
        .map(|(idx, file)| {
            let file_game_name = extract_game_name_from_filename(&file.display_name);
            let normalized_file = normalize_text(&file_game_name);

            if normalized_file == normalized_game {
                return (0, file);
            }

            if normalized_file.contains(&normalized_game)
                || normalized_game.contains(&normalized_file)
            {
                return (1, file);
            }

            let file_words: Vec<String> = normalized_file
                .split_whitespace()
                .filter(|w| w.len() > 1)
                .map(String::from)
                .collect();
            let common_words = game_words
                .iter()
                .filter(|gw| file_words.iter().any(|fw| fw == *gw))
                .count();
            if common_words >= 2 {
                return (2, file);
            }

            let compact_file: String = normalized_file.replace(' ', "");
            if compact_file.contains(&abbreviation) || abbreviation.contains(&compact_file) {
                return (3, file);
            }

            (999 + idx, file)
        })
        .collect();

    scored.sort_by_key(|&(score, _)| score);

    if let Some((score, file)) = scored.first() {
        if *score <= 3 {
            eprintln!(
                "[luma-lite] online-fix: matched '{}' (score {}) → {}",
                game_name, score, file.display_name
            );
            let suggestions: Vec<String> = scored
                .iter()
                .take(MAX_MANUAL_FILES)
                .map(|(_, f)| f.display_name.clone())
                .collect();
            return (Some(file.url.clone()), suggestions);
        }
    }

    let top5: Vec<String> = scored
        .iter()
        .take(5)
        .map(|(s, f)| format!("'{}' (score {})", f.display_name, s))
        .collect();
    eprintln!(
        "[luma-lite] online-fix: no match for '{}', top 5: {:?}",
        game_name, top5
    );

    let suggestions: Vec<String> = scored
        .iter()
        .take(MAX_MANUAL_FILES)
        .map(|(_, f)| f.display_name.clone())
        .collect();
    (None, suggestions)
}

// ---------------------------------------------------------------------------
// Online-Fix.me fallback search
// ---------------------------------------------------------------------------

async fn search_online_fix_me(
    client: &reqwest::Client,
    game_name: &str,
) -> AnyResult<Vec<FileEntry>> {
    let search_url = format!(
        "{}{}",
        ONLINE_FIX_ME_SEARCH_URL,
        urlencoding::encode(game_name)
    );

    let resp = client
        .get(&search_url)
        .timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .send()
        .await
        .context("Failed to search online-fix.me")?;

    if !resp.status().is_success() {
        anyhow::bail!("online-fix.me search returned HTTP {}", resp.status());
    }

    let html = resp
        .text()
        .await
        .context("Failed to read online-fix.me search response")?;

    let document = Html::parse_document(&html);
    let article_selector =
        Selector::parse("article.news").map_err(|e| anyhow::anyhow!("Selector parse: {e:?}"))?;
    let link_selector =
        Selector::parse("a.big-link").map_err(|e| anyhow::anyhow!("Selector parse: {e:?}"))?;
    let title_selector =
        Selector::parse("h2.title").map_err(|e| anyhow::anyhow!("Selector parse: {e:?}"))?;

    let mut entries = Vec::new();

    for article in document.select(&article_selector) {
        let title = article
            .select(&title_selector)
            .next()
            .map(|t| t.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        let href = article
            .select(&link_selector)
            .next()
            .and_then(|a| a.value().attr("href"))
            .unwrap_or("");

        if title.is_empty() || href.is_empty() {
            continue;
        }

        let game_url = if href.starts_with("http") {
            href.to_string()
        } else {
            format!("{}{}", ONLINE_FIX_ME_BASE, href)
        };

        entries.push(FileEntry {
            url: game_url,
            display_name: format!("{title} [online-fix.me]"),
        });
    }

    Ok(entries)
}

async fn fetch_online_fix_me_download_links(
    client: &reqwest::Client,
    page_url: &str,
) -> AnyResult<Vec<FileEntry>> {
    let resp = client
        .get(page_url)
        .timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .send()
        .await
        .context("Failed to fetch online-fix.me game page")?;

    if !resp.status().is_success() {
        anyhow::bail!("online-fix.me returned HTTP {}", resp.status());
    }

    let html = resp
        .text()
        .await
        .context("Failed to read online-fix.me game page")?;

    let document = Html::parse_document(&html);
    let selector = Selector::parse("a").map_err(|e| anyhow::anyhow!("Selector parse: {e:?}"))?;

    let mut entries = Vec::new();
    for element in document.select(&selector) {
        let href = element.value().attr("href").unwrap_or("");
        let text = element.text().collect::<String>().trim().to_string();

        let is_download = href.contains("gofile.io")
            || href.contains("buzzheavier")
            || href.contains("dropbox.com")
            || text.to_lowercase().contains("fix");

        if is_download && !href.is_empty() {
            entries.push(FileEntry {
                url: href.to_string(),
                display_name: if text.is_empty() {
                    href.to_string()
                } else {
                    text
                },
            });
        }
    }

    Ok(entries)
}

// ---------------------------------------------------------------------------
// Download and extraction helpers
// ---------------------------------------------------------------------------

async fn download_file(client: &reqwest::Client, url: &str, dest: &Path) -> AnyResult<()> {
    let safe_url = encode_non_ascii_href(url);
    let resp = client
        .get(&safe_url)
        .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
        .send()
        .await
        .context("Failed to start download")?;

    if !resp.status().is_success() {
        anyhow::bail!("HTTP {} for {}", resp.status(), url);
    }

    let bytes = resp.bytes().await.context("Failed to read download body")?;

    if bytes.is_empty() {
        anyhow::bail!("Downloaded file is empty: {}", url);
    }

    tokio::fs::write(dest, &bytes).await.context("Failed to write downloaded file")?;
    Ok(())
}

async fn download_and_extract_rar(
    client: &reqwest::Client,
    url: &str,
    game_path: &Path,
    app_handle: &tauri::AppHandle,
) -> AnyResult<Vec<String>> {
    let extractor = find_rar_extractor().await.ok_or_else(|| {
        anyhow::anyhow!(
            "No RAR extractor found. Install WinRAR, unar (https://theunarchiver.com/command-line) \
             or 7-Zip (https://7-zip.org) to extract online-fix archives."
        )
    })?;

    let temp_dir = tempfile::tempdir_in(temp_fix_dir(app_handle))?;
    let rar_path = temp_dir.path().join("download.rar");

    eprintln!("[luma-lite] online-fix: downloading RAR from: {}", url);
    download_file(client, url, &rar_path).await?;

    let metadata = std::fs::metadata(&rar_path)?;
    if metadata.len() < 1024 {
        anyhow::bail!(
            "Downloaded file is too small ({} bytes) — likely not a valid RAR",
            metadata.len()
        );
    }

    let extract_dir = temp_dir.path().join("extracted");
    std::fs::create_dir_all(&extract_dir)?;

    let output = match &extractor {
        RarExtractor::Unar => tokio::process::Command::new("unar")
            .args([
                "-p",
                ONLINE_FIX_RAR_PASSWORD,
                "-o",
                extract_dir.to_str().unwrap_or_default(),
                rar_path.to_str().unwrap_or_default(),
            ])
            .output()
            .await
            .context("Failed to run unar")?,
        RarExtractor::WinRar(exe) => {
            let password_arg = format!("-p{}", ONLINE_FIX_RAR_PASSWORD);
            tokio::process::Command::new(exe)
                .args([
                    "x",
                    &password_arg,
                    rar_path.to_str().unwrap_or_default(),
                    extract_dir.to_str().unwrap_or_default(),
                ])
                .output()
                .await
                .context("Failed to run UnRAR")?
        }
        RarExtractor::SevenZip(exe) => {
            let password_arg = format!("-p{}", ONLINE_FIX_RAR_PASSWORD);
            let output_arg = format!("-o{}", extract_dir.to_str().unwrap_or_default());
            tokio::process::Command::new(exe)
                .args([
                    "x",
                    &password_arg,
                    &output_arg,
                    rar_path.to_str().unwrap_or_default(),
                    "-y",
                ])
                .output()
                .await
                .context("Failed to run 7z")?
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        anyhow::bail!("RAR extraction failed:\nstdout: {stdout}\nstderr: {stderr}");
    }

    // Flatten single-root RARs: if extracted content has exactly one directory
    // and no files, extract from inside it so files land in game_path directly.
    let mut installed = Vec::new();
    let effective_src = flatten_extracted_dir(&extract_dir).unwrap_or(extract_dir);
    copy_dir_recursive_with_base(&effective_src, game_path, game_path, &mut installed)?;

    Ok(installed)
}

/// If `dir` contains exactly one subdirectory and no files, return that
/// subdirectory (so callers skip the wrapper folder RARs often add).
fn flatten_extracted_dir(dir: &Path) -> Option<PathBuf> {
    let mut entries = std::fs::read_dir(dir).ok()?;
    let first = entries.next()?.ok()?;
    if entries.next().is_some() {
        return None;
    }
    if first.path().is_dir() {
        Some(first.path())
    } else {
        None
    }
}

/// If `dest` already exists, rename it to `{dest}.bak` so the original can be
/// restored on revert. Returns `true` if a backup was created.
fn backup_file_if_exists(dest: &Path) -> bool {
    if !dest.exists() {
        return false;
    }
    let bak = PathBuf::from(format!("{}.bak", dest.to_string_lossy()));
    if bak.exists() {
        let _ = std::fs::remove_file(&bak);
    }
    std::fs::rename(dest, &bak).is_ok()
}

fn copy_dir_recursive_with_base(
    src: &Path,
    dest: &Path,
    base: &Path,
    installed: &mut Vec<String>,
) -> AnyResult<()> {
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if src_path.is_dir() {
            std::fs::create_dir_all(&dest_path)?;
            copy_dir_recursive_with_base(&src_path, &dest_path, base, installed)?;
        } else {
            backup_file_if_exists(&dest_path);
            std::fs::copy(&src_path, &dest_path)?;
            let relative = dest_path
                .strip_prefix(base)
                .unwrap_or(&dest_path)
                .to_string_lossy()
                .to_string();
            installed.push(relative);
        }
    }
    Ok(())
}

/// Remove empty directories bottom-up. Stops at `root` (won't delete root itself).
fn clean_empty_dirs_recursive(root: &Path) {
    for entry in std::fs::read_dir(root).into_iter().flatten().flatten() {
        if entry.path().is_dir() {
            clean_empty_dirs_recursive(&entry.path());
            let _ = std::fs::remove_dir(entry.path());
        }
    }
}

async fn download_and_extract_to_plugins(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    target_dir: &Path,
    tool_name: &str,
    app_handle: &tauri::AppHandle,
) -> AnyResult<Vec<String>> {
    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": 0,
            "tool": tool_name,
            "progress": 10,
            "message": format!("Fetching {tool_name} release...")
        }),
    );

    let release = get_latest_github_release(client, owner, repo).await?;

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": 0,
            "tool": tool_name,
            "progress": 30,
            "message": format!("Downloading {}...", release.zip_name)
        }),
    );

    let temp_dir = tempfile::tempdir_in(temp_fix_dir(app_handle))?;
    let zip_path = temp_dir.path().join(&release.zip_name);

    download_file(client, &release.zip_url, &zip_path).await?;

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": 0,
            "tool": tool_name,
            "progress": 60,
            "message": "Extracting..."
        }),
    );

    let extract_dir = temp_dir.path().join("extracted");
    std::fs::create_dir_all(&extract_dir)?;

    let zip_file = std::fs::File::open(&zip_path)?;
    let mut archive =
        zip::ZipArchive::new(zip_file).map_err(|e| anyhow::anyhow!("Failed to open ZIP: {e}"))?;
    archive
        .extract(&extract_dir)
        .map_err(|e| anyhow::anyhow!("Failed to extract ZIP: {e}"))?;

    std::fs::create_dir_all(target_dir)?;

    let mut installed = Vec::new();
    let effective_src = flatten_extracted_dir(&extract_dir).unwrap_or(extract_dir);
    copy_dir_recursive_with_base(&effective_src, target_dir, target_dir, &mut installed)?;

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": 0,
            "tool": tool_name,
            "progress": 100,
            "message": format!("{tool_name} installed to plugins directory")
        }),
    );

    Ok(installed)
}

// ---------------------------------------------------------------------------
// GitHub release helpers
// ---------------------------------------------------------------------------

async fn get_latest_github_release(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
) -> AnyResult<ReleaseInfo> {
    let cache_key = format!("{owner}/{repo}");

    {
        let cache = github_cache()
            .lock()
            .map_err(|e| anyhow::anyhow!("Lock: {e}"))?;
        if let Some(cached) = cache.entries.get(&cache_key) {
            let age = cached.cached_at.elapsed().unwrap_or(Duration::from_secs(0));
            if age.as_secs() < RELEASE_CACHE_TTL_SECS {
                return Ok(cached.info.clone());
            }
        }
    }

    let url = format!("{GITHUB_API_BASE}/repos/{owner}/{repo}/releases/latest");
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github.v3+json")
        .timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .send()
        .await
        .context("Failed to fetch GitHub release")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let rate_reset = resp
            .headers()
            .get("x-ratelimit-reset")
            .and_then(|v| v.to_str().ok())
            .map(String::from);
        let body = resp.text().await.unwrap_or_default();
        if status.as_u16() == 403 {
            if let Some(reset) = rate_reset {
                anyhow::bail!("GitHub API rate limit exceeded. Resets at Unix timestamp {reset}");
            }
        }
        anyhow::bail!("GitHub API error {status}: {body}");
    }

    let release: serde_json::Value = resp
        .json()
        .await
        .context("Failed to parse GitHub release")?;

    let assets = release["assets"]
        .as_array()
        .context("No assets in release")?;

    let zip_asset = assets
        .iter()
        .find(|a| a["name"].as_str().is_some_and(|n| n.ends_with(".zip")))
        .context("No ZIP asset found in release")?;

    let zip_url = zip_asset["browser_download_url"]
        .as_str()
        .context("No download URL for ZIP")?
        .to_string();

    let zip_name = zip_asset["name"]
        .as_str()
        .unwrap_or("release.zip")
        .to_string();

    let info = ReleaseInfo {
        zip_url,
        zip_name,
    };

    {
        let mut cache = github_cache()
            .lock()
            .map_err(|e| anyhow::anyhow!("Lock: {e}"))?;
        cache.entries.insert(
            cache_key,
            CachedRelease {
                info: info.clone(),
                cached_at: SystemTime::now(),
            },
        );
    }

    Ok(info)
}

// ---------------------------------------------------------------------------
// RAR extractor detection (unar, WinRAR, or 7-Zip)
// ---------------------------------------------------------------------------

enum RarExtractor {
    Unar,
    WinRar(String),
    SevenZip(String),
}

fn find_winrar_path() -> Option<String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(key) =
        hklm.open_subkey_with_flags(r"SOFTWARE\WinRAR\Archiver", winreg::enums::KEY_READ)
    {
        if let Ok(val) = key.get_value::<String, _>("ExePath") {
            let p = std::path::PathBuf::from(&val);
            let unrar = p.with_file_name("UnRAR.exe");
            if unrar.exists() {
                return Some(unrar.to_string_lossy().into_owned());
            }
        }
    }

    for base in [r"C:\Program Files\WinRAR", r"C:\Program Files (x86)\WinRAR"] {
        let p = std::path::PathBuf::from(base).join("UnRAR.exe");
        if p.exists() {
            return Some(p.to_string_lossy().into_owned());
        }
    }

    None
}

async fn find_rar_extractor() -> Option<RarExtractor> {
    if tokio::process::Command::new("unar")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .is_ok_and(|s| s.success())
    {
        return Some(RarExtractor::Unar);
    }
    if let Some(path) = find_winrar_path() {
        return Some(RarExtractor::WinRar(path));
    }
    if tokio::process::Command::new("7z")
        .arg("--help")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .is_ok_and(|s| s.success())
    {
        return Some(RarExtractor::SevenZip("7z".to_string()));
    }
    for p in [
        r"C:\Program Files\7-Zip\7z.exe",
        r"C:\Program Files (x86)\7-Zip\7z.exe",
    ] {
        if tokio::process::Command::new(p)
            .arg("--help")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .is_ok_and(|s| s.success())
        {
            return Some(RarExtractor::SevenZip(p.to_string()));
        }
    }
    None
}

// ---------------------------------------------------------------------------
// SmokeAPI
// ---------------------------------------------------------------------------

fn find_file_recursive(dir: &Path, filename: &str) -> Option<PathBuf> {
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file_recursive(&path, filename) {
                return Some(found);
            }
        } else if path.file_name().and_then(|n| n.to_str()) == Some(filename) {
            return Some(path);
        }
    }
    None
}

/// Depth-bounded variant of `find_file_recursive` — avoids walking huge game
/// trees when looking for a small set of known filenames (e.g. steam_api dlls).
fn find_file_recursive_bounded(dir: &Path, filename: &str, depth: u32) -> Option<PathBuf> {
    if depth == 0 {
        return None;
    }
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file_recursive_bounded(&path, filename, depth - 1) {
                return Some(found);
            }
        } else if path.file_name().and_then(|n| n.to_str()) == Some(filename) {
            return Some(path);
        }
    }
    None
}

/// Pick the Koaloader `d3d11.dll` matching the game bitness. SmokeAPI ships
/// Koaloader under `d3d11-64/` (x64) and `d3d11-32/` (x86) subfolders; the hook
/// must match the game architecture or it silently won't load.
fn find_koaloader_d3d11(koaloader_dir: &Path, architecture: &str) -> Option<PathBuf> {
    let subdir = if architecture == "x64" { "d3d11-64" } else { "d3d11-32" };
    let preferred = find_file_recursive(&koaloader_dir.join(subdir), "d3d11.dll");
    preferred.or_else(|| find_file_recursive(koaloader_dir, "d3d11.dll"))
}

fn find_proxy_dll_in_imports(imported: &[String]) -> Option<&'static str> {
    for candidate in PROXY_DLL_CANDIDATES {
        let lower = candidate.to_lowercase();
        if imported.contains(&lower) {
            return Some(candidate);
        }
    }
    None
}

async fn install_smoke_api_from_plugins(
    game_exe_dir: &Path,
    architecture: &str,
    proxy_dll: Option<&str>,
    app_handle: &tauri::AppHandle,
) -> AnyResult<Vec<String>> {
    let plugins = smoke_api_plugins_dir(app_handle);
    if !is_dir_populated(&plugins) {
        anyhow::bail!("SmokeAPI is not installed. Click Install first.");
    }

    let dll_name = if architecture == "x64" {
        "smoke_api64.dll"
    } else {
        "smoke_api32.dll"
    };

    let src_dll = find_file_recursive(&plugins, dll_name)
        .context(format!("Could not find {dll_name} in installed SmokeAPI"))?;

    match proxy_dll {
        Some(proxy_name) => {
            let target_path = game_exe_dir.join(proxy_name);
            backup_file_if_exists(&target_path);
            std::fs::copy(&src_dll, &target_path)
                .context("Failed to copy DLL to game directory")?;
            Ok(vec![proxy_name.to_string()])
        }
        None => {
            let koaloader_dir = koaloader_plugins_dir(app_handle);
            let koaloader_src = find_koaloader_d3d11(&koaloader_dir, architecture)
                .context("Koaloader d3d11.dll not found. Install Koaloader first.")?;
            let target_koaloader = game_exe_dir.join("d3d11.dll");
            backup_file_if_exists(&target_koaloader);
            std::fs::copy(&koaloader_src, &target_koaloader)
                .context("Failed to copy d3d11.dll to game directory")?;

            let target_smoke = game_exe_dir.join(dll_name);
            std::fs::copy(&src_dll, &target_smoke)
                .context("Failed to copy SmokeAPI DLL to game directory")?;

            Ok(vec!["d3d11.dll".to_string(), dll_name.to_string()])
        }
    }
}

// ---------------------------------------------------------------------------
// Steamless
// ---------------------------------------------------------------------------

/// Raw SteamStub signature scanned as a fallback when the PE section names are
/// not available/parseable. SteamStub embeds its marker near the stub section,
/// which lives close to the start of the file — a bounded scan is enough.
const STEAMSTUB_MARKER: &[u8] = b"SteamStub";
const STEAMSTUB_SCAN_BYTES: usize = 4 * 1024 * 1024;

/// Detects SteamStub DRM on an executable. Primary source: PE section names
/// (`.stub`, `.stub0`, `STEAMSTUB`, ...). Fallback: a bounded raw-marker scan.
/// Used to gate Steamless so it never runs on a game that doesn't actually
/// use SteamStub — running it on an unpacked exe is a no-op at best.
fn has_steamstub_drm(exe: &Path) -> bool {
    let data = match std::fs::read(exe) {
        Ok(d) => d,
        Err(_) => return false,
    };
    if let Ok(pe) = goblin::pe::PE::parse(&data) {
        for section in &pe.sections {
            let lower = section.name().unwrap_or_default().to_lowercase();
            if lower.contains(".stub") || lower.contains("steamstub") {
                return true;
            }
        }
    }
    let scan_len = data.len().min(STEAMSTUB_SCAN_BYTES);
    data[..scan_len]
        .windows(STEAMSTUB_MARKER.len())
        .any(|w| w.eq_ignore_ascii_case(STEAMSTUB_MARKER))
}

fn strip_extended_prefix(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

async fn run_steamless_from_plugins(
    game_exe: &Path,
    app_handle: &tauri::AppHandle,
) -> AnyResult<Vec<String>> {
    let plugins = steamless_plugins_dir(app_handle);
    eprintln!("[STEAMLESS][PLUGINS] dir={} populated={}", plugins.display(), is_dir_populated(&plugins));
    if !is_dir_populated(&plugins) {
        anyhow::bail!("Steamless is not installed. Click Install first.");
    }

    let steamless_exe = find_file_recursive(&plugins, "Steamless.CLI.exe")
        .or_else(|| find_file_recursive(&plugins, "Steamless.exe"));
    eprintln!("[STEAMLESS][CLI] found={}", steamless_exe.as_ref().map(|p| p.display().to_string()).unwrap_or_default());
    let steamless_exe = steamless_exe
        .context("Could not find Steamless.CLI.exe in installed Steamless")?;

    let plugins_sub = plugins.join("Plugins");
    if let Ok(entries) = std::fs::read_dir(&plugins_sub) {
        for entry in entries.flatten() {
            eprintln!("[STEAMLESS][PLUGINS/Plugins] {}", entry.path().display());
        }
    }

    let exe_name = game_exe
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    if exe_name.ends_with(".bak") || exe_name.contains(".unpacked") {
        anyhow::bail!("Invalid target exe (already unpacked or backup)");
    }

    let backup_path = PathBuf::from(format!("{}.bak", game_exe.to_string_lossy()));
    if backup_path.exists() {
        anyhow::bail!(
            "Steamless already applied (backup exists: {})",
            backup_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        );
    }

    let result = tokio::time::timeout(
        Duration::from_secs(120),
        tokio::process::Command::new(&steamless_exe)
            .current_dir(&plugins)
            .arg(strip_extended_prefix(game_exe).to_str().unwrap_or_default())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| anyhow::anyhow!("Steamless timed out after 120 seconds"))?
    .context("Failed to run Steamless")?;

    let stdout = String::from_utf8_lossy(&result.stdout);
    let stderr = String::from_utf8_lossy(&result.stderr);
    eprintln!("[STEAMLESS][STDOUT] {}", stdout);
    eprintln!("[STEAMLESS][STDERR] {}", stderr);

    // Treat definitive "this exe has no SteamStub" output as no-DRM. Also, a
    // non-zero exit WITHOUT an "Error" marker AND WITHOUT a successful-unpack
    // marker is treated as no-DRM (matching luma-lite): Steamless.CLI returns a
    // non-zero exit code for games that simply have no SteamStub, so bailing on
    // every such exit would surface "Failed to apply Steamless to any
    // executable" instead of the true "no DRM" result.
    let no_drm = stdout.contains("All unpackers failed to unpack file")
        || stdout.contains("is not supported")
        || (!result.status.success()
            && !stdout.contains("Successfully unpacked file!")
            && !stdout.contains("Error"));

    if no_drm {
        return Ok(vec![
            "__no_drm__".to_string(),
            "__no_unpack_needed__".to_string(),
        ]);
    }

    if !result.status.success() {
        anyhow::bail!(
            "Steamless failed (exit code {}):\nstdout: {stdout}\nstderr: {stderr}",
            result.status.code().unwrap_or(-1)
        );
    }

    if !stdout.contains("Successfully unpacked file!") {
        anyhow::bail!("Steamless did not unpack the file:\nstdout: {stdout}\nstderr: {stderr}");
    }

    let unpacked_path = PathBuf::from(format!("{}.unpacked.exe", game_exe.to_string_lossy()));
    if !unpacked_path.exists() {
        anyhow::bail!(
            "Steamless reported success but unpacked file not found at: {}",
            unpacked_path.display()
        );
    }

    std::fs::rename(game_exe, &backup_path).context("Failed to rename original exe to .bak")?;
    std::fs::rename(&unpacked_path, game_exe)
        .context("Failed to rename unpacked exe to original")?;

    Ok(vec![
        exe_name,
        backup_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
    ])
}

// ---------------------------------------------------------------------------
// Fix log system
// ---------------------------------------------------------------------------

fn fix_log_path(game_path: &Path, app_id: u64) -> PathBuf {
    game_path.join(format!("lumaforge-fix-log-{app_id}.log"))
}

fn write_fix_log(
    game_path: &Path,
    app_id: u64,
    game_name: &str,
    tool: &str,
    files: &[String],
) -> AnyResult<()> {
    let path = fix_log_path(game_path, app_id);

    let mut content = String::new();
    if path.exists() {
        content = std::fs::read_to_string(&path).unwrap_or_default();
        if !content.trim().is_empty() {
            content.push_str("\n\n---\n\n");
        }
    }

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    content.push_str(&format!(
        "[FIX]\n\
         Date: {now}\n\
         Game: {game_name}\n\
         Fix Type: {tool}\n\
         MainEXE: {}\n\
         Files:\n",
        files.first().unwrap_or(&String::new())
    ));
    for f in files {
        content.push_str(&format!("{f}\n"));
    }
    content.push_str("[/FIX]\n");

    std::fs::write(&path, content)
        .context(format!("Failed to write fix log to {}", path.display()))?;
    Ok(())
}

fn find_bak_files_recursive(dir: &Path, results: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                find_bak_files_recursive(&path, results);
            } else if path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.to_lowercase().ends_with(".exe.bak"))
            {
                results.push(path);
            }
        }
    }
}

struct FixBlock {
    fix_type: String,
    files: Vec<String>,
    full_block: String,
}

fn parse_fix_blocks(content: &str) -> Vec<FixBlock> {
    let mut blocks = Vec::new();
    for block in content.split("[FIX]") {
        let trimmed = block.trim();
        if trimmed.is_empty() {
            continue;
        }
        let block_body = match trimmed.split_once("[/FIX]") {
            Some((body, _)) => body,
            None => trimmed,
        };

        let mut fix_type = String::new();
        let mut files = Vec::new();
        let mut in_files = false;

        for line in block_body.lines() {
            let line = line.trim();
            if let Some(ft) = line.strip_prefix("Fix Type:") {
                fix_type = ft.trim().to_string();
            }
            if line == "Files:" {
                in_files = true;
                continue;
            }
            if in_files && !line.is_empty() {
                files.push(line.to_string());
            }
        }

        blocks.push(FixBlock {
            fix_type,
            files,
            full_block: format!("[FIX]{block}"),
        });
    }
    blocks
}

fn resolve_game_path_from_install_dir(install_dir: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(install_dir);
    if path.is_dir() {
        Ok(path)
    } else {
        Err(format!("Game directory not found: {install_dir}"))
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn library_get_game_fix_info(
    app_id: u64,
    name: String,
    install_dir: String,
    has_lua: bool,
    lua_count: u32,
) -> Result<GameFixInfo, String> {
    let install_path = resolve_game_path_from_install_dir(&install_dir).ok();
    let last_revision = None;

    let installed = install_path.is_some();

    let (game_arch, has_64, has_32) = if let Some(ref path) = install_path {
        detect_architecture(path)
    } else {
        (None, false, false)
    };

    let main_exe_path = install_path.as_ref().and_then(|p| find_main_exe(p));
    let main_exe = main_exe_path
        .as_ref()
        .map(|exe| {
            exe.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        });
    let exe_name = main_exe_path
        .as_ref()
        .map(|exe| exe.to_string_lossy().to_string());
    let has_steam_stub_drm = install_path
        .as_ref()
        .map(|p| {
            find_candidate_exes(p)
                .iter()
                .any(|exe| has_steamstub_drm(exe))
        })
        .unwrap_or(false);

    let has_online_fix = if let Ok(client) = reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .build()
    {
        fetch_online_fix_directory(&client)
            .await
            .map(|files| {
                let (matched, _) = fuzzy_match_game(&name, &files);
                matched.is_some()
            })
            .unwrap_or(false)
    } else {
        false
    };

    Ok(GameFixInfo {
        app_id,
        name,
        installed,
        install_path: install_path.map(|p| p.to_string_lossy().to_string()),
        has_lua,
        lua_count,
        last_revision,
        has_online_fix,
        has_steam_api_64: has_64,
        has_steam_api_32: has_32,
        game_arch,
        main_exe,
        has_steam_stub_drm,
        exe_name,
    })
}

#[tauri::command]
pub async fn library_apply_online_fix(
    app_id: u64,
    name: String,
    install_dir: String,
    manual_file: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<GameFixResult, String> {
    let client = reqwest::Client::builder()
        .user_agent(ONLINE_FIX_USER_AGENT)
        .timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let install_path = resolve_game_path_from_install_dir(&install_dir).ok();

    let game_path = install_path.ok_or_else(|| format!("Game {app_id} is not installed"))?;

    // If manual_file is provided, use it directly
    if let Some(ref file_name) = manual_file {
        let _ = app_handle.emit(
            "library://fix-progress",
            serde_json::json!({
                "appId": app_id,
                "tool": "online_fix",
                "progress": 40,
                "message": "Downloading selected file..."
            }),
        );

        let url = if file_name.starts_with("http") {
            file_name.clone()
        } else {
            format!("https://api.perondepot.xyz/{}", file_name)
        };

        return match download_and_extract_rar(&client, &url, &game_path, &app_handle).await {
            Ok(installed) => {
                let _ = write_fix_log(&game_path, app_id, &name, "OnlineFix", &installed);
                let _ = app_handle.emit(
                    "library://fix-progress",
                    serde_json::json!({
                        "appId": app_id,
                        "tool": "online_fix",
                        "progress": 100,
                        "message": "Online-fix applied successfully"
                    }),
                );
                Ok(GameFixResult {
                    ok: true,
                    tool: "online_fix".to_string(),
                    message: format!("Online-fix applied. {} file(s) installed.", installed.len()),
                    files_installed: installed,
                    errors: Vec::new(),
                    requires_manual_selection: false,
                    available_files: Vec::new(),
                })
            }
            Err(e) => Ok(GameFixResult {
                ok: false,
                tool: "online_fix".to_string(),
                message: format!("Failed to apply online-fix: {e}"),
                files_installed: Vec::new(),
                errors: vec![format!("{e:#}")],
                requires_manual_selection: false,
                available_files: Vec::new(),
            }),
        };
    }

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": app_id,
            "tool": "online_fix",
            "progress": 10,
            "message": "Fetching online-fix directory..."
        }),
    );

    let files = fetch_online_fix_directory(&client)
        .await
        .map_err(|e| format!("Failed to fetch online-fix directory: {e}"))?;

    eprintln!(
        "[luma-lite] online-fix: apply called for '{}' (app_id={}), perondepot entries: {}",
        name,
        app_id,
        files.len()
    );

    if !files.is_empty() {
        let _ = app_handle.emit(
            "library://fix-progress",
            serde_json::json!({
                "appId": app_id,
                "tool": "online_fix",
                "progress": 30,
                "message": "Matching game name..."
            }),
        );

        let (matched_url, _suggestions) = fuzzy_match_game(&name, &files);

        if let Some(url) = matched_url {
            let _ = app_handle.emit(
                "library://fix-progress",
                serde_json::json!({
                    "appId": app_id,
                    "tool": "online_fix",
                    "progress": 40,
                    "message": "Downloading and extracting fix..."
                }),
            );

            match download_and_extract_rar(&client, &url, &game_path, &app_handle).await {
                Ok(installed) => {
                    let _ = write_fix_log(&game_path, app_id, &name, "OnlineFix", &installed);
                    let _ = app_handle.emit(
                        "library://fix-progress",
                        serde_json::json!({
                            "appId": app_id,
                            "tool": "online_fix",
                            "progress": 100,
                            "message": "Online-fix applied successfully"
                        }),
                    );
                    return Ok(GameFixResult {
                        ok: true,
                        tool: "online_fix".to_string(),
                        message: format!(
                            "Online-fix applied. {} file(s) installed.",
                            installed.len()
                        ),
                        files_installed: installed,
                        errors: Vec::new(),
                        requires_manual_selection: false,
                        available_files: Vec::new(),
                    });
                }
                Err(e) => {
                    eprintln!("[luma-lite] online-fix: perondepot download failed: {e:#}");
                    let _ = app_handle.emit(
                        "library://fix-progress",
                        serde_json::json!({
                            "appId": app_id,
                            "tool": "online_fix",
                            "progress": 50,
                            "message": format!("perondepot download failed: {e}. Trying online-fix.me...")
                        }),
                    );
                }
            }
        }
    }

    // Fallback: search online-fix.me
    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": app_id,
            "tool": "online_fix",
            "progress": 60,
            "message": "Searching online-fix.me..."
        }),
    );

    match search_online_fix_me(&client, &name).await {
        Ok(results) if !results.is_empty() => {
            let mut all_suggestions: Vec<String> =
                results.iter().map(|r| r.display_name.clone()).collect();

            if let Some(first) = results.first() {
                let _ = app_handle.emit(
                    "library://fix-progress",
                    serde_json::json!({
                        "appId": app_id,
                        "tool": "online_fix",
                        "progress": 70,
                        "message": "Found match on online-fix.me, fetching download links..."
                    }),
                );

                match fetch_online_fix_me_download_links(&client, &first.url).await {
                    Ok(download_links) if !download_links.is_empty() => {
                        if let Some(download) = download_links.first() {
                            let _ = app_handle.emit(
                                "library://fix-progress",
                                serde_json::json!({
                                    "appId": app_id,
                                    "tool": "online_fix",
                                    "progress": 80,
                                    "message": "Downloading fix from online-fix.me..."
                                }),
                            );

                            if download.url.ends_with(".rar")
                                || download.url.contains("gofile")
                                || download.url.contains("buzzheavier")
                                || download.url.contains("dropbox")
                            {
                                match download_and_extract_rar(
                                    &client,
                                    &download.url,
                                    &game_path,
                                    &app_handle,
                                )
                                .await
                                {
                                    Ok(installed) => {
                                        let _ = write_fix_log(
                                            &game_path,
                                            app_id,
                                            &name,
                                            "OnlineFix",
                                            &installed,
                                        );
                                        let _ = app_handle.emit(
                                            "library://fix-progress",
                                            serde_json::json!({
                                                "appId": app_id,
                                                "tool": "online_fix",
                                                "progress": 100,
                                                "message": "Online-fix applied successfully from online-fix.me"
                                            }),
                                        );
                                        return Ok(GameFixResult {
                                            ok: true,
                                            tool: "online_fix".to_string(),
                                            message: format!(
                                                "Online-fix applied from online-fix.me. {} file(s) installed.",
                                                installed.len()
                                            ),
                                            files_installed: installed,
                                            errors: Vec::new(),
                                            requires_manual_selection: false,
                                            available_files: Vec::new(),
                                        });
                                    }
                                    Err(e) => {
                                        eprintln!("[luma-lite] online-fix: online-fix.me download failed: {e:#}");
                                        all_suggestions.push(format!("Download failed: {e}"));
                                    }
                                }
                            } else {
                                all_suggestions.push(
                                    "Direct download not available. Visit the page manually."
                                        .to_string(),
                                );
                            }
                        }
                    }
                    Ok(_) => {
                        eprintln!("[luma-lite] online-fix: no download links found on online-fix.me game page");
                        all_suggestions.push("No download links found on game page.".to_string());
                    }
                    Err(e) => {
                        eprintln!(
                            "[luma-lite] online-fix: failed to fetch online-fix.me page: {e:#}"
                        );
                        all_suggestions.push(format!("Failed to fetch page: {e}"));
                    }
                }
            }

            all_suggestions.truncate(MAX_MANUAL_FILES);
            return Ok(GameFixResult {
                ok: false,
                tool: "online_fix".to_string(),
                message: "Could not automatically apply fix. Please try manually.".to_string(),
                files_installed: Vec::new(),
                errors: Vec::new(),
                requires_manual_selection: true,
                available_files: all_suggestions,
            });
        }
        _ => {
            eprintln!(
                "[luma-lite] online-fix: no results from online-fix.me search for '{}'",
                name
            );
        }
    }

    eprintln!(
        "[luma-lite] online-fix: no match found for '{}' in any source",
        name
    );
    Ok(GameFixResult {
        ok: false,
        tool: "online_fix".to_string(),
        message: "No online-fix found for this game in any source.".to_string(),
        files_installed: Vec::new(),
        errors: vec!["Game not found in perondepot or online-fix.me".to_string()],
        requires_manual_selection: false,
        available_files: Vec::new(),
    })
}

#[tauri::command]
pub async fn library_apply_smoke_api(
    app_id: u64,
    name: String,
    install_dir: String,
    app_handle: tauri::AppHandle,
) -> Result<GameFixResult, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Ok(GameFixResult {
            ok: false,
            tool: "smoke_api".to_string(),
            message: "SmokeAPI is only available on Windows".to_string(),
            files_installed: Vec::new(),
            errors: vec!["SmokeAPI requires Windows (DLL-based tool)".to_string()],
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    let install_path = resolve_game_path_from_install_dir(&install_dir).ok();
    let (arch, has_64, has_32) = install_path
        .as_ref()
        .map(|p| detect_architecture(p))
        .unwrap_or((None, false, false));

    let game_path = install_path.ok_or_else(|| format!("Game {app_id} is not installed"))?;
    let architecture = arch.unwrap_or_else(|| "x64".to_string());
    let game_exe_dir = find_game_exe_dir(&game_path);

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": app_id,
            "tool": "smoke_api",
            "progress": 30,
            "message": "Analyzing game executable..."
        }),
    );

    let imported = get_game_imported_dlls(&game_path);
    // Self-hook (proxy slot) only works when the real steam_api dll exists on
    // disk. Without a stock dll (repacks / clean installs) route through
    // Koaloader, which needs no steam_api and hooks via d3d11.dll.
    let proxy_dll = if has_64 || has_32 {
        find_proxy_dll_in_imports(&imported)
    } else {
        None
    };

    let mode = if proxy_dll.is_some() {
        "self-hook"
    } else {
        "koaloader"
    };

    // For Koaloader mode, auto-download if not installed
    if proxy_dll.is_none() {
        let koaloader_dir = koaloader_plugins_dir(&app_handle);
        if !is_dir_populated(&koaloader_dir) {
            let _ = app_handle.emit(
                "library://fix-progress",
                serde_json::json!({
                    "appId": app_id,
                    "tool": "smoke_api",
                    "progress": 40,
                    "message": "Koaloader not found — installing automatically..."
                }),
            );

            let client = reqwest::Client::builder()
                .user_agent(APP_USER_AGENT)
                .timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
                .build()
                .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

            download_and_extract_to_plugins(
                &client,
                KOALOADER_OWNER,
                KOALOADER_REPO,
                &koaloader_dir,
                "koaloader",
                &app_handle,
            )
            .await
            .map_err(|e| format!("Failed to install Koaloader automatically: {e}"))?;
        }
    }

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": app_id,
            "tool": "smoke_api",
            "progress": 60,
            "message": format!("Applying SmokeAPI ({mode} mode)...")
        }),
    );

    match install_smoke_api_from_plugins(&game_exe_dir, &architecture, proxy_dll, &app_handle)
        .await
    {
        Ok(installed) => {
            let _ = write_fix_log(&game_path, app_id, &name, "SmokeAPI", &installed);

            let _ = app_handle.emit(
                "library://fix-progress",
                serde_json::json!({
                    "appId": app_id,
                    "tool": "smoke_api",
                    "progress": 100,
                    "message": "SmokeAPI applied successfully"
                }),
            );
            Ok(GameFixResult {
                ok: true,
                tool: "smoke_api".to_string(),
                message: format!(
                    "SmokeAPI ({}) applied ({mode}). {}",
                    architecture,
                    installed.join(", ")
                ),
                files_installed: installed,
                errors: Vec::new(),
                requires_manual_selection: false,
                available_files: Vec::new(),
            })
        }
        Err(e) => Ok(GameFixResult {
            ok: false,
            tool: "smoke_api".to_string(),
            message: format!("Failed to apply SmokeAPI: {e}"),
            files_installed: Vec::new(),
            errors: vec![format!("{e:#}")],
            requires_manual_selection: false,
            available_files: Vec::new(),
        }),
    }
}

#[tauri::command]
pub async fn library_apply_steamless(
    app_id: u64,
    name: String,
    install_dir: String,
    app_handle: tauri::AppHandle,
) -> Result<GameFixResult, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Ok(GameFixResult {
            ok: false,
            tool: "steamless".to_string(),
            message: "Steamless is only available on Windows".to_string(),
            files_installed: Vec::new(),
            errors: vec!["Steamless requires Windows (PE executable tool)".to_string()],
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    let install_path = resolve_game_path_from_install_dir(&install_dir).ok();
    let game_path = install_path.ok_or_else(|| format!("Game {app_id} is not installed"))?;
    let candidates = find_candidate_exes(&game_path);
    if candidates.is_empty() {
        return Err(format!("Game {app_id} has no executable"));
    }

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": app_id,
            "tool": "steamless",
            "progress": 50,
            "message": "Applying Steamless to all candidate executables..."
        }),
    );

    let mut files_installed: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut no_drm_exes: Vec<String> = Vec::new();
    let mut already_applied: Vec<String> = Vec::new();
    let mut applied: Vec<String> = Vec::new();

    eprintln!("[STEAMLESS][BOOT] game_path={} candidates={}", game_path.display(), candidates.len());
    for (i, exe) in candidates.iter().enumerate() {
        let exe_name = exe
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let backup_path = PathBuf::from(format!("{}.bak", exe.to_string_lossy()));
        eprintln!("[STEAMLESS][CANDIDATE] [{}/{}] {} path={}", i + 1, candidates.len(), exe_name, exe.display());

        if backup_path.exists() {
            eprintln!("[STEAMLESS][SKIP] {} already has .bak", exe_name);
            already_applied.push(exe_name);
            continue;
        }

        match run_steamless_from_plugins(exe, &app_handle).await {
            Ok(installed) if installed.first().is_some_and(|s| s == "__no_drm__") => {
                eprintln!("[STEAMLESS][NO_DRM] {}", exe_name);
                no_drm_exes.push(exe_name);
            }
            Ok(installed) => {
                eprintln!("[STEAMLESS][OK] {} files={:?}", exe_name, installed);
                applied.push(exe_name.clone());
                files_installed.extend(installed);
            }
            Err(e) => {
                eprintln!("[STEAMLESS][ERR] {} error={}", exe_name, e);
                errors.push(format!("{exe_name}: {e:#}"));
            }
        }
    }
    eprintln!("[STEAMLESS][RESULT] applied={} no_drm={} already_applied={} errors={}", applied.len(), no_drm_exes.len(), already_applied.len(), errors.len());

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": app_id,
            "tool": "steamless",
            "progress": 100,
            "message": "Steamless finished"
        }),
    );

    if !files_installed.is_empty() {
        let _ = write_fix_log(&game_path, app_id, &name, "Steamless", &files_installed);
        return Ok(GameFixResult {
            ok: true,
            tool: "steamless".to_string(),
            message: format!(
                "Steamless applied to {} executable(s): {}. Backups created.",
                applied.len(),
                applied.join(", ")
            ),
            files_installed,
            errors: Vec::new(),
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    if !already_applied.is_empty() {
        return Ok(GameFixResult {
            ok: true,
            tool: "steamless".to_string(),
            message: format!(
                "Steamless already applied (backups exist): {}",
                already_applied.join(", ")
            ),
            files_installed: Vec::new(),
            errors: Vec::new(),
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    if !no_drm_exes.is_empty() {
        return Ok(GameFixResult {
            ok: true,
            tool: "steamless".to_string(),
            message: "None of the candidate executables use SteamStub DRM. No unpacking needed."
                .to_string(),
            files_installed: Vec::new(),
            errors: Vec::new(),
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    Ok(GameFixResult {
        ok: false,
        tool: "steamless".to_string(),
        message: "Failed to apply Steamless to any executable".to_string(),
        files_installed: Vec::new(),
        errors,
        requires_manual_selection: false,
        available_files: Vec::new(),
    })
}

// ---------------------------------------------------------------------------
// Install commands (download + extract to plugins dir)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn library_check_fix_installations(
    app_handle: tauri::AppHandle,
) -> Result<FixInstallationStatus, String> {
    let smoke_api_dir = smoke_api_plugins_dir(&app_handle);
    let steamless_dir = steamless_plugins_dir(&app_handle);
    let koaloader_dir = koaloader_plugins_dir(&app_handle);
    let goldberg_dir = goldberg_plugins_dir(&app_handle);

    Ok(FixInstallationStatus {
        smoke_api_installed: is_dir_populated(&smoke_api_dir),
        steamless_installed: is_dir_populated(&steamless_dir),
        koaloader_installed: is_dir_populated(&koaloader_dir),
        goldberg_installed: is_dir_populated(&goldberg_dir),
        smoke_api_path: smoke_api_dir
            .exists()
            .then(|| smoke_api_dir.to_string_lossy().to_string()),
        steamless_path: steamless_dir
            .exists()
            .then(|| steamless_dir.to_string_lossy().to_string()),
        koaloader_path: koaloader_dir
            .exists()
            .then(|| koaloader_dir.to_string_lossy().to_string()),
        goldberg_path: goldberg_dir
            .exists()
            .then(|| goldberg_dir.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub async fn library_install_smoke_api(
    app_handle: tauri::AppHandle,
) -> Result<GameFixResult, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Ok(GameFixResult {
            ok: false,
            tool: "smoke_api".to_string(),
            message: "SmokeAPI is only available on Windows".to_string(),
            files_installed: Vec::new(),
            errors: vec!["SmokeAPI requires Windows (DLL-based tool)".to_string()],
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    let client = reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let target = smoke_api_plugins_dir(&app_handle);

    match download_and_extract_to_plugins(
        &client,
        SMOKE_API_OWNER,
        SMOKE_API_REPO,
        &target,
        "smoke_api",
        &app_handle,
    )
    .await
    {
        Ok(installed) => Ok(GameFixResult {
            ok: true,
            tool: "smoke_api".to_string(),
            message: format!(
                "SmokeAPI installed. {} file(s) extracted to plugins directory.",
                installed.len()
            ),
            files_installed: installed,
            errors: Vec::new(),
            requires_manual_selection: false,
            available_files: Vec::new(),
        }),
        Err(e) => Ok(GameFixResult {
            ok: false,
            tool: "smoke_api".to_string(),
            message: format!("Failed to install SmokeAPI: {e}"),
            files_installed: Vec::new(),
            errors: vec![format!("{e:#}")],
            requires_manual_selection: false,
            available_files: Vec::new(),
        }),
    }
}

#[tauri::command]
pub async fn library_install_steamless(
    app_handle: tauri::AppHandle,
) -> Result<GameFixResult, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Ok(GameFixResult {
            ok: false,
            tool: "steamless".to_string(),
            message: "Steamless is only available on Windows".to_string(),
            files_installed: Vec::new(),
            errors: vec!["Steamless requires Windows (PE executable tool)".to_string()],
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    let client = reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let target = steamless_plugins_dir(&app_handle);

    match download_and_extract_to_plugins(
        &client,
        STEAMLESS_OWNER,
        STEAMLESS_REPO,
        &target,
        "steamless",
        &app_handle,
    )
    .await
    {
        Ok(installed) => Ok(GameFixResult {
            ok: true,
            tool: "steamless".to_string(),
            message: format!(
                "Steamless installed. {} file(s) extracted to plugins directory.",
                installed.len()
            ),
            files_installed: installed,
            errors: Vec::new(),
            requires_manual_selection: false,
            available_files: Vec::new(),
        }),
        Err(e) => Ok(GameFixResult {
            ok: false,
            tool: "steamless".to_string(),
            message: format!("Failed to install Steamless: {e}"),
            files_installed: Vec::new(),
            errors: vec![format!("{e:#}")],
            requires_manual_selection: false,
            available_files: Vec::new(),
        }),
    }
}

#[tauri::command]
pub async fn library_install_koaloader(
    app_handle: tauri::AppHandle,
) -> Result<GameFixResult, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Ok(GameFixResult {
            ok: false,
            tool: "koaloader".to_string(),
            message: "Koaloader is only available on Windows".to_string(),
            files_installed: Vec::new(),
            errors: vec!["Koaloader requires Windows (DLL-based tool)".to_string()],
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    let client = reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let target = koaloader_plugins_dir(&app_handle);

    match download_and_extract_to_plugins(
        &client,
        KOALOADER_OWNER,
        KOALOADER_REPO,
        &target,
        "koaloader",
        &app_handle,
    )
    .await
    {
        Ok(installed) => Ok(GameFixResult {
            ok: true,
            tool: "koaloader".to_string(),
            message: format!(
                "Koaloader installed. {} file(s) extracted to plugins directory.",
                installed.len()
            ),
            files_installed: installed,
            errors: Vec::new(),
            requires_manual_selection: false,
            available_files: Vec::new(),
        }),
        Err(e) => Ok(GameFixResult {
            ok: false,
            tool: "koaloader".to_string(),
            message: format!("Failed to install Koaloader: {e}"),
            files_installed: Vec::new(),
            errors: vec![format!("{e:#}")],
            requires_manual_selection: false,
            available_files: Vec::new(),
        }),
    }
}

// ---------------------------------------------------------------------------
// Unfix / revert commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn library_has_steamless_fix(
    _app_id: u64,
    install_dir: String,
) -> Result<bool, String> {
    let game_path = resolve_game_path_from_install_dir(&install_dir)?;

    let mut bak_files = Vec::new();
    find_bak_files_recursive(&game_path, &mut bak_files);
    Ok(!bak_files.is_empty())
}

#[tauri::command]
pub async fn library_unfix_steamless(
    app_id: u64,
    install_dir: String,
    app_handle: tauri::AppHandle,
) -> Result<GameFixResult, String> {
    let game_path = resolve_game_path_from_install_dir(&install_dir)?;

    let exe_dir = find_game_exe_dir(&game_path);

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": app_id,
            "tool": "steamless",
            "progress": 20,
            "message": "Scanning for backups..."
        }),
    );

    let mut bak_files = Vec::new();
    find_bak_files_recursive(&game_path, &mut bak_files);

    if bak_files.is_empty() {
        return Ok(GameFixResult {
            ok: false,
            tool: "steamless".to_string(),
            message: "No Steamless backups found to revert".to_string(),
            files_installed: Vec::new(),
            errors: Vec::new(),
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    let total = bak_files.len();
    let mut restored = 0;
    let mut errors = Vec::new();

    for bak_path in &bak_files {
        let original = PathBuf::from(
            bak_path
                .to_string_lossy()
                .strip_suffix(".bak")
                .unwrap_or_default(),
        );

        let _ = app_handle.emit(
            "library://fix-progress",
            serde_json::json!({
                "appId": app_id,
                "tool": "steamless",
                "progress": 20 + ((restored as u64 * 60) / total as u64) as u32,
                "message": format!("Restoring {}...", original.file_name().unwrap_or_default().to_string_lossy())
            }),
        );

        match (|| -> AnyResult<()> {
            if original.exists() {
                std::fs::remove_file(&original)?;
            }
            std::fs::rename(bak_path, &original)?;
            Ok(())
        })() {
            Ok(()) => restored += 1,
            Err(e) => {
                errors.push(format!(
                    "Failed to restore {}: {e}",
                    original.file_name().unwrap_or_default().to_string_lossy()
                ));
            }
        }
    }

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": app_id,
            "tool": "steamless",
            "progress": 100,
            "message": format!("Restored {restored}/{total} file(s)")
        }),
    );

    // Clean up log from exe_dir (where write_fix_log writes now),
    // and also legacy log from game_path
    let log_path = fix_log_path(&exe_dir, app_id);
    if log_path.exists() {
        let _ = std::fs::remove_file(&log_path);
    }
    let legacy_log = fix_log_path(&game_path, app_id);
    if legacy_log != log_path && legacy_log.exists() {
        let _ = std::fs::remove_file(&legacy_log);
    }

    Ok(GameFixResult {
        ok: errors.is_empty(),
        tool: "steamless".to_string(),
        message: format!("Restored {restored}/{total} file(s)"),
        files_installed: Vec::new(),
        errors,
        requires_manual_selection: false,
        available_files: Vec::new(),
    })
}

// ---------------------------------------------------------------------------
// SmokeAPI fix detection + unfix
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn library_has_smoke_api_fix(
    app_id: u64,
    install_dir: String,
) -> Result<bool, String> {
    let game_path = resolve_game_path_from_install_dir(&install_dir)?;

    let log_path = fix_log_path(&game_path, app_id);
    if !log_path.exists() {
        return Ok(false);
    }

    let content = std::fs::read_to_string(&log_path).unwrap_or_default();
    let blocks = parse_fix_blocks(&content);
    Ok(blocks.iter().any(|b| {
        b.fix_type == "SmokeAPI"
            || b.fix_type == "smoke_api"
            || b.files.iter().any(|f| {
                let lower = f.to_lowercase();
                lower == "winmm.dll"
                    || lower == "winhttp.dll"
                    || lower == "version.dll"
                    || lower == "d3d11.dll"
                    || lower.starts_with("smoke_api")
            })
    }))
}

#[tauri::command]
pub async fn library_unfix_smoke_api(
    app_id: u64,
    install_dir: String,
    app_handle: tauri::AppHandle,
) -> Result<GameFixResult, String> {
    let game_path = resolve_game_path_from_install_dir(&install_dir)?;
    let game_exe_dir = find_game_exe_dir(&game_path);

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": app_id,
            "tool": "smoke_api",
            "progress": 20,
            "message": "Scanning for SmokeAPI files..."
        }),
    );

    let log_path = fix_log_path(&game_path, app_id);
    if !log_path.exists() {
        return Ok(GameFixResult {
            ok: false,
            tool: "smoke_api".to_string(),
            message: "No fix log found. Cannot revert SmokeAPI.".to_string(),
            files_installed: Vec::new(),
            errors: Vec::new(),
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    let content = std::fs::read_to_string(&log_path).unwrap_or_default();
    let blocks = parse_fix_blocks(&content);

    let smoke_api_files: Vec<String> = blocks
        .iter()
        .filter(|b| b.fix_type == "SmokeAPI" || b.fix_type == "smoke_api")
        .flat_map(|b| b.files.clone())
        .collect();

    if smoke_api_files.is_empty() {
        return Ok(GameFixResult {
            ok: false,
            tool: "smoke_api".to_string(),
            message: "No SmokeAPI fix entries found in log.".to_string(),
            files_installed: Vec::new(),
            errors: Vec::new(),
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    let total = smoke_api_files.len();
    let mut removed = 0;

    for file_name in &smoke_api_files {
        // Search in game_exe_dir first, then fall back to game_path
        let file_path = game_exe_dir.join(file_name);
        let file_path = if file_path.exists() {
            file_path
        } else {
            game_path.join(file_name)
        };

        let _ = app_handle.emit(
            "library://fix-progress",
            serde_json::json!({
                "appId": app_id,
                "tool": "smoke_api",
                "progress": 20 + ((removed as u64 * 60) / total as u64) as u32,
                "message": format!("Removing {file_name}...")
            }),
        );

        if file_path.exists() {
            let _ = std::fs::remove_file(&file_path);
        }
        let bak_path = PathBuf::from(format!("{}.bak", file_path.to_string_lossy()));
        if bak_path.exists() {
            let _ = std::fs::rename(&bak_path, &file_path);
        }
        removed += 1;
    }

    let remaining: Vec<&FixBlock> = blocks
        .iter()
        .filter(|b| b.fix_type != "SmokeAPI" && b.fix_type != "smoke_api")
        .collect();

    if remaining.is_empty() {
        let _ = std::fs::remove_file(&log_path);
    } else {
        let new_content: String = remaining
            .iter()
            .map(|b| b.full_block.as_str())
            .collect::<Vec<_>>()
            .join("\n\n---\n\n");
        let _ = std::fs::write(&log_path, &new_content);
    }

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": app_id,
            "tool": "smoke_api",
            "progress": 100,
            "message": format!("Removed {removed}/{total} SmokeAPI file(s)")
        }),
    );

    Ok(GameFixResult {
        ok: true,
        tool: "smoke_api".to_string(),
        message: format!("Removed {removed}/{total} SmokeAPI file(s)"),
        files_installed: Vec::new(),
        errors: Vec::new(),
        requires_manual_selection: false,
        available_files: Vec::new(),
    })
}

// ---------------------------------------------------------------------------
// Goldberg (fork) — proxy-slot over the real steam_api dll
// ---------------------------------------------------------------------------

/// Locate a `steam_api64.dll.bak` / `steam_api.dll.bak` created by a Goldberg
/// proxy-slot apply, depth-bounded like `detect_architecture`.
fn find_goldberg_bak_recursive(dir: &Path, results: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                find_goldberg_bak_recursive(&path, results);
            } else if path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| {
                    let lower = n.to_lowercase();
                    lower == "steam_api64.dll.bak" || lower == "steam_api.dll.bak"
                })
            {
                results.push(path);
            }
        }
    }
}

/// Applies the Goldberg emulator to every present Steam API DLL (x64 + x86).
/// Each present DLL is backed up (`.bak`) and replaced with the Goldberg fork
/// copy. A missing fork copy or a missing real target only skips that DLL — the
/// other architecture is still applied. Returns `(installed, errors)`.
fn apply_goldberg_to_present_dlls(
    game_path: &Path,
    emu_dir: &Path,
    present_dlls: &[&str],
    on_progress: &mut dyn FnMut(u32, &str),
) -> (Vec<String>, Vec<String>) {
    let mut installed = Vec::new();
    let mut errors = Vec::new();
    let total = present_dlls.len().max(1);

    for (i, emu_dll) in present_dlls.iter().enumerate() {
        on_progress(
            20 + ((i as u64 * 60) / total as u64) as u32,
            &format!("Backing up {emu_dll} and copying Goldberg emulator..."),
        );

        let Some(src_dll) = find_file_recursive_bounded(emu_dir, emu_dll, FIND_DLL_DEPTH) else {
            errors.push(format!("Could not find {emu_dll} in installed Goldberg"));
            continue;
        };

        let Some(target_path) = find_file_recursive_bounded(game_path, emu_dll, FIND_DLL_DEPTH) else {
            errors.push(format!("Could not find the real {emu_dll} in the game directory"));
            continue;
        };

        backup_file_if_exists(&target_path);
        match std::fs::copy(&src_dll, &target_path) {
            Ok(_) => installed.push(emu_dll.to_string()),
            Err(e) => errors.push(format!("Failed to copy Goldberg emulator for {emu_dll}: {e}")),
        }
    }

    (installed, errors)
}

#[tauri::command]
pub async fn library_apply_goldberg(
    app_id: u64,
    name: String,
    install_dir: String,
    app_handle: tauri::AppHandle,
) -> Result<GameFixResult, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Ok(GameFixResult {
            ok: false,
            tool: "goldberg".to_string(),
            message: "Goldberg is only available on Windows".to_string(),
            files_installed: Vec::new(),
            errors: vec!["Goldberg requires Windows (DLL-based tool)".to_string()],
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    let install_path = resolve_game_path_from_install_dir(&install_dir).ok();
    let game_path = install_path.ok_or_else(|| format!("Game {app_id} is not installed"))?;

    let emu_dir = goldberg_plugins_dir(&app_handle);
    if !is_dir_populated(&emu_dir) {
        return Ok(GameFixResult {
            ok: false,
            tool: "goldberg".to_string(),
            message: "Goldberg not installed. Install it from third-party tools first."
                .to_string(),
            files_installed: Vec::new(),
            errors: vec![
                "Goldberg is not installed. Click Install in third-party tools.".to_string(),
            ],
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    let (_, has_64, has_32) = detect_architecture(&game_path);
    if !has_64 && !has_32 {
        return Ok(GameFixResult {
            ok: false,
            tool: "goldberg".to_string(),
            message: "No steam_api dll found. Goldberg needs the real steam_api dll to proxy."
                .to_string(),
            files_installed: Vec::new(),
            errors: vec![
                "No steam_api64.dll or steam_api.dll found in the game directory.".to_string(),
            ],
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    let mut present_dlls: Vec<&str> = Vec::new();
    if has_64 {
        present_dlls.push("steam_api64.dll");
    }
    if has_32 {
        present_dlls.push("steam_api.dll");
    }

    let mut on_progress = |progress: u32, message: &str| {
        let _ = app_handle.emit(
            "library://fix-progress",
            serde_json::json!({
                "appId": app_id,
                "tool": "goldberg",
                "progress": progress,
                "message": message
            }),
        );
    };

    let (installed, errors) = apply_goldberg_to_present_dlls(
        &game_path,
        &emu_dir,
        &present_dlls,
        &mut on_progress,
    );

    if installed.is_empty() {
        return Ok(GameFixResult {
            ok: false,
            tool: "goldberg".to_string(),
            message: "Goldberg could not be applied — no steam_api dll could be replaced."
                .to_string(),
            files_installed: Vec::new(),
            errors,
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    let _ = write_fix_log(&game_path, app_id, &name, "Goldberg", &installed);

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": app_id,
            "tool": "goldberg",
            "progress": 100,
            "message": "Goldberg applied successfully"
        }),
    );

    let applied = installed.join(", ");
    Ok(GameFixResult {
        ok: true,
        tool: "goldberg".to_string(),
        message: format!(
            "Goldberg emulator applied ({applied}). Originals backed up as .bak."
        ),
        files_installed: installed,
        errors,
        requires_manual_selection: false,
        available_files: Vec::new(),
    })
}

#[tauri::command]
pub async fn library_has_goldberg_fix(
    app_id: u64,
    install_dir: String,
) -> Result<bool, String> {
    let game_path = resolve_game_path_from_install_dir(&install_dir)?;

    let log_path = fix_log_path(&game_path, app_id);
    if log_path.exists() {
        let content = std::fs::read_to_string(&log_path).unwrap_or_default();
        let blocks = parse_fix_blocks(&content);
        if blocks.iter().any(|b| {
            b.fix_type == "Goldberg"
                || b.files.iter().any(|f| {
                    let lower = f.to_lowercase();
                    lower == "steam_api64.dll" || lower == "steam_api.dll"
                })
        }) {
            return Ok(true);
        }
    }

    let mut bak_files = Vec::new();
    find_goldberg_bak_recursive(&game_path, &mut bak_files);
    Ok(!bak_files.is_empty())
}

#[tauri::command]
pub async fn library_unfix_goldberg(
    app_id: u64,
    install_dir: String,
    app_handle: tauri::AppHandle,
) -> Result<GameFixResult, String> {
    let game_path = resolve_game_path_from_install_dir(&install_dir)?;
    let game_exe_dir = find_game_exe_dir(&game_path);

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": app_id,
            "tool": "goldberg",
            "progress": 20,
            "message": "Scanning for Goldberg files..."
        }),
    );

    let log_path = fix_log_path(&game_path, app_id);
    let content = std::fs::read_to_string(&log_path).unwrap_or_default();
    let blocks = parse_fix_blocks(&content);

    let goldberg_files: Vec<String> = blocks
        .iter()
        .filter(|b| b.fix_type == "Goldberg")
        .flat_map(|b| b.files.clone())
        .collect();

    // No log block — fall back to restoring any steam_api dll backups found
    // directly on disk (covers apply/install variants that wrote no log).
    if goldberg_files.is_empty() {
        let mut bak_files = Vec::new();
        find_goldberg_bak_recursive(&game_path, &mut bak_files);
        if bak_files.is_empty() {
            return Ok(GameFixResult {
                ok: false,
                tool: "goldberg".to_string(),
                message: "No Goldberg fix found to revert".to_string(),
                files_installed: Vec::new(),
                errors: Vec::new(),
                requires_manual_selection: false,
                available_files: Vec::new(),
            });
        }

        let total = bak_files.len();
        let mut restored = 0;
        let mut errors = Vec::new();

        for bak_path in &bak_files {
            let original = PathBuf::from(
                bak_path
                    .to_string_lossy()
                    .strip_suffix(".bak")
                    .unwrap_or_default(),
            );

            let _ = app_handle.emit(
                "library://fix-progress",
                serde_json::json!({
                    "appId": app_id,
                    "tool": "goldberg",
                    "progress": 20 + ((restored as u64 * 60) / total as u64) as u32,
                    "message": format!("Restoring {}...", original.file_name().unwrap_or_default().to_string_lossy())
                }),
            );

            match (|| -> AnyResult<()> {
                if original.exists() {
                    std::fs::remove_file(&original)?;
                }
                std::fs::rename(bak_path, &original)?;
                Ok(())
            })() {
                Ok(()) => restored += 1,
                Err(e) => errors.push(format!(
                    "Failed to restore {}: {e}",
                    original.file_name().unwrap_or_default().to_string_lossy()
                )),
            }
        }

        let _ = app_handle.emit(
            "library://fix-progress",
            serde_json::json!({
                "appId": app_id,
                "tool": "goldberg",
                "progress": 100,
                "message": format!("Restored {restored}/{total} file(s)")
            }),
        );
        let _ = std::fs::remove_file(&log_path);

        return Ok(GameFixResult {
            ok: errors.is_empty(),
            tool: "goldberg".to_string(),
            message: format!("Restored {restored}/{total} file(s)"),
            files_installed: Vec::new(),
            errors,
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    let total = goldberg_files.len();
    let mut removed = 0;

    for file_name in &goldberg_files {
        let lower = file_name.to_lowercase();
        // Prefer the exe dir, then a bounded recursive search for dlls living
        // in subfolders (e.g. `Binaries/Win64/`), then the game root.
        let mut file_path = game_exe_dir.join(file_name);
        if !file_path.exists() && (lower == "steam_api64.dll" || lower == "steam_api.dll") {
            if let Some(found) = find_file_recursive_bounded(&game_path, &lower, FIND_DLL_DEPTH) {
                file_path = found;
            }
        }
        if !file_path.exists() {
            let alt = game_path.join(file_name);
            if alt.exists() {
                file_path = alt;
            }
        }

        let _ = app_handle.emit(
            "library://fix-progress",
            serde_json::json!({
                "appId": app_id,
                "tool": "goldberg",
                "progress": 20 + ((removed as u64 * 60) / total as u64) as u32,
                "message": format!("Removing {file_name}...")
            }),
        );

        if file_path.exists() {
            let _ = std::fs::remove_file(&file_path);
        }
        let bak_path = PathBuf::from(format!("{}.bak", file_path.to_string_lossy()));
        if bak_path.exists() {
            let _ = std::fs::rename(&bak_path, &file_path);
        }
        removed += 1;
    }

    let remaining: Vec<&FixBlock> = blocks
        .iter()
        .filter(|b| b.fix_type != "Goldberg")
        .collect();

    if remaining.is_empty() {
        let _ = std::fs::remove_file(&log_path);
    } else {
        let new_content: String = remaining
            .iter()
            .map(|b| b.full_block.as_str())
            .collect::<Vec<_>>()
            .join("\n\n---\n\n");
        let _ = std::fs::write(&log_path, &new_content);
    }

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": app_id,
            "tool": "goldberg",
            "progress": 100,
            "message": format!("Removed {removed}/{total} Goldberg file(s)")
        }),
    );

    Ok(GameFixResult {
        ok: true,
        tool: "goldberg".to_string(),
        message: format!("Removed {removed}/{total} Goldberg file(s)"),
        files_installed: Vec::new(),
        errors: Vec::new(),
        requires_manual_selection: false,
        available_files: Vec::new(),
    })
}

// ---------------------------------------------------------------------------
// Online-Fix detection + unfix
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn library_has_online_fix_fix(
    app_id: u64,
    install_dir: String,
) -> Result<bool, String> {
    let game_path = resolve_game_path_from_install_dir(&install_dir)?;

    let log_path = fix_log_path(&game_path, app_id);
    if !log_path.exists() {
        return Ok(false);
    }

    let content = std::fs::read_to_string(&log_path).unwrap_or_default();
    let blocks = parse_fix_blocks(&content);
    Ok(blocks
        .iter()
        .any(|b| b.fix_type == "OnlineFix" || b.fix_type == "online_fix"))
}

/// Returns the AppIDs of installed games that have at least one fix applied
/// (Steamless, SmokeAPI, or Online-Fix).
#[tauri::command]
pub async fn library_get_applied_fix_ids(
    entries: Vec<GameFixEntry>,
) -> Result<Vec<u64>, String> {
    let mut applied = Vec::new();

    for entry in entries {
        let Some(game_path) = entry
            .install_dir
            .as_deref()
            .and_then(|d| resolve_game_path_from_install_dir(d).ok())
        else {
            continue;
        };
        let app_id = entry.app_id;

        // Steamless: any .exe.bak backup in the game folder
        let mut bak_files = Vec::new();
        find_bak_files_recursive(&game_path, &mut bak_files);
        if !bak_files.is_empty() {
            applied.push(app_id);
            continue;
        }

        // SmokeAPI / OnlineFix: parse the shared fix log
        let log_path = fix_log_path(&game_path, app_id);
        if !log_path.exists() {
            continue;
        }
        let content = std::fs::read_to_string(&log_path).unwrap_or_default();
        let blocks = parse_fix_blocks(&content);
        let has_fix = blocks.iter().any(|b| {
            b.fix_type == "SmokeAPI"
                || b.fix_type == "smoke_api"
                || b.fix_type == "OnlineFix"
                || b.fix_type == "online_fix"
                || b.files.iter().any(|f| {
                    let lower = f.to_lowercase();
                    lower == "winmm.dll"
                        || lower == "winhttp.dll"
                        || lower == "version.dll"
                        || lower == "d3d11.dll"
                        || lower.starts_with("smoke_api")
                })
        });
        if has_fix {
            applied.push(app_id);
        }
    }

    Ok(applied)
}

#[tauri::command]
pub async fn library_unfix_online_fix(
    app_id: u64,
    install_dir: String,
    app_handle: tauri::AppHandle,
) -> Result<GameFixResult, String> {
    let game_path = resolve_game_path_from_install_dir(&install_dir)?;

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": app_id,
            "tool": "online_fix",
            "progress": 20,
            "message": "Scanning for Online-Fix files..."
        }),
    );

    let log_path = fix_log_path(&game_path, app_id);
    if !log_path.exists() {
        return Ok(GameFixResult {
            ok: false,
            tool: "online_fix".to_string(),
            message: "No fix log found. Cannot revert Online-Fix.".to_string(),
            files_installed: Vec::new(),
            errors: Vec::new(),
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    let content = std::fs::read_to_string(&log_path).unwrap_or_default();
    let blocks = parse_fix_blocks(&content);

    let online_fix_files: Vec<String> = blocks
        .iter()
        .filter(|b| b.fix_type == "OnlineFix" || b.fix_type == "online_fix")
        .flat_map(|b| b.files.clone())
        .collect();

    if online_fix_files.is_empty() {
        return Ok(GameFixResult {
            ok: false,
            tool: "online_fix".to_string(),
            message: "No Online-Fix entries found in log.".to_string(),
            files_installed: Vec::new(),
            errors: Vec::new(),
            requires_manual_selection: false,
            available_files: Vec::new(),
        });
    }

    let total = online_fix_files.len();
    let mut removed = 0;

    for file_name in &online_fix_files {
        let file_path = game_path.join(file_name);

        let _ = app_handle.emit(
            "library://fix-progress",
            serde_json::json!({
                "appId": app_id,
                "tool": "online_fix",
                "progress": 20 + ((removed as u64 * 60) / total as u64) as u32,
                "message": format!("Removing {file_name}...")
            }),
        );

        if file_path.exists() {
            let _ = std::fs::remove_file(&file_path);
        }
        let bak_path = PathBuf::from(format!("{}.bak", file_path.to_string_lossy()));
        if bak_path.exists() {
            let _ = std::fs::rename(&bak_path, &file_path);
        }
        removed += 1;
    }

    clean_empty_dirs_recursive(&game_path);

    let remaining: Vec<&FixBlock> = blocks
        .iter()
        .filter(|b| b.fix_type != "OnlineFix" && b.fix_type != "online_fix")
        .collect();

    if remaining.is_empty() {
        let _ = std::fs::remove_file(&log_path);
    } else {
        let new_content: String = remaining
            .iter()
            .map(|b| b.full_block.as_str())
            .collect::<Vec<_>>()
            .join("\n\n---\n\n");
        let _ = std::fs::write(&log_path, &new_content);
    }

    let _ = app_handle.emit(
        "library://fix-progress",
        serde_json::json!({
            "appId": app_id,
            "tool": "online_fix",
            "progress": 100,
            "message": format!("Removed {removed}/{total} Online-Fix file(s)")
        }),
    );

    Ok(GameFixResult {
        ok: true,
        tool: "online_fix".to_string(),
        message: format!("Removed {removed}/{total} Online-Fix file(s)"),
        files_installed: Vec::new(),
        errors: Vec::new(),
        requires_manual_selection: false,
        available_files: Vec::new(),
    })
}

// ---------------------------------------------------------------------------
// Steam launch options dialog
// ---------------------------------------------------------------------------

#[tauri::command]
#[cfg(target_os = "windows")]
pub fn library_open_steam_launch_options(app_id: u64) -> Result<(), String> {
    let url = format!("steam://nav/games/details/{app_id}");
    open::that(&url).map_err(|e| format!("Failed to open Steam: {e}"))
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
pub fn library_open_steam_launch_options(_app_id: u64) -> Result<(), String> {
    Err("Steam launch options dialog is only available on Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn win64_dir_exe(dir: &Path, name: &str) -> PathBuf {
        dir.join("Binaries").join("Win64").join(name)
    }

    #[test]
    fn exe_win64_priority_ranks_shipping_highest() {
        let root = PathBuf::from(r"C:\Games\TestGame");
        assert_eq!(exe_win64_priority(&win64_dir_exe(&root, "TestGame-Win64-Shipping.exe")), 4);
        assert_eq!(exe_win64_priority(&root.join("Binaries").join("Win64").join("TestGameWin64.exe")), 3);
        assert_eq!(exe_win64_priority(&root.join("TestGameWin64.exe")), 2);
        assert_eq!(exe_win64_priority(&root.join("Game.exe")), 0);
    }

    #[test]
    fn is_non_game_exe_excludes_crash_report_client_prefixes() {
        assert!(is_non_game_exe("crashreportclient-win64-shipping.exe"));
        assert!(is_non_game_exe("crashreportclient.exe"));
        // The real shipped game binary must never be caught by the prefix rule.
        assert!(!is_non_game_exe("kena-win64-shipping.exe"));
        assert!(!is_non_game_exe("game.exe"));
    }

    #[test]
    fn is_non_game_exe_excludes_unity_crash_handler() {
        assert!(is_non_game_exe("unitycrashhandler64.exe"));
        assert!(is_non_game_exe("crashpad_handler.exe"));
        assert!(is_non_game_exe("crashpadhandler-win64-shipping.exe"));
        // Real shipped binaries must not be caught by the prefix rules.
        assert!(!is_non_game_exe("kena-win64-shipping.exe"));
        assert!(!is_non_game_exe("game.exe"));
    }

    #[test]
    fn find_main_exe_prefers_shipping_over_server_and_crash_reporter() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("Binaries").join("Win64");
        fs::create_dir_all(&bin).unwrap();
        fs::write(bin.join("Kena-Win64-Shipping.exe"), vec![0u8; 90_000]).unwrap();
        fs::write(bin.join("KenaServer-Win64-Shipping.exe"), vec![0u8; 80_000]).unwrap();
        fs::write(bin.join("Kena-Win64-Shipping-Cmd.exe"), vec![0u8; 70_000]).unwrap();
        fs::write(bin.join("CrashReportClient-Win64-Shipping.exe"), vec![0u8; 85_000]).unwrap();
        let main = find_main_exe(tmp.path()).unwrap();
        assert_eq!(
            main.file_name().unwrap(),
            "Kena-Win64-Shipping.exe",
            "the shipped game binary must be selected over server/cmd/crash-report variants"
        );
    }

    #[test]
    fn find_main_exe_falls_back_to_exe_inside_win64_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let win64 = tmp.path().join("Win64");
        fs::create_dir_all(&win64).unwrap();
        fs::write(win64.join("App.exe"), vec![0u8; 40_000]).unwrap();
        // Larger loose exe outside the Win64 folder must NOT win.
        fs::write(tmp.path().join("Launcher.exe"), vec![0u8; 60_000]).unwrap();
        let main = find_main_exe(tmp.path()).unwrap();
        assert_eq!(
            main.parent().unwrap().file_name().unwrap(),
            "Win64",
            "an exe inside a Win64 folder must win over a larger loose exe"
        );
    }

    #[test]
    fn find_main_exe_falls_back_to_largest_when_no_win64() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("Small.exe"), vec![0u8; 10_000]).unwrap();
        fs::write(tmp.path().join("Large.exe"), vec![0u8; 90_000]).unwrap();
        let main = find_main_exe(tmp.path()).unwrap();
        assert_eq!(main.file_name().unwrap(), "Large.exe");
    }

    #[test]
    fn find_candidate_exes_returns_multiple_win64_and_root_exes() {
        let tmp = tempfile::tempdir().unwrap();
        let win64 = tmp.path().join("Binaries").join("Win64");
        fs::create_dir_all(&win64).unwrap();
        fs::write(win64.join("Kena-Win64-Shipping.exe"), vec![0u8; 90_000]).unwrap();
        // Crash handlers must be filtered out of the candidates.
        fs::write(win64.join("UnityCrashHandler64.exe"), vec![0u8; 50_000]).unwrap();
        fs::write(win64.join("CrashReportClient-Win64-Shipping.exe"), vec![0u8; 40_000]).unwrap();
        // Root loose exe must still be a candidate (multi-exe applies to it too).
        fs::write(tmp.path().join("Launcher.exe"), vec![0u8; 60_000]).unwrap();

        let candidates = find_candidate_exes(tmp.path());
        let names: Vec<String> = candidates
            .iter()
            .filter_map(|e| e.file_name().map(|n| n.to_string_lossy().to_string()))
            .collect();
        assert_eq!(names, vec!["Kena-Win64-Shipping.exe".to_string(), "Launcher.exe".to_string()]);
    }

    #[test]
    fn goldberg_applies_to_all_present_steam_api_dlls() {
        let tmp = tempfile::tempdir().unwrap();
        let game = tmp.path().join("Game");
        let emu = tmp.path().join("Emu");
        fs::create_dir_all(&game).unwrap();
        fs::create_dir_all(&emu).unwrap();
        fs::write(game.join("steam_api64.dll"), b"real64").unwrap();
        fs::write(game.join("steam_api.dll"), b"real32").unwrap();
        fs::write(emu.join("steam_api64.dll"), b"gold64").unwrap();
        fs::write(emu.join("steam_api.dll"), b"gold32").unwrap();

        let present = ["steam_api64.dll", "steam_api.dll"];
        let mut progress = Vec::new();
        let (installed, errors) =
            apply_goldberg_to_present_dlls(&game, &emu, &present, &mut |p, m| {
                progress.push((p, m.to_string()));
            });

        assert!(errors.is_empty(), "errors: {errors:?}");
        assert_eq!(installed.len(), 2);
        assert!(installed.contains(&"steam_api64.dll".to_string()));
        assert!(installed.contains(&"steam_api.dll".to_string()));
        assert!(game.join("steam_api64.dll.bak").exists());
        assert!(game.join("steam_api.dll.bak").exists());
        assert_eq!(std::fs::read(game.join("steam_api64.dll")).unwrap(), b"gold64");
        assert_eq!(std::fs::read(game.join("steam_api.dll")).unwrap(), b"gold32");
        assert_eq!(progress.len(), 2, "one progress emit per dll");
    }

    #[test]
    fn goldberg_applies_surviving_arch_when_one_dll_missing_from_emu() {
        let tmp = tempfile::tempdir().unwrap();
        let game = tmp.path().join("Game");
        let emu = tmp.path().join("Emu");
        fs::create_dir_all(&game).unwrap();
        fs::create_dir_all(&emu).unwrap();
        fs::write(game.join("steam_api64.dll"), b"real64").unwrap();
        fs::write(game.join("steam_api.dll"), b"real32").unwrap();
        // Emu only ships the x64 fork — x86 must be skipped, not fatal.
        fs::write(emu.join("steam_api64.dll"), b"gold64").unwrap();

        let present = ["steam_api64.dll", "steam_api.dll"];
        let (installed, errors) = apply_goldberg_to_present_dlls(&game, &emu, &present, &mut |_, _| {});

        assert_eq!(installed, vec!["steam_api64.dll".to_string()]);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("steam_api.dll"));
        assert_eq!(std::fs::read(game.join("steam_api.dll")).unwrap(), b"real32");
        assert!(!game.join("steam_api.dll.bak").exists());
    }

    #[test]
    fn compare_exes_win64_first_prefers_shipping_over_larger_non_win64() {
        // The non-win64 exe is 4x larger but must sort AFTER the Win64-Shipping exe.
        let root = PathBuf::from(r"C:\Games\TestGame");
        let shipping = win64_dir_exe(&root, "TestGame-Win64-Shipping.exe");
        let big_other = root.join("Engine").join("Binaries").join("Win64").join("UnrealEditor.exe");
        let mut exes = vec![
            (100_000, big_other.clone()),
            (25_000, shipping.clone()),
        ];
        exes.sort_by(compare_exes_win64_first);
        assert_eq!(exes.first().unwrap().1, shipping, "shipping exe must sort before the larger non-shipping exe");
    }

    #[test]
    fn compare_exes_win64_first_tiebreaks_by_size() {
        let root = PathBuf::from(r"C:\Games\TestGame");
        let small = root.join("Small.exe");
        let large = root.join("Large.exe");
        let a = (10_000, small);
        let b = (90_000, large);
        assert_eq!(compare_exes_win64_first(&a, &b), std::cmp::Ordering::Greater);
    }

    #[test]
    fn find_koaloader_picks_bitness_subfolder() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("d3d11-64")).unwrap();
        fs::create_dir_all(tmp.path().join("d3d11-32")).unwrap();
        fs::write(tmp.path().join("d3d11-64").join("d3d11.dll"), b"x64").unwrap();
        fs::write(tmp.path().join("d3d11-32").join("d3d11.dll"), b"x86").unwrap();

        let x64 = find_koaloader_d3d11(tmp.path(), "x64").unwrap();
        assert_eq!(x64.parent().unwrap().file_name().unwrap(), "d3d11-64");
        let x86 = find_koaloader_d3d11(tmp.path(), "x86").unwrap();
        assert_eq!(x86.parent().unwrap().file_name().unwrap(), "d3d11-32");
    }

    #[test]
    fn find_koaloader_falls_back_to_root_d3d11() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("d3d11.dll"), b"generic").unwrap();
        let found = find_koaloader_d3d11(tmp.path(), "x64").unwrap();
        assert_eq!(found.file_name().unwrap(), "d3d11.dll");
    }

    #[test]
    fn detect_architecture_sees_win64_subdir_dlls() {
        let tmp = tempfile::tempdir().unwrap();
        let exe_dir = win64_dir_exe(tmp.path(), "TestGame-Win64-Shipping.exe");
        fs::create_dir_all(exe_dir.parent().unwrap()).unwrap();
        fs::write(&exe_dir, b"exe").unwrap();
        fs::write(exe_dir.parent().unwrap().join("steam_api64.dll"), b"dll").unwrap();

        let (arch, has_64, has_32) = detect_architecture(tmp.path());
        assert_eq!(arch.as_deref(), Some("x64"));
        assert!(has_64);
        assert!(!has_32);
    }
}
