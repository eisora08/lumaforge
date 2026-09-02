use rusqlite::Connection;
use tauri::State;

use crate::commands::sqlite_cache::SqliteCoreDb;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Entity {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GameEntity {
    pub game_id: String,
    pub entity_id: i64,
}

// ---------------------------------------------------------------------------
// Generic entity CRUD (genres, companies, categories, features, tags)
// ---------------------------------------------------------------------------

/// Get or create an entity by name. Returns the entity ID.
pub fn get_or_create_entity(conn: &Connection, table: &str, name: &str) -> Result<i64, String> {
    // Try to find existing
    let query = format!("SELECT id FROM {} WHERE name = ?1", table);
    if let Ok(id) = conn.query_row(&query, [name], |row| row.get(0)) {
        return Ok(id);
    }

    // Insert new
    let insert = format!("INSERT INTO {} (name) VALUES (?1)", table);
    conn.execute(&insert, [name])
        .map_err(|e| format!("Failed to insert into {}: {}", table, e))?;

    Ok(conn.last_insert_rowid())
}

/// Get all entities from a table.
pub fn get_all_entities(conn: &Connection, table: &str) -> Result<Vec<Entity>, String> {
    let query = format!("SELECT id, name FROM {} ORDER BY name", table);
    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Entity {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(|e| format!("Failed to query entities: {}", e))?;

    let mut entities = Vec::new();
    for row in rows {
        entities.push(row.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(entities)
}

/// Delete an entity by ID (cascading delete handles junction tables).
pub fn delete_entity(conn: &Connection, table: &str, id: i64) -> Result<(), String> {
    let query = format!("DELETE FROM {} WHERE id = ?1", table);
    conn.execute(&query, [id])
        .map_err(|e| format!("Failed to delete from {}: {}", table, e))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Junction table operations
// ---------------------------------------------------------------------------

/// Add a game-entity association to a junction table.
pub fn add_game_entity(
    conn: &Connection,
    junction_table: &str,
    game_id: &str,
    entity_id: i64,
) -> Result<(), String> {
    let query = format!(
        "INSERT OR IGNORE INTO {} (game_id, entity_id) VALUES (?1, ?2)",
        junction_table
    );
    conn.execute(&query, rusqlite::params![game_id, entity_id])
        .map_err(|e| format!("Failed to add game-entity: {}", e))?;
    Ok(())
}

/// Remove all entities for a game from a junction table.
pub fn clear_game_entities(conn: &Connection, junction_table: &str, game_id: &str) -> Result<(), String> {
    let query = format!("DELETE FROM {} WHERE game_id = ?1", junction_table);
    conn.execute(&query, [game_id])
        .map_err(|e| format!("Failed to clear game entities: {}", e))?;
    Ok(())
}

/// Get all entity IDs for a game from a junction table.
pub fn get_entity_ids_for_game(
    conn: &Connection,
    junction_table: &str,
    game_id: &str,
) -> Result<Vec<i64>, String> {
    let query = format!(
        "SELECT entity_id FROM {} WHERE game_id = ?1",
        junction_table
    );
    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([game_id], |row| row.get(0))
        .map_err(|e| format!("Failed to query: {}", e))?;

    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(ids)
}

/// Get all entity names for a game from a junction table.
pub fn get_entity_names_for_game(
    conn: &Connection,
    entity_table: &str,
    junction_table: &str,
    game_id: &str,
) -> Result<Vec<String>, String> {
    let query = format!(
        "SELECT e.name FROM {} e
         INNER JOIN {} j ON e.id = j.entity_id
         WHERE j.game_id = ?1
         ORDER BY e.name",
        entity_table, junction_table
    );
    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([game_id], |row| row.get(0))
        .map_err(|e| format!("Failed to query: {}", e))?;

    let mut names = Vec::new();
    for row in rows {
        names.push(row.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(names)
}

/// Get all game IDs that have a specific entity.
pub fn get_game_ids_for_entity(
    conn: &Connection,
    junction_table: &str,
    entity_id: i64,
) -> Result<Vec<String>, String> {
    let query = format!(
        "SELECT game_id FROM {} WHERE entity_id = ?1",
        junction_table
    );
    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([entity_id], |row| row.get(0))
        .map_err(|e| format!("Failed to query: {}", e))?;

    let mut game_ids = Vec::new();
    for row in rows {
        game_ids.push(row.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(game_ids)
}

/// Count games per entity (for filtering UI).
pub fn count_games_per_entity(
    conn: &Connection,
    entity_table: &str,
    junction_table: &str,
) -> Result<Vec<(Entity, i64)>, String> {
    let query = format!(
        "SELECT e.id, e.name, COUNT(j.game_id) as game_count
         FROM {} e
         LEFT JOIN {} j ON e.id = j.entity_id
         GROUP BY e.id
         ORDER BY game_count DESC, e.name",
        entity_table, junction_table
    );
    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                Entity {
                    id: row.get(0)?,
                    name: row.get(1)?,
                },
                row.get(2)?,
            ))
        })
        .map_err(|e| format!("Failed to query: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(results)
}

// ---------------------------------------------------------------------------
// Bulk operations for migration
// ---------------------------------------------------------------------------

/// Parse a JSON array string and insert entities + junction records.
pub fn migrate_json_array_to_junction(
    conn: &Connection,
    game_id: &str,
    json_array: &str,
    entity_table: &str,
    junction_table: &str,
) -> Result<(), String> {
    let items: Vec<String> = serde_json::from_str(json_array)
        .map_err(|e| format!("Failed to parse JSON array: {}", e))?;

    for item in items {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            continue;
        }
        let entity_id = get_or_create_entity(conn, entity_table, trimmed)?;
        add_game_entity(conn, junction_table, game_id, entity_id)?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — Genre operations
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_all_genres(
    db: State<'_, SqliteCoreDb>,
) -> Result<Vec<Entity>, String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;
    get_all_entities(&conn, "genres")
}

#[tauri::command]
pub fn get_genres_for_game(
    db: State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<Vec<String>, String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;
    get_entity_names_for_game(&conn, "genres", "game_genres", &game_id)
}

#[tauri::command]
pub fn get_genre_counts(
    db: State<'_, SqliteCoreDb>,
) -> Result<Vec<(Entity, i64)>, String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;
    count_games_per_entity(&conn, "genres", "game_genres")
}

#[tauri::command]
pub fn set_game_genres(
    db: State<'_, SqliteCoreDb>,
    game_id: String,
    genre_names: Vec<String>,
) -> Result<(), String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;

    clear_game_entities(&conn, "game_genres", &game_id)?;
    for name in &genre_names {
        let entity_id = get_or_create_entity(&conn, "genres", name)?;
        add_game_entity(&conn, "game_genres", &game_id, entity_id)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — Developer operations
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_all_developers(
    db: State<'_, SqliteCoreDb>,
) -> Result<Vec<Entity>, String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;
    get_all_entities(&conn, "companies")
}

#[tauri::command]
pub fn get_developers_for_game(
    db: State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<Vec<String>, String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;
    get_entity_names_for_game(&conn, "companies", "game_developers", &game_id)
}

#[tauri::command]
pub fn set_game_developers(
    db: State<'_, SqliteCoreDb>,
    game_id: String,
    company_names: Vec<String>,
) -> Result<(), String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;

    clear_game_entities(&conn, "game_developers", &game_id)?;
    for name in &company_names {
        let entity_id = get_or_create_entity(&conn, "companies", name)?;
        add_game_entity(&conn, "game_developers", &game_id, entity_id)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — Publisher operations
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_publishers_for_game(
    db: State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<Vec<String>, String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;
    get_entity_names_for_game(&conn, "companies", "game_publishers", &game_id)
}

#[tauri::command]
pub fn set_game_publishers(
    db: State<'_, SqliteCoreDb>,
    game_id: String,
    company_names: Vec<String>,
) -> Result<(), String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;

    clear_game_entities(&conn, "game_publishers", &game_id)?;
    for name in &company_names {
        let entity_id = get_or_create_entity(&conn, "companies", name)?;
        add_game_entity(&conn, "game_publishers", &game_id, entity_id)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — Category operations
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_all_categories(
    db: State<'_, SqliteCoreDb>,
) -> Result<Vec<Entity>, String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;
    get_all_entities(&conn, "categories")
}

#[tauri::command]
pub fn get_categories_for_game(
    db: State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<Vec<String>, String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;
    get_entity_names_for_game(&conn, "categories", "game_categories", &game_id)
}

#[tauri::command]
pub fn set_game_categories(
    db: State<'_, SqliteCoreDb>,
    game_id: String,
    category_names: Vec<String>,
) -> Result<(), String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;

    clear_game_entities(&conn, "game_categories", &game_id)?;
    for name in &category_names {
        let entity_id = get_or_create_entity(&conn, "categories", name)?;
        add_game_entity(&conn, "game_categories", &game_id, entity_id)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — Feature operations
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_all_features(
    db: State<'_, SqliteCoreDb>,
) -> Result<Vec<Entity>, String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;
    get_all_entities(&conn, "features")
}

#[tauri::command]
pub fn get_features_for_game(
    db: State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<Vec<String>, String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;
    get_entity_names_for_game(&conn, "features", "game_features", &game_id)
}

#[tauri::command]
pub fn set_game_features(
    db: State<'_, SqliteCoreDb>,
    game_id: String,
    feature_names: Vec<String>,
) -> Result<(), String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;

    clear_game_entities(&conn, "game_features", &game_id)?;
    for name in &feature_names {
        let entity_id = get_or_create_entity(&conn, "features", name)?;
        add_game_entity(&conn, "game_features", &game_id, entity_id)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — Tag operations
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_all_tags(
    db: State<'_, SqliteCoreDb>,
) -> Result<Vec<Entity>, String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;
    get_all_entities(&conn, "tags")
}

#[tauri::command]
pub fn get_tags_for_game(
    db: State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<Vec<String>, String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;
    get_entity_names_for_game(&conn, "tags", "game_tags", &game_id)
}

#[tauri::command]
pub fn set_game_tags(
    db: State<'_, SqliteCoreDb>,
    game_id: String,
    tag_names: Vec<String>,
) -> Result<(), String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;

    clear_game_entities(&conn, "game_tags", &game_id)?;
    for name in &tag_names {
        let entity_id = get_or_create_entity(&conn, "tags", name)?;
        add_game_entity(&conn, "game_tags", &game_id, entity_id)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — Bulk migration
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn migrate_game_entities_from_json(
    db: State<'_, SqliteCoreDb>,
    game_id: String,
    genres: Option<String>,
    developers: Option<String>,
    publishers: Option<String>,
    categories: Option<String>,
    features: Option<String>,
    tags: Option<String>,
) -> Result<(), String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;

    if let Some(ref json) = genres {
        migrate_json_array_to_junction(&conn, &game_id, json, "genres", "game_genres")?;
    }
    if let Some(ref json) = developers {
        migrate_json_array_to_junction(&conn, &game_id, json, "companies", "game_developers")?;
    }
    if let Some(ref json) = publishers {
        migrate_json_array_to_junction(&conn, &game_id, json, "companies", "game_publishers")?;
    }
    if let Some(ref json) = categories {
        migrate_json_array_to_junction(&conn, &game_id, json, "categories", "game_categories")?;
    }
    if let Some(ref json) = features {
        migrate_json_array_to_junction(&conn, &game_id, json, "features", "game_features")?;
    }
    if let Some(ref json) = tags {
        migrate_json_array_to_junction(&conn, &game_id, json, "tags", "game_tags")?;
    }

    Ok(())
}

/// Get all entities for a game (combined view for UI).
#[tauri::command]
pub fn get_all_game_entities(
    db: State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<serde_json::Value, String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard.lock().map_err(|e| format!("Lock error: {}", e))?;

    let genres = get_entity_names_for_game(&conn, "genres", "game_genres", &game_id)?;
    let developers = get_entity_names_for_game(&conn, "companies", "game_developers", &game_id)?;
    let publishers = get_entity_names_for_game(&conn, "companies", "game_publishers", &game_id)?;
    let categories = get_entity_names_for_game(&conn, "categories", "game_categories", &game_id)?;
    let features = get_entity_names_for_game(&conn, "features", "game_features", &game_id)?;
    let tags = get_entity_names_for_game(&conn, "tags", "game_tags", &game_id)?;

    Ok(serde_json::json!({
        "genres": genres,
        "developers": developers,
        "publishers": publishers,
        "categories": categories,
        "features": features,
        "tags": tags,
    }))
}
