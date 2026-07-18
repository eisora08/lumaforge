//! Epic Games Store — Local installation scanner (Phase 1A).
//!
//! Read-only scanner that discovers installed Epic games from local `.item`
//! manifest files.  No network calls, no authentication, no manifest writes.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};


// ─── Debug policy ──────────────────────────────────────────────────────────

const DEBUG_EPIC_LOCAL_SCAN: bool = false;

// ─── Constants ─────────────────────────────────────────────────────────────

/// Relative path from ProgramData to the Epic manifest directory.
const EPIC_MANIFESTS_RELATIVE: &str = "Epic/EpicGamesLauncher/Data/Manifests";

/// Relative path from ProgramData to the third-party managed apps directory.
/// Note: Epic intentionally spells this "ThirParty" (missing 'd').
const EPIC_THIRD_PARTY_RELATIVE: &str = "Epic/EpicGamesLauncher/Data/ThirPartyManagedApps";

// ─── Raw Epic manifest (JSON shape) ────────────────────────────────────────

/// Raw fields from an Epic `.item` manifest file.
/// All fields are optional because manifests vary across versions and
/// installations.  We use `#[serde(default)]` for safe missing-field handling.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
#[allow(dead_code)] // Fields present for schema completeness; read in future phases
struct RawEpicManifest {
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    app_name: Option<String>,
    #[serde(default)]
    catalog_namespace: Option<String>,
    #[serde(default)]
    catalog_item_id: Option<String>,
    #[serde(default)]
    install_location: Option<String>,
    #[serde(default)]
    launch_executable: Option<String>,
    #[serde(default)]
    launch_command: Option<String>,
    #[serde(default)]
    main_game_catalog_item_id: Option<String>,
    #[serde(default)]
    main_game_app_name: Option<String>,
    #[serde(default)]
    main_game_catalog_namespace: Option<String>,
    #[serde(default)]
    release_version: Option<String>,
    #[serde(default)]
    manifest_location: Option<String>,
    #[serde(default)]
    install_size: Option<u64>,
    #[serde(default)]
    process_names: Option<Vec<String>>,
    #[serde(default)]
    main_window_process_name: Option<String>,
    #[serde(default, rename = "bIsApplication")]
    b_is_application: Option<bool>,
    #[serde(default, rename = "bIsExecutable")]
    b_is_executable: Option<bool>,
    #[serde(default, rename = "bIsIncompleteInstall")]
    b_is_incomplete_install: Option<bool>,
    #[serde(default, rename = "bCanRunOffline")]
    b_can_run_offline: Option<bool>,
    #[serde(default)]
    mandatory_app_folder_name: Option<String>,
}

// ─── Classification ────────────────────────────────────────────────────────

/// Classification of an Epic manifest entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EpicInstallClassification {
    /// Standalone game (no MainGame relationship, bIsApplication=true or has
    /// launch executable).
    BaseGame,
    /// DLC or add-on referencing a base game via MainGameCatalogItemId.
    Dlc,
    /// Add-on (similar to DLC but may differ in manifest semantics).
    Addon,
    /// Engine, tool, or redistributable (bIsApplication=false, no launcher).
    Tool,
    /// Could not determine classification.
    Unknown,
}

// ─── Source kind ───────────────────────────────────────────────────────────

/// Whether the manifest was found in the native manifests directory or the
/// third-party managed apps directory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EpicInstallSourceKind {
    /// Native Epic `.item` manifest from the Manifests directory.
    Native,
    /// Third-party managed app (from ThirPartyManagedApps).
    ThirdPartyManaged,
}

// ─── Normalized installed game ─────────────────────────────────────────────

/// A single normalized Epic installation record.
///
/// Contains only provider-level installation data, no LibraryGame UI state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicInstalledGame {
    /// Always `"epic"`.
    pub provider_id: String,
    /// Canonical Epic identity (see Part 5 strategy).
    pub provider_game_id: String,
    /// Epic CatalogNamespace UUID (when available).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    /// Epic CatalogItemId UUID (when available).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_item_id: Option<String>,
    /// Epic AppName slug (e.g. `"Fortnite"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_name: Option<String>,
    /// Human-readable display name (e.g. `"Fortnite"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// Resolved install directory.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_location: Option<String>,
    /// Launch executable relative to install directory.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_executable: Option<String>,
    /// Absolute executable path (install_location + launch_executable).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    /// Launch command arguments.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_arguments: Option<String>,
    /// Release version string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_version: Option<String>,
    /// Total installed size in bytes (from manifest).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_size: Option<u64>,
    /// Absolute path to the `.item` manifest file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest_path: Option<String>,
    /// Normalized process names for session tracking.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub process_names: Vec<String>,
    /// Base-game identity when this is a DLC/addon.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub main_game_app_name: Option<String>,
    /// Base-game CatalogItemId when this is a DLC/addon.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub main_game_catalog_item_id: Option<String>,
    /// Base-game CatalogNamespace when this is a DLC/addon.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub main_game_catalog_namespace: Option<String>,
    /// Whether the install directory exists on disk.
    pub installed: bool,
    /// Whether the executable file exists on disk.
    pub executable_exists: bool,
    /// Whether the manifest is well-formed and parseable.
    pub manifest_valid: bool,
    /// Whether the manifest marks this as an incomplete installation.
    pub incomplete_install: bool,
    /// Whether the game can run offline.
    pub can_run_offline: bool,
    /// Classification of this entry.
    pub classification: EpicInstallClassification,
    /// Source kind (native vs third-party managed).
    pub source_kind: EpicInstallSourceKind,
    /// Non-sensitive warnings produced during parsing/validation.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

// ─── Scan result envelope ──────────────────────────────────────────────────

/// The complete scan result envelope returned by the scanner.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicInstalledGamesScanResult {
    /// Normalized game records.
    pub games: Vec<EpicInstalledGame>,
    /// Resolved manifest directory path.
    pub manifest_directory: String,
    /// Whether the manifest directory existed.
    pub directory_exists: bool,
    /// Number of `.item` files found.
    pub scanned_file_count: u32,
    /// Number of manifests that parsed successfully with valid identity.
    pub valid_manifest_count: u32,
    /// Number of manifests that failed to parse.
    pub invalid_manifest_count: u32,
    /// Number of stale installations (install directory missing).
    pub stale_manifest_count: u32,
    /// Number of incomplete installations.
    pub incomplete_install_count: u32,
    /// Number of duplicates removed.
    pub duplicate_count: u32,
    /// Non-sensitive scan-level warnings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    /// ISO 8601 timestamp of the scan.
    pub scanned_at: String,
}

// ─── Identity helpers ──────────────────────────────────────────────────────

/// Compute canonical Epic providerGameId.
///
/// Priority:
///   1. `{namespace}:{catalogItemId}` — stable composite when both exist
///   2. `{namespace}:{appName}` — validated fallback
///   3. `{appName}` — last resort only when nothing else is available
///
/// Returns `None` when even `appName` is missing (should be very rare).
fn compute_epic_provider_game_id(manifest: &RawEpicManifest) -> Option<String> {
    let namespace = manifest.catalog_namespace.as_deref();
    let catalog_item_id = manifest.catalog_item_id.as_deref();
    let app_name = manifest.app_name.as_deref();

    // Priority 1: namespace + catalogItemId
    if let (Some(ns), Some(cid)) = (namespace, catalog_item_id) {
        if !ns.is_empty() && !cid.is_empty() {
            return Some(format!("{}:{}", ns, cid));
        }
    }

    // Priority 2: namespace + appName
    if let (Some(ns), Some(an)) = (namespace, app_name) {
        if !ns.is_empty() && !an.is_empty() {
            return Some(format!("{}:{}", ns, an));
        }
    }

    // Priority 3: appName only
    if let Some(an) = app_name {
        if !an.is_empty() {
            return Some(an.to_string());
        }
    }

    None
}

/// Compute a filesystem-safe version of the providerGameId for use in
/// cache/media directory names.  Replaces characters that are unsafe on
/// Windows filesystems.
#[allow(dead_code)] // Used by future media/cache path builder
fn sanitize_for_filesystem(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect()
}

// ─── Classification logic ──────────────────────────────────────────────────

fn classify_manifest(manifest: &RawEpicManifest) -> EpicInstallClassification {
    let is_application = manifest.b_is_application; // Option<bool>
    let has_launch_exec = manifest
        .launch_executable
        .as_ref()
        .map(|e| !e.is_empty())
        .unwrap_or(false);

    // Check 1: Explicitly marked as application, or has a launch executable.
    // This is the strongest signal.  Some Epic base-game manifests include
    // MainGameCatalogItemId / MainGameAppName that point to a DIFFERENT ID
    // (or whose own CatalogItemId is absent, preventing self-reference check).
    // A manifest that declares itself an application or provides a launch
    // executable is definitively a base game regardless of main-game fields.
    if is_application == Some(true) || has_launch_exec {
        return EpicInstallClassification::BaseGame;
    }

    // Check 2: Main-game relationship fields present — likely DLC or addon.
    let has_main_game_id = manifest.main_game_catalog_item_id.is_some();
    let has_main_game_name = manifest.main_game_app_name.is_some();

    if has_main_game_id || has_main_game_name {
        // Check for self-referencing main game fields.
        // Some manifests set MainGameCatalogItemId / MainGameAppName to their
        // own identity.  Only classify as DLC when the referenced main-game
        // identity is genuinely different from this record (or when we can't
        // determine self-reference because our own identity fields are absent).
        let self_referencing_id = manifest.main_game_catalog_item_id.as_deref()
            == manifest.catalog_item_id.as_deref()
            && manifest.main_game_catalog_item_id.is_some()
            && manifest.catalog_item_id.is_some(); // both must be present to compare
        let self_referencing_name = manifest.main_game_app_name.as_deref()
            == manifest.app_name.as_deref()
            && manifest.main_game_app_name.is_some()
            && manifest.app_name.is_some(); // both must be present to compare

        let all_present_self_ref = match (&manifest.main_game_catalog_item_id, &manifest.main_game_app_name) {
            (Some(_), Some(_)) => self_referencing_id && self_referencing_name,
            (Some(_), None) => self_referencing_id,
            (None, Some(_)) => self_referencing_name,
            (None, None) => unreachable!("has_main_game_id || has_main_game_name"),
        };

        if !all_present_self_ref {
            return EpicInstallClassification::Dlc;
        }
        // Self-referencing but no launch executable → fall through to unknown/tool
    }

    // Check 3: Explicitly NOT an application and no launch executable → tool/engine
    if is_application == Some(false) && !has_launch_exec {
        return EpicInstallClassification::Tool;
    }

    // No signal at all → unknown
    EpicInstallClassification::Unknown
}

// ─── Process name normalization ────────────────────────────────────────────

fn normalize_process_names(manifest: &RawEpicManifest) -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();

    // ProcessNames array
    if let Some(ref names) = manifest.process_names {
        for name in names {
            let trimmed = name.trim().to_string();
            if !trimmed.is_empty() {
                candidates.push(trimmed);
            }
        }
    }

    // MainWindowProcessName
    if let Some(ref name) = manifest.main_window_process_name {
        let trimmed = name.trim().to_string();
        if !trimmed.is_empty() {
            candidates.push(trimmed);
        }
    }

    // LaunchExecutable filename
    if let Some(ref exec) = manifest.launch_executable {
        if let Some(filename) = Path::new(exec).file_name() {
            let name = filename.to_string_lossy().to_string();
            if !name.is_empty() {
                candidates.push(name);
            }
        }
    }

    // Dedupe case-insensitively, preserve first occurrence, strip directory paths
    let mut seen: HashSet<String> = HashSet::new();
    let mut result: Vec<String> = Vec::new();

    for candidate in candidates {
        // Extract filename only if it's a path
        let filename = Path::new(&candidate)
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| candidate.clone());

        let lower = filename.to_lowercase();
        if seen.insert(lower) {
            result.push(filename);
        }
    }

    result
}

// ─── Path safety helpers ───────────────────────────────────────────────────

/// Safely build an executable path from install_location + launch_executable.
/// Returns (executable_path, executable_exists, warning).
fn resolve_executable_path(
    install_location: &str,
    launch_executable: &str,
) -> (Option<String>, bool, Option<String>) {
    if install_location.is_empty() {
        return (None, false, Some("installLocation is empty".to_string()));
    }

    if launch_executable.is_empty() {
        return (None, false, Some("launchExecutable is empty".to_string()));
    }

    let install_dir = PathBuf::from(install_location);
    let exec_path = if Path::new(launch_executable).is_absolute() {
        // Absolute executable — check it doesn't escape install dir unexpectedly
        let abs_exec = PathBuf::from(launch_executable);
        match abs_exec.canonicalize() {
            Ok(canonical) => {
                match install_dir.canonicalize() {
                    Ok(canonical_install) => {
                        if !canonical.starts_with(&canonical_install) {
                            return (
                                None,
                                false,
                                Some(format!(
                                    "absolute executable escapes installLocation: {}",
                                    launch_executable
                                )),
                            );
                        }
                        abs_exec
                    }
                    Err(_) => abs_exec,
                }
            }
            // File doesn't exist yet — use as-is
            Err(_) => abs_exec,
        }
    } else {
        // Relative executable — join with install dir
        install_dir.join(launch_executable)
    };

    // Normalize the path
    let normalized = exec_path
        .components()
        .collect::<PathBuf>();

    // Check for path traversal in the relative part
    let relative_part = Path::new(launch_executable);
    let mut depth = 0i32;
    for component in relative_part.components() {
        match component {
            std::path::Component::ParentDir => depth -= 1,
            std::path::Component::Normal(_) => depth += 1,
            _ => {}
        }
        if depth < 0 {
            return (
                None,
                false,
                Some(format!(
                    "path traversal detected in launchExecutable: {}",
                    launch_executable
                )),
            );
        }
    }

    let exists = normalized.exists() && normalized.is_file();

    (Some(normalized.to_string_lossy().to_string()), exists, None)
}

/// Check if a directory path exists and is actually a directory.
fn validate_install_location(location: &str) -> (bool, bool, Option<String>) {
    if location.is_empty() {
        return (false, false, Some("installLocation is empty".to_string()));
    }

    let path = PathBuf::from(location);
    if !path.exists() {
        return (true, false, None); // path present but dir missing
    }
    if !path.is_dir() {
        return (
            true,
            false,
            Some(format!("installLocation is not a directory: {}", location)),
        );
    }
    (true, true, None)
}

// ─── Core scanner ──────────────────────────────────────────────────────────

/// Resolve the default Epic manifest directory.
///
/// Priority:
///   1. Explicit override
///   2. `%ProgramData%/Epic/EpicGamesLauncher/Data/Manifests`
fn resolve_manifest_directory(manifest_dir_override: Option<&str>) -> PathBuf {
    if let Some(dir) = manifest_dir_override {
        return PathBuf::from(dir);
    }

    let program_data = std::env::var("ProgramData")
        .or_else(|_| std::env::var("ALLUSERSPROFILE"))
        .unwrap_or_else(|_| {
            // Last resort: try common Windows paths
            if cfg!(target_os = "windows") {
                "C:\\ProgramData".to_string()
            } else {
                "/usr/share".to_string() // Non-Windows fallback for tests
            }
        });

    PathBuf::from(program_data).join(EPIC_MANIFESTS_RELATIVE)
}

/// Resolve the third-party managed apps directory.
fn resolve_third_party_directory(manifest_dir_override: Option<&str>) -> PathBuf {
    if let Some(dir) = manifest_dir_override {
        // Derive the third-party dir from the override by replacing the
        // trailing component.
        return PathBuf::from(dir)
            .parent()
            .unwrap_or(Path::new(dir))
            .join("ThirPartyManagedApps");
    }

    let program_data = std::env::var("ProgramData")
        .or_else(|_| std::env::var("ALLUSERSPROFILE"))
        .unwrap_or_else(|_| {
            if cfg!(target_os = "windows") {
                "C:\\ProgramData".to_string()
            } else {
                "/usr/share".to_string()
            }
        });

    PathBuf::from(program_data).join(EPIC_THIRD_PARTY_RELATIVE)
}

/// Parse a single `.item` file into a raw manifest.
/// Returns None on I/O or JSON parse failure.
fn parse_manifest_file(path: &Path) -> Option<RawEpicManifest> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Run the full Epic local installation scan.
fn run_epic_scan(manifest_dir_override: Option<&str>) -> EpicInstalledGamesScanResult {
    let start = std::time::Instant::now();

    let manifest_dir = resolve_manifest_directory(manifest_dir_override);
    let manifest_dir_str = manifest_dir.to_string_lossy().to_string();
    let directory_exists = manifest_dir.is_dir();

    if DEBUG_EPIC_LOCAL_SCAN {
        println!(
            "[EPIC_SCAN][START] resolved_directory={} override={}",
            manifest_dir_str,
            manifest_dir_override.unwrap_or("<none>")
        );
        println!(
            "[EPIC_SCAN][START] directory_exists={}",
            directory_exists
        );
    }

    let mut games: Vec<EpicInstalledGame> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut scanned_count: u32 = 0;
    let mut invalid_count: u32 = 0;
    let mut stale_count: u32 = 0;
    let mut incomplete_count: u32 = 0;

    if !directory_exists {
        warnings.push(format!(
            "Manifest directory does not exist: {}",
            manifest_dir_str
        ));

        return EpicInstalledGamesScanResult {
            games,
            manifest_directory: manifest_dir_str,
            directory_exists: false,
            scanned_file_count: 0,
            valid_manifest_count: 0,
            invalid_manifest_count: 0,
            stale_manifest_count: 0,
            incomplete_install_count: 0,
            duplicate_count: 0,
            warnings,
            scanned_at: chrono_utc_now(),
        };
    }

    // Read native manifest files
    let entries = match fs::read_dir(&manifest_dir) {
        Ok(e) => e,
        Err(e) => {
            warnings.push(format!("Failed to read manifest directory: {}", e));
            return EpicInstalledGamesScanResult {
                games,
                manifest_directory: manifest_dir_str,
                directory_exists: true,
                scanned_file_count: 0,
                valid_manifest_count: 0,
                invalid_manifest_count: 0,
                stale_manifest_count: 0,
                incomplete_install_count: 0,
                duplicate_count: 0,
                warnings,
                scanned_at: chrono_utc_now(),
            };
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();

        // Only process .item files
        if path.extension().and_then(|e| e.to_str()) != Some("item") {
            continue;
        }

        scanned_count += 1;

        let filename = path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();

        match parse_manifest_file(&path) {
            Some(manifest) => {
                let game = process_manifest(
                    &manifest,
                    &path,
                    &filename,
                    EpicInstallSourceKind::Native,
                );

                if DEBUG_EPIC_LOCAL_SCAN {
                    println!(
                        "[EPIC_SCAN][MANIFEST] file={} identity={} classification={:?} installed={} warnings={}",
                        filename,
                        game.provider_game_id,
                        game.classification,
                        game.installed,
                        game.warnings.len()
                    );
                }

                // Count stats
                if !game.manifest_valid {
                    invalid_count += 1;
                }
                if !game.installed && game.manifest_valid {
                    stale_count += 1;
                }
                if game.incomplete_install {
                    incomplete_count += 1;
                }

                // Collect non-parse warnings
                for w in &game.warnings {
                    warnings.push(format!("{}: {}", filename, w));
                }

                games.push(game);
            }
            None => {
                invalid_count += 1;
                warnings.push(format!("{}: failed to parse manifest JSON", filename));
                if DEBUG_EPIC_LOCAL_SCAN {
                    println!("[EPIC_SCAN][MANIFEST] file={} parse FAILED", filename);
                }
            }
        }
    }

    // Scan third-party managed apps directory (best-effort)
    let third_party_dir = resolve_third_party_directory(manifest_dir_override);
    if third_party_dir.is_dir() {
        if let Ok(tp_entries) = fs::read_dir(&third_party_dir) {
            for entry in tp_entries.flatten() {
                let path = entry.path();

                if path.extension().and_then(|e| e.to_str()) != Some("item") {
                    continue;
                }

                scanned_count += 1;

                let filename = path
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_default();

                match parse_manifest_file(&path) {
                    Some(manifest) => {
                        let game = process_manifest(
                            &manifest,
                            &path,
                            &filename,
                            EpicInstallSourceKind::ThirdPartyManaged,
                        );

                        if DEBUG_EPIC_LOCAL_SCAN {
                            println!(
                                "[EPIC_SCAN][MANIFEST] file={} (third-party) identity={} installed={}",
                                filename,
                                game.provider_game_id,
                                game.installed
                            );
                        }

                        if !game.manifest_valid {
                            invalid_count += 1;
                        }
                        if !game.installed && game.manifest_valid {
                            stale_count += 1;
                        }
                        if game.incomplete_install {
                            incomplete_count += 1;
                        }

                        for w in &game.warnings {
                            warnings.push(format!("{}: {}", filename, w));
                        }

                        games.push(game);
                    }
                    None => {
                        invalid_count += 1;
                        warnings
                            .push(format!("{}: failed to parse third-party manifest JSON", filename));
                    }
                }
            }
        }
    }

    // Deduplicate by providerGameId — keep the "best" record
    let before_dedup = games.len();
    games = deduplicate_games(games);
    let duplicate_count = (before_dedup - games.len()) as u32;

    let valid_count = games.len() as u32;

    if DEBUG_EPIC_LOCAL_SCAN {
        println!(
            "[EPIC_SCAN][COMPLETE] scanned={} valid={} stale={} incomplete={} duplicates={} elapsed={:?}",
            scanned_count, valid_count, stale_count, incomplete_count, duplicate_count, start.elapsed()
        );
    }

    EpicInstalledGamesScanResult {
        games,
        manifest_directory: manifest_dir_str,
        directory_exists: true,
        scanned_file_count: scanned_count,
        valid_manifest_count: valid_count,
        invalid_manifest_count: invalid_count,
        stale_manifest_count: stale_count,
        incomplete_install_count: incomplete_count,
        duplicate_count,
        warnings,
        scanned_at: chrono_utc_now(),
    }
}

/// Process a parsed raw manifest into a normalized `EpicInstalledGame`.
fn process_manifest(
    manifest: &RawEpicManifest,
    manifest_path: &Path,
    filename: &str,
    source_kind: EpicInstallSourceKind,
) -> EpicInstalledGame {
    let mut warnings: Vec<String> = Vec::new();

    // Identity
    let provider_game_id = compute_epic_provider_game_id(manifest).unwrap_or_else(|| {
        warnings.push("manifest lacks appName/namespace/catalogItemId — using filename fallback".to_string());
        // Filename fallback: strip .item extension
        filename.strip_suffix(".item").unwrap_or(filename).to_string()
    });

    let namespace = manifest.catalog_namespace.clone();
    let catalog_item_id = manifest.catalog_item_id.clone();
    let app_name = manifest.app_name.clone();
    let display_name = manifest.display_name.clone();

    // Install location validation
    let install_location_str = manifest.install_location.as_deref().unwrap_or("");
    let (path_present, dir_exists, loc_warning) = validate_install_location(install_location_str);
    if let Some(w) = loc_warning {
        warnings.push(w);
    }

    // Executable path resolution
    let launch_executable_str = manifest.launch_executable.as_deref().unwrap_or("");
    let (exec_path, exec_exists, exec_warning) = if path_present && dir_exists && !launch_executable_str.is_empty()
    {
        resolve_executable_path(install_location_str, launch_executable_str)
    } else {
        (None, false, None)
    };
    if let Some(w) = exec_warning {
        warnings.push(w);
    }

    // Launch arguments
    let launch_arguments = manifest.launch_command.clone();

    // Classification
    let classification = classify_manifest(manifest);

    // Incomplete install
    let incomplete_install = manifest.b_is_incomplete_install.unwrap_or(false);
    if incomplete_install {
        warnings.push("manifest marks incomplete installation".to_string());
    }

    // Installation state
    let installed = path_present && dir_exists && !incomplete_install;

    // Process names
    let process_names = normalize_process_names(manifest);

    EpicInstalledGame {
        provider_id: "epic".to_string(),
        provider_game_id,
        namespace,
        catalog_item_id,
        app_name,
        display_name,
        install_location: if install_location_str.is_empty() {
            None
        } else {
            Some(install_location_str.to_string())
        },
        launch_executable: if launch_executable_str.is_empty() {
            None
        } else {
            Some(launch_executable_str.to_string())
        },
        executable_path: exec_path,
        launch_arguments,
        release_version: manifest.release_version.clone(),
        install_size: manifest.install_size,
        manifest_path: Some(manifest_path.to_string_lossy().to_string()),
        process_names,
        main_game_app_name: manifest.main_game_app_name.clone(),
        main_game_catalog_item_id: manifest.main_game_catalog_item_id.clone(),
        main_game_catalog_namespace: manifest.main_game_catalog_namespace.clone(),
        installed,
        executable_exists: exec_exists,
        manifest_valid: true,
        incomplete_install,
        can_run_offline: manifest.b_can_run_offline.unwrap_or(false),
        classification,
        source_kind,
        warnings,
    }
}

// ─── Deduplication ─────────────────────────────────────────────────────────

/// Deduplicate games by providerGameId, keeping the "best" record.
fn deduplicate_games(games: Vec<EpicInstalledGame>) -> Vec<EpicInstalledGame> {
    let mut by_id: HashMap<String, EpicInstalledGame> = HashMap::new();

    for game in games {
        let key = game.provider_game_id.clone();
        match by_id.get(&key) {
            None => {
                by_id.insert(key, game);
            }
            Some(existing) => {
                if is_better_record(&game, existing) {
                    by_id.insert(key, game);
                }
            }
        }
    }

    // Deterministic order: sort by providerGameId
    let mut result: Vec<EpicInstalledGame> = by_id.into_values().collect();
    result.sort_by(|a, b| a.provider_game_id.cmp(&b.provider_game_id));
    result
}

/// Returns true if `candidate` is preferred over `current`.
fn is_better_record(candidate: &EpicInstalledGame, current: &EpicInstalledGame) -> bool {
    // Prefer valid + installed over stale
    if candidate.installed != current.installed {
        return candidate.installed;
    }
    // Prefer executable exists
    if candidate.executable_exists != current.executable_exists {
        return candidate.executable_exists;
    }
    // Prefer non-incomplete
    if candidate.incomplete_install != current.incomplete_install {
        return !candidate.incomplete_install;
    }
    // Prefer manifest_valid
    if candidate.manifest_valid != current.manifest_valid {
        return candidate.manifest_valid;
    }
    // Deterministic fallback: prefer shorter manifest path (more canonical)
    match (&candidate.manifest_path, &current.manifest_path) {
        (Some(a), Some(b)) => a.len() < b.len(),
        (Some(_), None) => true,
        _ => false,
    }
}

// ─── Timestamp helper ──────────────────────────────────────────────────────

fn chrono_utc_now() -> String {
    // Simple ISO 8601 without pulling in chrono crate
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Convert to calendar date/time (simplified UTC)
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Days since epoch to Y-M-D (algorithm from Howard Hinnant)
    let z = days as i64 + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m, d, hours, minutes, seconds
    )
}

// ─── Tauri command ─────────────────────────────────────────────────────────

/// Scan for locally installed Epic Games Store games.
///
/// Reads `.item` manifest files from the Epic Games Launcher data directory.
/// No authentication, no network calls, no manifest modification.
///
/// # Arguments
/// * `manifest_dir` — Optional override for the manifest directory path.
///   Uses `%ProgramData%/Epic/EpicGamesLauncher/Data/Manifests` when None.
#[tauri::command]
pub fn scan_epic_installed_games(
    manifest_dir: Option<String>,
) -> Result<EpicInstalledGamesScanResult, String> {
    let override_str = manifest_dir.as_deref();
    let result = run_epic_scan(override_str);
    Ok(result)
}

// ─── Launch result ──────────────────────────────────────────────────────────

/// Result of an Epic game launch attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicLaunchResult {
    /// Whether the game was successfully dispatched.
    pub success: bool,
    /// Launch method used: `"protocol"` or `"direct-executable"`.
    pub method: String,
    /// Non-null when protocol failed and fell back to direct executable,
    /// or when the fallback also failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

/// Launch an Epic game.
///
/// Attempts the Epic Games Launcher protocol URI first using the canonical
/// triple-identity format:
///   `com.epicgames.launcher://apps/{NamespaceId}%3A{CatalogId}%3A{ArtifactId}?action=launch&silent=true`
///
/// Falls back to the app_name-only format (deprecated, only works when launcher
/// is already running) when namespace/catalogItemId are not available.
///
/// Direct executable fallback is gated behind `direct_launch_enabled`.
/// When false (default), protocol failure returns an error.
/// When true, falls back to Command::new(executable) if protocol launch fails.
#[tauri::command]
pub fn launch_epic_game(
    app_name: String,
    executable_path: Option<String>,
    launch_arguments: Option<String>,
    direct_launch_enabled: bool,
    namespace: Option<String>,
    catalog_item_id: Option<String>,
) -> Result<EpicLaunchResult, String> {
    if app_name.trim().is_empty() {
        return Err("Epic launch failed: app_name is empty".to_string());
    }

    // 1. Build protocol URI — prefer triple-identity format (namespace:catalogItemId:appName)
    let protocol_url = if let (Some(ns), Some(cid)) = (&namespace, &catalog_item_id) {
        if !ns.is_empty() && !cid.is_empty() && !app_name.trim().is_empty() {
            let encoded_ns = urlencoding::encode(ns.trim());
            let encoded_cid = urlencoding::encode(cid.trim());
            let encoded_name = urlencoding::encode(app_name.trim());
            format!(
                "com.epicgames.launcher://apps/{}%3A{}%3A{}?action=launch&silent=true",
                encoded_ns, encoded_cid, encoded_name
            )
        } else {
            // Fallback: app_name only (deprecated but functional when launcher is running)
            let encoded_name = urlencoding::encode(app_name.trim());
            format!(
                "com.epicgames.launcher://apps/{}?action=launch&silent=true",
                encoded_name
            )
        }
    } else {
        let encoded_name = urlencoding::encode(app_name.trim());
        format!(
            "com.epicgames.launcher://apps/{}?action=launch&silent=true",
            encoded_name
        )
    };

    match open::that_detached(&protocol_url) {
        Ok(_) => Ok(EpicLaunchResult {
            success: true,
            method: "protocol".to_string(),
            error: None,
        }),
        Err(protocol_err) => {
            // 2. Direct executable fallback — only when explicitly enabled
            if direct_launch_enabled {
                if let Some(exe) = executable_path {
                    let trimmed = exe.trim().trim_matches(|c| c == '"' || c == '\'');
                    if trimmed.is_empty() {
                        return Err(format!(
                            "Epic launcher protocol failed ({}) and executable path is empty",
                            protocol_err
                        ));
                    }

                    let mut cmd = std::process::Command::new(trimmed);

                    if let Some(args_str) = launch_arguments {
                        if !args_str.is_empty() {
                            for arg in args_str.split_whitespace() {
                                if !arg.is_empty() {
                                    cmd.arg(arg);
                                }
                            }
                        }
                    }

                    cmd.stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .stdin(std::process::Stdio::null());

                    match cmd.spawn() {
                        Ok(child) => {
                            let _pid = child.id();
                            // Detach so the process outlives the Rust command
                            std::mem::forget(child);
                            Ok(EpicLaunchResult {
                                success: true,
                                method: "direct-executable".to_string(),
                                error: Some(format!(
                                    "Protocol failed ({}), used direct executable fallback",
                                    protocol_err
                                )),
                            })
                        }
                        Err(exe_err) => Err(format!(
                            "Both protocol and direct executable failed. Protocol: {}; Executable: {}",
                            protocol_err, exe_err
                        )),
                    }
                } else {
                    Err(format!(
                        "Epic launcher protocol failed ({}) and no executable path available",
                        protocol_err
                    ))
                }
            } else {
                Err(format!(
                    "Epic launcher protocol failed ({}) and direct executable fallback is disabled",
                    protocol_err
                ))
            }
        }
    }
}

/// Scan for locally installed Epic Games Store games.

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Helper: create a temp manifest directory and write a `.item` file.
    fn setup_manifest_dir() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().to_path_buf();
        (tmp, dir)
    }

    fn write_manifest(dir: &Path, filename: &str, content: &str) {
        fs::write(dir.join(filename), content).unwrap();
    }

    fn sample_installed_game() -> &'static str {
        r#"{
            "DisplayName": "My Test Game",
            "AppName": "TestGame",
            "CatalogNamespace": "abcd-1234-efgh-5678",
            "CatalogItemId": "9876-5432-dcba-8765",
            "InstallLocation": "C:\\Games\\TestGame",
            "LaunchExecutable": "Binaries\\Win64\\TestGame.exe",
            "LaunchCommand": "",
            "ReleaseVersion": "1.0.0",
            "InstallSize": 10737418240,
            "bIsApplication": true,
            "bIsExecutable": true,
            "bIsIncompleteInstall": false,
            "bCanRunOffline": true,
            "ProcessNames": ["TestGame.exe", "TestGameLauncher.exe"],
            "MainWindowProcessName": "TestGame.exe",
            "MandatoryAppFolderName": "TestGame"
        }"#
    }

    fn sample_dlc() -> &'static str {
        r#"{
            "DisplayName": "Test Game - Season Pass",
            "AppName": "TestGameSeasonPass",
            "CatalogNamespace": "dlcd-1234-efgh-5678",
            "CatalogItemId": "dlc9-5432-dcba-8765",
            "InstallLocation": "C:\\Games\\TestGame\\DLC",
            "LaunchExecutable": "",
            "bIsApplication": false,
            "bIsExecutable": false,
            "bIsIncompleteInstall": false,
            "MainGameCatalogItemId": "9876-5432-dcba-8765",
            "MainGameAppName": "TestGame",
            "MainGameCatalogNamespace": "abcd-1234-efgh-5678"
        }"#
    }

    fn sample_unicode_game() -> &'static str {
        r#"{
            "DisplayName": "Ünïcödé Spïël 日本語テスト",
            "AppName": "UnicodeGame",
            "CatalogNamespace": "unic-1234-od-5678",
            "CatalogItemId": "unic-9876-dcba-8765",
            "InstallLocation": "C:\\Games\\Ünïcödé Spïël",
            "LaunchExecutable": "game.exe",
            "bIsApplication": true,
            "bIsExecutable": true,
            "bIsIncompleteInstall": false
        }"#
    }

    fn sample_spaces_path() -> &'static str {
        r#"{
            "DisplayName": "Game With Spaces",
            "AppName": "SpacesGame",
            "CatalogNamespace": "spac-1234-efgh-5678",
            "CatalogItemId": "spac-9876-dcba-8765",
            "InstallLocation": "C:\\Program Files\\My Games\\Spaces Game",
            "LaunchExecutable": "Binaries\\Space Game.exe",
            "bIsApplication": true,
            "bIsExecutable": true,
            "bIsIncompleteInstall": false
        }"#
    }

    // ── Identity tests ─────────────────────────────────────────────

    #[test]
    fn test_provider_game_id_namespace_catalog_item() {
        let manifest: RawEpicManifest = serde_json::from_str(sample_installed_game()).unwrap();
        let id = compute_epic_provider_game_id(&manifest).unwrap();
        assert_eq!(id, "abcd-1234-efgh-5678:9876-5432-dcba-8765");
    }

    #[test]
    fn test_provider_game_id_namespace_only() {
        let mut manifest: RawEpicManifest =
            serde_json::from_str(sample_installed_game()).unwrap();
        manifest.catalog_item_id = None;
        let id = compute_epic_provider_game_id(&manifest).unwrap();
        assert_eq!(id, "abcd-1234-efgh-5678:TestGame");
    }

    #[test]
    fn test_provider_game_id_appname_only() {
        let mut manifest: RawEpicManifest =
            serde_json::from_str(sample_installed_game()).unwrap();
        manifest.catalog_namespace = None;
        manifest.catalog_item_id = None;
        let id = compute_epic_provider_game_id(&manifest).unwrap();
        assert_eq!(id, "TestGame");
    }

    #[test]
    fn test_provider_game_id_returns_none_when_empty() {
        let manifest = RawEpicManifest {
            display_name: Some("Something".to_string()),
            app_name: None,
            catalog_namespace: None,
            catalog_item_id: None,
            install_location: None,
            launch_executable: None,
            launch_command: None,
            main_game_catalog_item_id: None,
            main_game_app_name: None,
            main_game_catalog_namespace: None,
            release_version: None,
            manifest_location: None,
            install_size: None,
            process_names: None,
            main_window_process_name: None,
            b_is_application: None,
            b_is_executable: None,
            b_is_incomplete_install: None,
            b_can_run_offline: None,
            mandatory_app_folder_name: None,
        };
        assert!(compute_epic_provider_game_id(&manifest).is_none());
    }

    #[test]
    fn test_sanitize_for_filesystem() {
        assert_eq!(
            sanitize_for_filesystem("ns:catalog|id"),
            "ns_catalog_id"
        );
        assert_eq!(
            sanitize_for_filesystem("normal-name"),
            "normal-name"
        );
        assert_eq!(
            sanitize_for_filesystem("a<b>c\"d/e\\f|g?h*i"),
            "a_b_c_d_e_f_g_h_i"
        );
    }

    // ── Classification tests ───────────────────────────────────────

    #[test]
    fn test_classify_base_game() {
        let manifest: RawEpicManifest = serde_json::from_str(sample_installed_game()).unwrap();
        assert_eq!(classify_manifest(&manifest), EpicInstallClassification::BaseGame);
    }

    #[test]
    fn test_classify_dlc() {
        let manifest: RawEpicManifest = serde_json::from_str(sample_dlc()).unwrap();
        assert_eq!(classify_manifest(&manifest), EpicInstallClassification::Dlc);
    }

    #[test]
    fn test_classify_tool() {
        let manifest = RawEpicManifest {
            display_name: Some("Unreal Engine 5".to_string()),
            app_name: Some("UE5".to_string()),
            catalog_namespace: Some("engine-ns".to_string()),
            catalog_item_id: Some("engine-id".to_string()),
            install_location: Some("C:\\UE5".to_string()),
            launch_executable: None,
            launch_command: None,
            main_game_catalog_item_id: None,
            main_game_app_name: None,
            main_game_catalog_namespace: None,
            release_version: Some("5.0".to_string()),
            manifest_location: None,
            install_size: None,
            process_names: None,
            main_window_process_name: None,
            b_is_application: Some(false),
            b_is_executable: Some(false),
            b_is_incomplete_install: None,
            b_can_run_offline: None,
            mandatory_app_folder_name: None,
        };
        assert_eq!(classify_manifest(&manifest), EpicInstallClassification::Tool);
    }

    #[test]
    fn test_classify_unknown() {
        let manifest = RawEpicManifest {
            display_name: Some("Mystery".to_string()),
            app_name: Some("Mystery".to_string()),
            catalog_namespace: None,
            catalog_item_id: None,
            install_location: None,
            launch_executable: None,
            launch_command: None,
            main_game_catalog_item_id: None,
            main_game_app_name: None,
            main_game_catalog_namespace: None,
            release_version: None,
            manifest_location: None,
            install_size: None,
            process_names: None,
            main_window_process_name: None,
            b_is_application: None,
            b_is_executable: None,
            b_is_incomplete_install: None,
            b_can_run_offline: None,
            mandatory_app_folder_name: None,
        };
        assert_eq!(classify_manifest(&manifest), EpicInstallClassification::Unknown);
    }

    // ── Process name normalization tests ────────────────────────────

    #[test]
    fn test_normalize_process_names_dedup() {
        let manifest: RawEpicManifest = serde_json::from_str(sample_installed_game()).unwrap();
        let names = normalize_process_names(&manifest);
        assert!(names.contains(&"TestGame.exe".to_string()));
        assert!(names.contains(&"TestGameLauncher.exe".to_string()));
        // Should have exactly 2 unique names (TestGame.exe appears in ProcessNames and MainWindow)
        assert_eq!(names.len(), 2);
    }

    #[test]
    fn test_normalize_process_names_strips_paths() {
        let manifest = RawEpicManifest {
            display_name: None,
            app_name: None,
            catalog_namespace: None,
            catalog_item_id: None,
            install_location: None,
            launch_executable: Some("C:\\Games\\MyGame\\Binaries\\Game.exe".to_string()),
            launch_command: None,
            main_game_catalog_item_id: None,
            main_game_app_name: None,
            main_game_catalog_namespace: None,
            release_version: None,
            manifest_location: None,
            install_size: None,
            process_names: Some(vec![
                "SubDir\\Game.exe".to_string(),
                "Other.exe".to_string(),
            ]),
            main_window_process_name: None,
            b_is_application: None,
            b_is_executable: None,
            b_is_incomplete_install: None,
            b_can_run_offline: None,
            mandatory_app_folder_name: None,
        };
        let names = normalize_process_names(&manifest);
        // Should have Game.exe and Other.exe — no directory paths
        assert!(names.contains(&"Game.exe".to_string()));
        assert!(names.contains(&"Other.exe".to_string()));
        for name in &names {
            assert!(!name.contains('\\'), "process name should not contain path separator: {}", name);
            assert!(!name.contains('/'), "process name should not contain path separator: {}", name);
        }
    }

    #[test]
    fn test_normalize_process_names_empty() {
        let manifest = RawEpicManifest {
            display_name: None,
            app_name: None,
            catalog_namespace: None,
            catalog_item_id: None,
            install_location: None,
            launch_executable: None,
            launch_command: None,
            main_game_catalog_item_id: None,
            main_game_app_name: None,
            main_game_catalog_namespace: None,
            release_version: None,
            manifest_location: None,
            install_size: None,
            process_names: None,
            main_window_process_name: None,
            b_is_application: None,
            b_is_executable: None,
            b_is_incomplete_install: None,
            b_can_run_offline: None,
            mandatory_app_folder_name: None,
        };
        let names = normalize_process_names(&manifest);
        assert!(names.is_empty());
    }

    // ── Path safety tests ──────────────────────────────────────────

    #[test]
    fn test_resolve_executable_relative() {
        let (path, _exists, warning) =
            resolve_executable_path("C:\\Games\\MyGame", "Binaries\\Game.exe");
        assert!(warning.is_none());
        let p = path.unwrap();
        assert!(p.ends_with("Binaries\\Game.exe") || p.ends_with("Binaries/Game.exe"));
    }

    #[test]
    fn test_resolve_executable_empty_install_dir() {
        let (path, exists, warning) = resolve_executable_path("", "game.exe");
        assert!(path.is_none());
        assert!(!exists);
        assert!(warning.is_some());
    }

    #[test]
    fn test_resolve_executable_empty_exec() {
        let (path, exists, warning) = resolve_executable_path("C:\\Games", "");
        assert!(path.is_none());
        assert!(!exists);
        assert!(warning.is_some());
    }

    #[test]
    fn test_resolve_executable_traversal_detected() {
        let (path, exists, warning) =
            resolve_executable_path("C:\\Games\\MyGame", "..\\..\\Windows\\System32\\evil.exe");
        assert!(path.is_none());
        assert!(!exists);
        assert!(warning.is_some());
        assert!(warning.unwrap().contains("path traversal"));
    }

    // ── Malformed manifest isolation ────────────────────────────────

    #[test]
    fn test_parse_malformed_json() {
        let result = parse_manifest_file(Path::new("nonexistent.json"));
        assert!(result.is_none());
    }

    #[test]
    fn test_scan_isolates_malformed_files() {
        let (tmp, dir) = setup_manifest_dir();
        write_manifest(&dir, "good.item", sample_installed_game());
        write_manifest(&dir, "bad.item", "{ not valid json }");
        write_manifest(&dir, "empty.item", "");

        // Scan using the temp dir as manifest directory
        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.scanned_file_count, 3);
        assert_eq!(result.valid_manifest_count, 1);
        assert_eq!(result.invalid_manifest_count, 2);
        assert_eq!(result.games.len(), 1);
        assert_eq!(result.games[0].app_name.as_deref(), Some("TestGame"));

        drop(tmp);
    }

    // ── Unicode handling ───────────────────────────────────────────

    #[test]
    fn test_unicode_game() {
        let (tmp, dir) = setup_manifest_dir();
        write_manifest(&dir, "unicode.item", sample_unicode_game());

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.games.len(), 1);
        assert_eq!(
            result.games[0].display_name.as_deref(),
            Some("Ünïcödé Spïël 日本語テスト")
        );
        assert_eq!(
            result.games[0].provider_game_id,
            "unic-1234-od-5678:unic-9876-dcba-8765"
        );

        drop(tmp);
    }

    // ── Spaces in paths ────────────────────────────────────────────

    #[test]
    fn test_spaces_in_path() {
        let (tmp, dir) = setup_manifest_dir();
        write_manifest(&dir, "spaces.item", sample_spaces_path());

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.games.len(), 1);
        assert!(result.games[0]
            .install_location
            .as_ref()
            .unwrap()
            .contains("My Games"));

        drop(tmp);
    }

    // ── Duplicate deduplication ─────────────────────────────────────

    #[test]
    fn test_deduplication_keeps_better_record() {
        let (tmp, dir) = setup_manifest_dir();

        // First record: incomplete
        let incomplete = r#"{
            "DisplayName": "Dup Game",
            "AppName": "DupGame",
            "CatalogNamespace": "ns-dup",
            "CatalogItemId": "id-dup",
            "InstallLocation": "C:\\Games\\Dup",
            "LaunchExecutable": "game.exe",
            "bIsIncompleteInstall": true,
            "bIsApplication": true
        }"#;

        // Second record: complete
        let complete = r#"{
            "DisplayName": "Dup Game",
            "AppName": "DupGame",
            "CatalogNamespace": "ns-dup",
            "CatalogItemId": "id-dup",
            "InstallLocation": "C:\\Games\\Dup",
            "LaunchExecutable": "game.exe",
            "bIsIncompleteInstall": false,
            "bIsApplication": true
        }"#;

        write_manifest(&dir, "dup1.item", incomplete);
        write_manifest(&dir, "dup2.item", complete);

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.games.len(), 1);
        assert!(!result.games[0].incomplete_install);
        assert_eq!(result.duplicate_count, 1);

        drop(tmp);
    }

    // ── Empty/missing directory ─────────────────────────────────────

    #[test]
    fn test_empty_manifest_directory() {
        let (tmp, dir) = setup_manifest_dir();
        // No .item files

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.scanned_file_count, 0);
        assert_eq!(result.games.len(), 0);
        assert!(result.directory_exists);

        drop(tmp);
    }

    #[test]
    fn test_missing_manifest_directory() {
        let result = run_epic_scan(Some("/nonexistent/path/that/does/not/exist"));
        assert!(!result.directory_exists);
        assert_eq!(result.scanned_file_count, 0);
        assert_eq!(result.games.len(), 0);
        assert!(!result.warnings.is_empty());
    }

    // ── DLC classification ─────────────────────────────────────────

    #[test]
    fn test_dlc_classification() {
        let (tmp, dir) = setup_manifest_dir();
        write_manifest(&dir, "base.item", sample_installed_game());
        write_manifest(&dir, "dlc.item", sample_dlc());

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.games.len(), 2);

        let base = result.games.iter().find(|g| g.classification == EpicInstallClassification::BaseGame);
        assert!(base.is_some());
        assert_eq!(base.unwrap().app_name.as_deref(), Some("TestGame"));

        let dlc = result.games.iter().find(|g| g.classification == EpicInstallClassification::Dlc);
        assert!(dlc.is_some());
        assert_eq!(dlc.unwrap().main_game_app_name.as_deref(), Some("TestGame"));

        drop(tmp);
    }

    // ── Scan result envelope completeness ───────────────────────────

    #[test]
    fn test_scan_result_envelope() {
        let (tmp, dir) = setup_manifest_dir();
        write_manifest(&dir, "good.item", sample_installed_game());
        write_manifest(&dir, "bad.item", "not json");

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.scanned_file_count, 2);
        assert_eq!(result.valid_manifest_count, 1);
        assert_eq!(result.invalid_manifest_count, 1);
        assert_eq!(result.duplicate_count, 0);
        assert!(!result.manifest_directory.is_empty());
        assert!(result.directory_exists);
        assert!(!result.scanned_at.is_empty());
        // ISO 8601 format check
        assert!(result.scanned_at.ends_with('Z'));

        drop(tmp);
    }

    // ── Multiple valid games ────────────────────────────────────────

    #[test]
    fn test_multiple_valid_games() {
        let (tmp, dir) = setup_manifest_dir();
        write_manifest(&dir, "game1.item", sample_installed_game());
        write_manifest(&dir, "game2.item", sample_unicode_game());
        write_manifest(&dir, "game3.item", sample_spaces_path());

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.games.len(), 3);
        assert_eq!(result.valid_manifest_count, 3);
        assert_eq!(result.invalid_manifest_count, 0);

        // All have valid identity
        for game in &result.games {
            assert!(!game.provider_game_id.is_empty());
            assert_eq!(game.provider_id, "epic");
        }

        drop(tmp);
    }

    // ── Non-.item files ignored ─────────────────────────────────────

    #[test]
    fn test_non_item_files_ignored() {
        let (tmp, dir) = setup_manifest_dir();
        write_manifest(&dir, "game.item", sample_installed_game());
        write_manifest(&dir, "readme.txt", "hello");
        write_manifest(&dir, "config.json", "{}");

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.scanned_file_count, 1);
        assert_eq!(result.games.len(), 1);

        drop(tmp);
    }

    // ── Manifest without namespace (identity fallback) ──────────────

    #[test]
    fn test_manifest_without_namespace_uses_appname() {
        let manifest_json = r#"{
            "DisplayName": "No NS Game",
            "AppName": "NoNSGame",
            "InstallLocation": "C:\\Games\\NoNS",
            "LaunchExecutable": "game.exe",
            "bIsApplication": true
        }"#;

        let (tmp, dir) = setup_manifest_dir();
        write_manifest(&dir, "nons.item", manifest_json);

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.games.len(), 1);
        // Falls back to appName only
        assert_eq!(result.games[0].provider_game_id, "NoNSGame");
        assert!(result.games[0].namespace.is_none());

        drop(tmp);
    }

    // ── Manifest without catalogItemId ──────────────────────────────

    #[test]
    fn test_manifest_without_catalog_item_id_uses_namespace_appname() {
        let manifest_json = r#"{
            "DisplayName": "No CID Game",
            "AppName": "NoCIDGame",
            "CatalogNamespace": "ns-only-1234",
            "InstallLocation": "C:\\Games\\NoCID",
            "LaunchExecutable": "game.exe",
            "bIsApplication": true
        }"#;

        let (tmp, dir) = setup_manifest_dir();
        write_manifest(&dir, "nocid.item", manifest_json);

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.games.len(), 1);
        // Falls back to namespace + appName
        assert_eq!(result.games[0].provider_game_id, "ns-only-1234:NoCIDGame");
        assert!(result.games[0].catalog_item_id.is_none());

        drop(tmp);
    }

    // ── Stale manifest detection ────────────────────────────────────

    #[test]
    fn test_stale_manifest() {
        let manifest_json = r#"{
            "DisplayName": "Stale Game",
            "AppName": "StaleGame",
            "CatalogNamespace": "stale-ns",
            "CatalogItemId": "stale-id",
            "InstallLocation": "C:\\This\\Path\\Does\\Not\\Exist",
            "LaunchExecutable": "game.exe",
            "bIsApplication": true
        }"#;

        let (tmp, dir) = setup_manifest_dir();
        write_manifest(&dir, "stale.item", manifest_json);

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.games.len(), 1);
        assert!(!result.games[0].installed);
        assert_eq!(result.stale_manifest_count, 1);

        drop(tmp);
    }

    // ── Incomplete install detection ────────────────────────────────

    #[test]
    fn test_incomplete_install() {
        let manifest_json = r#"{
            "DisplayName": "Incomplete Game",
            "AppName": "IncompleteGame",
            "InstallLocation": "C:\\Games\\Incomplete",
            "LaunchExecutable": "game.exe",
            "bIsApplication": true,
            "bIsIncompleteInstall": true
        }"#;

        let (tmp, dir) = setup_manifest_dir();
        write_manifest(&dir, "inc.item", manifest_json);

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.games.len(), 1);
        assert!(result.games[0].incomplete_install);
        assert!(!result.games[0].installed);
        assert_eq!(result.incomplete_install_count, 1);

        drop(tmp);
    }

    // ── ProgramData path construction ───────────────────────────────

    #[test]
    fn test_resolve_manifest_directory_with_override() {
        let dir = resolve_manifest_directory(Some("/custom/path"));
        assert_eq!(dir, PathBuf::from("/custom/path"));
    }

    #[test]
    fn test_resolve_manifest_directory_default() {
        let dir = resolve_manifest_directory(None);
        // Should end with the relative path
        let path_str = dir.to_string_lossy();
        assert!(path_str.contains("Epic"));
        assert!(path_str.contains("Manifests"));
    }

    // ── Self-referential main game fields (base game, not DLC) ──────

    #[test]
    fn test_self_referential_main_game_catalog_item_id() {
        // Base game whose manifest has MainGameCatalogItemId == CatalogItemId
        // (self-referencing). Must be classified as BaseGame, not Dlc.
        let manifest_json = r#"{
            "DisplayName": "Self Ref Game",
            "AppName": "SelfRefGame",
            "CatalogNamespace": "ns-selfref-1234",
            "CatalogItemId": "cid-selfref-5678",
            "InstallLocation": "C:\\Games\\SelfRef",
            "LaunchExecutable": "game.exe",
            "bIsApplication": true,
            "MainGameCatalogItemId": "cid-selfref-5678",
            "MainGameCatalogNamespace": "ns-selfref-1234"
        }"#;

        let (tmp, dir) = setup_manifest_dir();
        write_manifest(&dir, "selfref.item", manifest_json);

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.games.len(), 1);
        assert_eq!(result.games[0].classification, EpicInstallClassification::BaseGame);
        assert_eq!(result.games[0].main_game_catalog_item_id.as_deref(), Some("cid-selfref-5678"));

        drop(tmp);
    }

    #[test]
    fn test_self_referential_main_game_app_name() {
        // Base game with MainGameAppName == AppName (self-referencing)
        let manifest_json = r#"{
            "DisplayName": "Self Ref Name Game",
            "AppName": "SelfRefNameGame",
            "CatalogNamespace": "ns-srn-1234",
            "CatalogItemId": "cid-srn-5678",
            "InstallLocation": "C:\\Games\\SelfRefName",
            "LaunchExecutable": "game.exe",
            "bIsApplication": true,
            "MainGameAppName": "SelfRefNameGame"
        }"#;

        let (tmp, dir) = setup_manifest_dir();
        write_manifest(&dir, "selfref.item", manifest_json);

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.games.len(), 1);
        assert_eq!(result.games[0].classification, EpicInstallClassification::BaseGame);

        drop(tmp);
    }

    #[test]
    fn test_self_referential_both_main_game_fields() {
        // Base game with both MainGameCatalogItemId and MainGameAppName self-referencing
        let manifest_json = r#"{
            "DisplayName": "Both Self Ref",
            "AppName": "BothSelfRef",
            "CatalogNamespace": "ns-bsr-1234",
            "CatalogItemId": "cid-bsr-5678",
            "InstallLocation": "C:\\Games\\BothSelfRef",
            "LaunchExecutable": "game.exe",
            "bIsApplication": true,
            "MainGameCatalogItemId": "cid-bsr-5678",
            "MainGameAppName": "BothSelfRef",
            "MainGameCatalogNamespace": "ns-bsr-1234"
        }"#;

        let (tmp, dir) = setup_manifest_dir();
        write_manifest(&dir, "selfref.item", manifest_json);

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.games.len(), 1);
        assert_eq!(result.games[0].classification, EpicInstallClassification::BaseGame);

        drop(tmp);
    }

    #[test]
    fn test_genuine_dlc_different_main_game() {
        // DLC that references a DIFFERENT base game → must stay Dlc
        let manifest_json = r#"{
            "DisplayName": "Real DLC",
            "AppName": "RealDLC",
            "CatalogNamespace": "ns-dlc-1234",
            "CatalogItemId": "cid-dlc-5678",
            "InstallLocation": "C:\\Games\\RealDLC",
            "LaunchExecutable": "",
            "bIsApplication": false,
            "MainGameCatalogItemId": "cid-base-9999",
            "MainGameAppName": "DifferentBaseGame"
        }"#;

        let (tmp, dir) = setup_manifest_dir();
        write_manifest(&dir, "dlc.item", manifest_json);

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.games.len(), 1);
        assert_eq!(result.games[0].classification, EpicInstallClassification::Dlc);

        drop(tmp);
    }

    #[test]
    fn test_self_referential_no_launch_executable_with_bisapplication() {
        // Self-referencing base game with LaunchExecutable set
        // (common real-world pattern). Uses a temp dir so installed=true.
        let (tmp, dir) = setup_manifest_dir();
        let game_dir = dir.join("GameDir");
        std::fs::create_dir(&game_dir).unwrap();

        let manifest_json = format!(r#"{{
            "DisplayName": "Real Epic Game",
            "AppName": "RealEpicGame",
            "CatalogNamespace": "ns-real-1234",
            "CatalogItemId": "cid-real-5678",
            "InstallLocation": "{}",
            "LaunchExecutable": "Binaries\\\\Win64\\\\Game.exe",
            "bIsApplication": true,
            "bIsIncompleteInstall": false,
            "MainGameCatalogItemId": "cid-real-5678",
            "MainGameCatalogNamespace": "ns-real-1234"
        }}"#, game_dir.to_string_lossy().replace('\\', "\\\\"));

        write_manifest(&dir, "real.item", &manifest_json);

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.games.len(), 1);
        assert_eq!(result.games[0].classification, EpicInstallClassification::BaseGame,
            "self-referencing manifest must be BaseGame, not Dlc");
        assert!(!result.games[0].incomplete_install);

        drop(tmp);
    }

    #[test]
    fn test_bisapplication_overrides_non_self_referring_main_game() {
        // Real-world scenario: base game manifest with bIsApplication=true
        // AND a MainGameCatalogItemId that does NOT match the game's own
        // CatalogItemId (or CatalogItemId is absent).  The application flag
        // should win — this is still a base game, not DLC.
        let (tmp, dir) = setup_manifest_dir();
        let game_dir = dir.join("GameDir");
        std::fs::create_dir(&game_dir).unwrap();

        let manifest_json = format!(r#"{{
            "DisplayName": "Some Real Game",
            "AppName": "SomeRealGame",
            "CatalogNamespace": "ns-1234",
            "CatalogItemId": "cid-AAAA",
            "InstallLocation": "{}",
            "LaunchExecutable": "Game.exe",
            "bIsApplication": true,
            "bIsIncompleteInstall": false,
            "MainGameCatalogItemId": "cid-BBBB",
            "MainGameAppName": "SomeRealGame"
        }}"#, game_dir.to_string_lossy().replace('\\', "\\\\"));

        write_manifest(&dir, "real.item", &manifest_json);

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.games.len(), 1);
        assert_eq!(result.games[0].classification, EpicInstallClassification::BaseGame,
            "bIsApplication=true with launch executable must be BaseGame even when MainGameCatalogItemId differs");
        assert_eq!(result.games[0].app_name.as_deref(), Some("SomeRealGame"));

        drop(tmp);
    }

    #[test]
    fn test_absent_catalog_item_id_with_main_game_is_dlc() {
        // When CatalogItemId is absent (can't self-reference) and
        // MainGameCatalogItemId is present, and no bIsApplication/launchExec,
        // classify as DLC — the game genuinely references a different parent.
        let (tmp, dir) = setup_manifest_dir();

        let manifest_json = r#"{
            "DisplayName": "Some Add-on",
            "AppName": "SomeAddon",
            "CatalogNamespace": "ns-addon",
            "MainGameCatalogItemId": "cid-parent-different",
            "MainGameAppName": "ParentGame",
            "bIsIncompleteInstall": false
        }"#;

        write_manifest(&dir, "addon.item", manifest_json);

        let result = run_epic_scan(Some(dir.to_str().unwrap()));

        assert_eq!(result.games.len(), 1);
        assert_eq!(result.games[0].classification, EpicInstallClassification::Dlc,
            "absent CatalogItemId with different MainGameCatalogItemId = DLC");
        assert!(!result.games[0].installed);

        drop(tmp);
    }

    // ── Serialization alignment tests ───────────────────────────────

    #[test]
    fn test_classification_serialization_camel_case() {
        use serde_json;

        let game = EpicInstalledGame {
            provider_id: "epic".to_string(),
            provider_game_id: "test".to_string(),
            namespace: None,
            catalog_item_id: None,
            app_name: None,
            display_name: None,
            install_location: None,
            launch_executable: None,
            executable_path: None,
            launch_arguments: None,
            release_version: None,
            install_size: None,
            manifest_path: None,
            process_names: vec![],
            main_game_app_name: None,
            main_game_catalog_item_id: None,
            main_game_catalog_namespace: None,
            installed: true,
            executable_exists: false,
            manifest_valid: true,
            incomplete_install: false,
            can_run_offline: false,
            classification: EpicInstallClassification::BaseGame,
            source_kind: EpicInstallSourceKind::Native,
            warnings: vec![],
        };

        let json = serde_json::to_value(&game).unwrap();
        // Verify camelCase serialization matches TypeScript expectations
        assert_eq!(json["classification"], "baseGame");
        assert_eq!(json["sourceKind"], "native");
        assert_eq!(json["providerGameId"], "test");
        assert_eq!(json["manifestValid"], true);
        assert_eq!(json["installed"], true);
        assert_eq!(json["incompleteInstall"], false);
        assert_eq!(json["executableExists"], false);

        // Test all classification variants
        let variants = [
            (EpicInstallClassification::BaseGame, "baseGame"),
            (EpicInstallClassification::Dlc, "dlc"),
            (EpicInstallClassification::Addon, "addon"),
            (EpicInstallClassification::Tool, "tool"),
            (EpicInstallClassification::Unknown, "unknown"),
        ];
        for (variant, expected) in &variants {
            let mut g = game.clone();
            g.classification = *variant;
            let j = serde_json::to_value(&g).unwrap();
            assert_eq!(j["classification"], *expected, "classification {:?} serialized wrong", variant);
        }

        // Test source kind variants
        let source_variants = [
            (EpicInstallSourceKind::Native, "native"),
            (EpicInstallSourceKind::ThirdPartyManaged, "thirdPartyManaged"),
        ];
        for (variant, expected) in &source_variants {
            let mut g = game.clone();
            g.source_kind = *variant;
            let j = serde_json::to_value(&g).unwrap();
            assert_eq!(j["sourceKind"], *expected, "sourceKind {:?} serialized wrong", variant);
        }
    }
}
