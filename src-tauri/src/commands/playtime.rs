use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::AppHandle;
use tauri::Manager;
use uuid::Uuid;

use crate::models::playtime::{
    ActivePlaySession, ExternalPlaytimeImport, PlaySessionEnd, PlaySessionStart, PlaytimeEntry,
    PlaytimeSession, PlaytimeStore, MAX_SESSIONS_PER_GAME, PLAYTIME_STORE_VERSION,
};

fn get_playtime_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let dir = app_dir.join("activity").join("playtime");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create playtime dir: {}", e))?;
    Ok(dir)
}

fn get_playtime_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_playtime_dir(app_handle)?.join("playtime.json"))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn read_store(app_handle: &AppHandle) -> PlaytimeStore {
    let path = match get_playtime_path(app_handle) {
        Ok(p) => p,
        Err(_) => return empty_store(),
    };

    if !path.exists() {
        return empty_store();
    }

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<PlaytimeStore>(&content) {
            Ok(store) => store,
            Err(e) => {
                println!("[Playtime] corrupt store ({}), returning empty", e);
                empty_store()
            }
        },
        Err(e) => {
            println!("[Playtime] read error ({}), returning empty", e);
            empty_store()
        }
    }
}

fn write_store(app_handle: &AppHandle, store: &PlaytimeStore) -> Result<(), String> {
    let path = get_playtime_path(app_handle)?;
    let tmp_path = path.with_extension("tmp.json");

    let json =
        serde_json::to_string_pretty(store).map_err(|e| format!("Failed to serialize: {}", e))?;

    fs::write(&tmp_path, &json).map_err(|e| format!("Failed to write temp file: {}", e))?;
    fs::rename(&tmp_path, &path).map_err(|e| format!("Failed to rename file: {}", e))?;

    Ok(())
}

fn empty_store() -> PlaytimeStore {
    PlaytimeStore {
        version: PLAYTIME_STORE_VERSION,
        updated_at: now_secs(),
        games: HashMap::new(),
    }
}

fn ensure_entry(
    store: &mut PlaytimeStore,
    game_key: &str,
    app_id: Option<String>,
    provider: &str,
    title: &str,
) {
    let key = game_key.to_string();
    let prov = provider.to_string();
    let t = title.to_string();
    store.games.entry(key).or_insert_with(|| PlaytimeEntry {
        game_key: game_key.to_string(),
        app_id,
        provider: prov,
        title: t,
        external_playtime_seconds: 0,
        external_source: None,
        external_imported_at: None,
        local_playtime_seconds: 0,
        total_playtime_seconds: 0,
        last_played_at: None,
        last_session_seconds: None,
        sessions: Vec::new(),
    });
}

fn update_external(entry: &mut PlaytimeEntry, external_seconds: u64, external_source: &str) {
    if external_seconds > entry.external_playtime_seconds {
        entry.external_playtime_seconds = external_seconds;
        entry.external_source = Some(external_source.to_string());
        entry.external_imported_at = Some(now_secs());
    }
    entry.total_playtime_seconds = entry.external_playtime_seconds + entry.local_playtime_seconds;
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_playtime_store(app_handle: AppHandle) -> Result<PlaytimeStore, String> {
    Ok(read_store(&app_handle))
}

#[tauri::command]
pub fn write_playtime_store(
    app_handle: AppHandle,
    store: PlaytimeStore,
) -> Result<(), String> {
    write_store(&app_handle, &store)
}

#[tauri::command]
pub fn record_play_session_start(
    app_handle: AppHandle,
    input: PlaySessionStart,
) -> Result<ActivePlaySession, String> {
    let mut store = read_store(&app_handle);
    let session_id = Uuid::new_v4().to_string();
    let game_key = input.game_key.clone();

    ensure_entry(
        &mut store,
        &input.game_key,
        input.app_id,
        &input.provider,
        &input.title,
    );

    let entry = store.games.get_mut(&input.game_key).unwrap();
    while entry.sessions.len() >= MAX_SESSIONS_PER_GAME {
        entry.sessions.remove(0);
    }

    entry.sessions.push(PlaytimeSession {
        session_id: session_id.clone(),
        started_at: input.started_at,
        ended_at: None,
        duration_seconds: None,
        exit_reason: None,
    });

    entry.last_played_at = Some(input.started_at);

    store.updated_at = now_secs();
    write_store(&app_handle, &store)?;

    Ok(ActivePlaySession {
        session_id,
        started_at: input.started_at,
        game_key,
    })
}

#[tauri::command]
pub fn record_play_session_end(
    app_handle: AppHandle,
    input: PlaySessionEnd,
) -> Result<PlaytimeEntry, String> {
    let mut store = read_store(&app_handle);
    let game_key = input.game_key.clone();

    let has_entry = store
        .games
        .get(&game_key)
        .map(|e| e.sessions.iter().any(|s| s.session_id == input.session_id))
        .unwrap_or(false);

    if !has_entry {
        return Err(format!("Session not found: {}", input.session_id));
    }

    // Guard: prevent duplicate end
    if store
        .games
        .get(&game_key)
        .and_then(|e| {
            e.sessions
                .iter()
                .find(|s| s.session_id == input.session_id)
        })
        .and_then(|s| s.ended_at)
        .is_some()
    {
        let entry = store.games.get(&game_key).unwrap().clone();
        return Ok(entry);
    }

    let duration;
    {
        let entry = store.games.get_mut(&game_key).unwrap();
        let session = entry
            .sessions
            .iter_mut()
            .find(|s| s.session_id == input.session_id)
            .unwrap();

        session.ended_at = Some(input.ended_at);
        session.exit_reason = Some(input.exit_reason.clone());

        duration = input.ended_at.saturating_sub(session.started_at);
        session.duration_seconds = Some(duration);

        entry.local_playtime_seconds += duration;
        entry.total_playtime_seconds = entry.external_playtime_seconds + entry.local_playtime_seconds;
        entry.last_played_at = Some(input.ended_at);
        entry.last_session_seconds = Some(duration);
    }

    store.updated_at = now_secs();
    write_store(&app_handle, &store)?;

    let entry = store.games.get(&game_key).unwrap().clone();
    Ok(entry)
}

#[tauri::command]
pub fn import_external_playtime(
    app_handle: AppHandle,
    input: ExternalPlaytimeImport,
) -> Result<PlaytimeEntry, String> {
    let mut store = read_store(&app_handle);

    let title = input.title.clone().unwrap_or_else(|| "Unknown".to_string());

    ensure_entry(
        &mut store,
        &input.game_key,
        input.app_id,
        &input.provider,
        &title,
    );

    {
        let entry = store.games.get_mut(&input.game_key).unwrap();
        update_external(entry, input.external_playtime_seconds, &input.external_source);
    }

    store.updated_at = now_secs();
    write_store(&app_handle, &store)?;

    let entry = store.games.get(&input.game_key).unwrap().clone();
    Ok(entry)
}
