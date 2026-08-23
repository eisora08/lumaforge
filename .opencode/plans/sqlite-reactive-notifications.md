# Plan: SQLite → React reactive notification system

## Problem
SQLite writes (games, media, appinfo) don't trigger React re-renders. UI shows stale/empty data until F5.

## 3 symptoms
1. Images don't appear after download completes
2. Library empty on first boot (background scan populates SQLite but context doesn't re-read)
3. General staleness - any SQLite change requires F5

## Root cause
No notification bus between Rust SQLite writers and React consumers.

## Solution: 8-file unified change notification

### File 1: `src-tauri/src/utils/progress_utils.rs` — Rust event emitter
- Add `emit_data_changed(app_handle, change_type: &str, detail: &str)` 
- Emits Tauri event `sqlite-data-changed` with `{ type, detail }` payload

### File 2: `src-tauri/src/commands/steam_index.rs` — games-upserted event
- After `scan_and_build_full_dataset` returns, emit `games-upserted` with count
- Triggers LibraryGamesContext re-read

### File 3: `src-tauri/src/commands/game_cache.rs` — appinfo-changed events
- `update_game_appinfo_media`: emit after write succeeds
- `batch_update_game_names`: emit after batch commit

### File 4: `src/services/dataChangeBus.ts` — NEW TS event bus
- `subscribeDataChanges(handler)` → returns unsubscribe
- `initDataChangeBus()` — calls `listen("sqlite-data-changed", ...)`

### File 5: `src/App.tsx` — mount bus on startup

### File 6: `src/context/LibraryGamesContext.tsx` — subscribe to games-upserted → refresh()

### File 7: `src/services/gameCacheService.ts` — post-download invalidation (already mostly done)

### File 8: `src/services/mediaDownloadQueue.ts` — invalidate card image cache after download

## Expected behavior
- First boot: scan → emit → context re-reads → games appear
- Post-download: write → emit → component re-renders → image appears
- Playtime: already has subscribePlaytimeStore
