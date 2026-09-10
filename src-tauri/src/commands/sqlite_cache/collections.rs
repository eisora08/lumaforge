use std::sync::Mutex;
use std::fs;

use base64::Engine;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use super::SqliteCoreDb;

// ---------------------------------------------------------------------------
// Collections — user-defined game collections with nesting support.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub position: i32,
    pub color: Option<String>,
    pub cover_path: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionItem {
    pub id: i64,
    pub collection_id: String,
    pub game_id: String,
    pub position: i32,
    pub added_at: i64,
}

pub fn create_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS collections (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            parent_id   TEXT,
            position    INTEGER NOT NULL DEFAULT 0,
            color       TEXT,
            cover_path  TEXT,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_collections_parent_id ON collections(parent_id);

        CREATE TABLE IF NOT EXISTS collection_items (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id  TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            game_id        TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            position       INTEGER NOT NULL DEFAULT 0,
            added_at       INTEGER NOT NULL,
            UNIQUE(collection_id, game_id)
        );

        CREATE INDEX IF NOT EXISTS idx_collection_items_collection_id ON collection_items(collection_id);
        CREATE INDEX IF NOT EXISTS idx_collection_items_game_id ON collection_items(game_id);
        ",
    )
    .map_err(|e| format!("Failed to create collections tables: {}", e))?;
    Ok(())
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn uuid_simple() -> String {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:016x}", t)
}

// ---------------------------------------------------------------------------
// Inner: Collections CRUD
// ---------------------------------------------------------------------------

pub fn get_all_collections_inner(db: &Mutex<Connection>) -> Result<Vec<Collection>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, name, parent_id, position, color, cover_path, created_at, updated_at
             FROM collections ORDER BY position ASC, name ASC",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let entries = stmt
        .query_map([], |row| {
            Ok(Collection {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                position: row.get(3)?,
                color: row.get(4)?,
                cover_path: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(entries)
}

pub fn get_collection_items_inner(
    db: &Mutex<Connection>,
    collection_id: &str,
) -> Result<Vec<CollectionItem>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, collection_id, game_id, position, added_at
             FROM collection_items
             WHERE collection_id = ?1
             ORDER BY position ASC",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let items = stmt
        .query_map([collection_id], |row| {
            Ok(CollectionItem {
                id: row.get(0)?,
                collection_id: row.get(1)?,
                game_id: row.get(2)?,
                position: row.get(3)?,
                added_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(items)
}

pub fn create_collection_inner(
    db: &Mutex<Connection>,
    name: &str,
    parent_id: Option<&str>,
    color: Option<&str>,
    cover_path: Option<&str>,
) -> Result<Collection, String> {
    let conn = db.lock().unwrap();
    let ts = now();

    let max_pos: i32 = if let Some(pid) = parent_id {
        conn.query_row(
            "SELECT COALESCE(MAX(position), -1) FROM collections WHERE parent_id = ?1",
            [pid],
            |row| row.get(0),
        )
        .unwrap_or(-1)
    } else {
        conn.query_row(
            "SELECT COALESCE(MAX(position), -1) FROM collections WHERE parent_id IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap_or(-1)
    };

    let new_pos = max_pos + 1;
    let id = format!("col-{}", uuid_simple());
    let parent_val: Option<String> = parent_id.map(|s| s.to_string());

    conn.execute(
        "INSERT INTO collections (id, name, parent_id, position, color, cover_path, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, name, parent_val, new_pos, color, cover_path, ts, ts],
    )
    .map_err(|e| format!("Insert error: {}", e))?;

    Ok(Collection {
        id,
        name: name.to_string(),
        parent_id: parent_val,
        position: new_pos,
        color: color.map(|s| s.to_string()),
        cover_path: cover_path.map(|s| s.to_string()),
        created_at: ts,
        updated_at: ts,
    })
}

pub fn update_collection_inner(
    db: &Mutex<Connection>,
    collection_id: &str,
    name: Option<&str>,
    color: Option<&str>,
    cover_path: Option<&str>,
    parent_id: Option<&str>,
    position: Option<i32>,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    let ts = now();

    if let Some(n) = name {
        conn.execute(
            "UPDATE collections SET name = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![n, ts, collection_id],
        )
        .map_err(|e| format!("Update name error: {}", e))?;
    }

    if let Some(c) = color {
        conn.execute(
            "UPDATE collections SET color = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![c, ts, collection_id],
        )
        .map_err(|e| format!("Update color error: {}", e))?;
    }

    if let Some(cp) = cover_path {
        conn.execute(
            "UPDATE collections SET cover_path = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![cp, ts, collection_id],
        )
        .map_err(|e| format!("Update cover error: {}", e))?;
    }

    if let Some(pid) = parent_id {
        conn.execute(
            "UPDATE collections SET parent_id = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![pid, ts, collection_id],
        )
        .map_err(|e| format!("Update parent_id error: {}", e))?;
    }

    if let Some(p) = position {
        conn.execute(
            "UPDATE collections SET position = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![p, ts, collection_id],
        )
        .map_err(|e| format!("Update position error: {}", e))?;
    }

    Ok(())
}

pub fn delete_collection_inner(
    db: &Mutex<Connection>,
    collection_id: &str,
) -> Result<(), String> {
    let conn = db.lock().unwrap();

    let sub_ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM collections WHERE parent_id = ?1")
            .map_err(|e| format!("Query error: {}", e))?;
        let rows: Vec<String> = stmt
            .query_map([collection_id], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Query error: {}", e))?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    for sub_id in &sub_ids {
        conn.execute("DELETE FROM collections WHERE id = ?1", [sub_id])
            .map_err(|e| format!("Delete sub-collection error: {}", e))?;
    }

    conn.execute("DELETE FROM collections WHERE id = ?1", [collection_id])
        .map_err(|e| format!("Delete collection error: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Inner: Collection Items CRUD
// ---------------------------------------------------------------------------

pub fn add_game_to_collection_inner(
    db: &Mutex<Connection>,
    collection_id: &str,
    game_id: &str,
) -> Result<CollectionItem, String> {
    let conn = db.lock().unwrap();

    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM collection_items WHERE collection_id = ?1 AND game_id = ?2",
            rusqlite::params![collection_id, game_id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);

    if exists {
        return Err("Game already in collection".into());
    }

    let ts = now();

    let max_pos: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM collection_items WHERE collection_id = ?1",
            [collection_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    let new_pos = max_pos + 1;

    conn.execute(
        "INSERT INTO collection_items (collection_id, game_id, position, added_at)
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![collection_id, game_id, new_pos, ts],
    )
    .map_err(|e| format!("Insert error: {}", e))?;

    let inserted_id: i64 = conn.last_insert_rowid();

    Ok(CollectionItem {
        id: inserted_id,
        collection_id: collection_id.to_string(),
        game_id: game_id.to_string(),
        position: new_pos,
        added_at: ts,
    })
}

pub fn remove_game_from_collection_inner(
    db: &Mutex<Connection>,
    collection_id: &str,
    game_id: &str,
) -> Result<(), String> {
    let conn = db.lock().unwrap();

    let deleted = conn
        .execute(
            "DELETE FROM collection_items WHERE collection_id = ?1 AND game_id = ?2",
            rusqlite::params![collection_id, game_id],
        )
        .map_err(|e| format!("Delete error: {}", e))?;

    if deleted == 0 {
        return Err("Game not in collection".into());
    }

    let mut stmt = conn
        .prepare(
            "SELECT id FROM collection_items WHERE collection_id = ?1 ORDER BY position ASC",
        )
        .map_err(|e| format!("Query error: {}", e))?;
    let item_ids: Vec<i64> = stmt
        .query_map([collection_id], |row| row.get::<_, i64>(0))
        .map_err(|e| format!("Query error: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    for (i, id) in item_ids.iter().enumerate() {
        conn.execute(
            "UPDATE collection_items SET position = ?1 WHERE id = ?2",
            rusqlite::params![i as i32, id],
        )
        .map_err(|e| format!("Reorder error: {}", e))?;
    }

    Ok(())
}

pub fn reorder_collection_items_inner(
    db: &Mutex<Connection>,
    collection_id: &str,
    game_ids: &[String],
) -> Result<(), String> {
    let conn = db.lock().unwrap();

    for (i, game_id) in game_ids.iter().enumerate() {
        conn.execute(
            "UPDATE collection_items SET position = ?1 WHERE collection_id = ?2 AND game_id = ?3",
            rusqlite::params![i as i32, collection_id, game_id],
        )
        .map_err(|e| format!("Reorder error for {}: {}", game_id, e))?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_all_collections(
    state: tauri::State<'_, SqliteCoreDb>,
) -> Result<Vec<Collection>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(vec![]);
    };
    get_all_collections_inner(db)
}

#[tauri::command]
pub fn get_collection_items(
    state: tauri::State<'_, SqliteCoreDb>,
    collection_id: String,
) -> Result<Vec<CollectionItem>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(vec![]);
    };
    get_collection_items_inner(db, &collection_id)
}

#[tauri::command]
pub fn create_collection(
    app: tauri::AppHandle,
    state: tauri::State<'_, SqliteCoreDb>,
    name: String,
    parent_id: Option<String>,
    color: Option<String>,
    cover_path: Option<String>,
) -> Result<Collection, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Err("Database not initialized".into());
    };
    let collection = create_collection_inner(
        db,
        &name,
        parent_id.as_deref(),
        color.as_deref(),
        cover_path.as_deref(),
    )?;
    crate::utils::progress_utils::emit_data_changed(&app, "collections-changed", &collection.id);
    Ok(collection)
}

#[tauri::command]
pub fn update_collection(
    app: tauri::AppHandle,
    state: tauri::State<'_, SqliteCoreDb>,
    id: String,
    name: Option<String>,
    color: Option<String>,
    cover_path: Option<String>,
    parent_id: Option<String>,
    position: Option<i32>,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Err("Database not initialized".into());
    };
    update_collection_inner(
        db,
        &id,
        name.as_deref(),
        color.as_deref(),
        cover_path.as_deref(),
        parent_id.as_deref(),
        position,
    )?;
    crate::utils::progress_utils::emit_data_changed(&app, "collections-changed", &id);
    Ok(())
}

#[tauri::command]
pub fn delete_collection(
    app: tauri::AppHandle,
    state: tauri::State<'_, SqliteCoreDb>,
    id: String,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Err("Database not initialized".into());
    };
    delete_collection_inner(db, &id)?;
    crate::utils::progress_utils::emit_data_changed(&app, "collections-changed", &id);
    Ok(())
}

#[tauri::command]
pub fn add_game_to_collection(
    app: tauri::AppHandle,
    state: tauri::State<'_, SqliteCoreDb>,
    collection_id: String,
    game_id: String,
) -> Result<CollectionItem, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Err("Database not initialized".into());
    };
    let item = add_game_to_collection_inner(db, &collection_id, &game_id)?;
    crate::utils::progress_utils::emit_data_changed(&app, "collections-changed", &collection_id);
    Ok(item)
}

#[tauri::command]
pub fn remove_game_from_collection(
    app: tauri::AppHandle,
    state: tauri::State<'_, SqliteCoreDb>,
    collection_id: String,
    game_id: String,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Err("Database not initialized".into());
    };
    remove_game_from_collection_inner(db, &collection_id, &game_id)?;
    crate::utils::progress_utils::emit_data_changed(&app, "collections-changed", &collection_id);
    Ok(())
}

#[tauri::command]
pub fn reorder_collection_items(
    app: tauri::AppHandle,
    state: tauri::State<'_, SqliteCoreDb>,
    collection_id: String,
    game_ids: Vec<String>,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Err("Database not initialized".into());
    };
    reorder_collection_items_inner(db, &collection_id, &game_ids)?;
    crate::utils::progress_utils::emit_data_changed(&app, "collections-changed", &collection_id);
    Ok(())
}

// ---------------------------------------------------------------------------
// save_collection_cover — save artwork for a collection card
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_collection_cover(
    app: tauri::AppHandle,
    collection_id: String,
    content_base64: String,
    ext: String,
) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&content_base64)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    if bytes.len() > 5 * 1024 * 1024 {
        return Err("File too large (>5MB)".into());
    }

    let app_dir = app.path().app_data_dir().map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let covers_dir = app_dir.join("collections").join(&collection_id);
    fs::create_dir_all(&covers_dir).map_err(|e| format!("Failed to create cover dir: {}", e))?;

    let ext_clean = ext.trim_start_matches('.').to_lowercase();
    let safe_ext = match ext_clean.as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "bmp" => ext_clean,
        "webp" => "jpg".to_string(),
        _ => "jpg".to_string(),
    };

    // Delete existing cover files
    if let Ok(entries) = fs::read_dir(&covers_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if stem == "cover" && path != covers_dir.join(format!("cover.{}", safe_ext)) {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }

    let filename = format!("cover.{}", safe_ext);
    let dest_path = covers_dir.join(&filename);
    fs::write(&dest_path, &bytes).map_err(|e| format!("Failed to write cover file: {}", e))?;

    let abs_path = dest_path.to_string_lossy().to_string();
    println!("[COLLECTIONS][COVER_SAVED] id={} path={}", collection_id, abs_path);

    Ok(abs_path)
}
