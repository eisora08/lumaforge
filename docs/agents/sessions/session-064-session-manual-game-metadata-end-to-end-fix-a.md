## Session — Manual Game Metadata End-to-End Fix + Artwork Pipeline

### Goal
Fix the manual metadata end-to-end flow: IGDB/Steam search → result mapping → Apply Metadata fills visible fields → Save persists → Reopen retains all data. Add comprehensive debug tracing. Add Steam Store fallback for manual games. Fix artwork pipeline for manual games.

### Part 1: Debug tracing
- Added `DEBUG_MANUAL_METADATA = false` flag in `GameEditDialog.tsx`
- Added `DEBUG_MANUAL_META = false` flag in `storeArtworkResolver.ts`
- Added 13+ `[MANUAL][META]` trace points in `handleDownloadMetadata` (source, searchName, isManual, isCreate, IGDB call/result, Steam call/results/best match/metadata)
- Added `[IGDB_NAME]` trace points in `fetchIgdbMetadataByName` (early return, dedup, Rust call, raw results, mapped result, error)
- All behind `DEBUG_MANUAL_METADATA` / `DEBUG_MANUAL_META` flags — off by default

### Part 2-4: IGDB verification
- Verified Rust `igdb.rs` query fields (`name, summary, first_release_date, genres.name, involved_companies.company.name, involved_companies.publisher, involved_companies.developer, cover.url, screenshots.url`) → `IgdbGameRaw` → `IgdbGameSearchResult` (snake_case) → TS `IgdbMetadataByNameResult` (camelCase). All correct.
- Verified Apply Metadata fills all EditableField state variables for both IGDB and Steam paths.

### Part 5: Manual save persistence (critical fix)
- **Root cause**: `ManualGameEntry` type was missing 14+ fields that the UI exposes (categories, features, tags, sortingName, scores, review data, series, ageRating, region, completionStatus). These were silently wiped on every save.
- **Fix**: Added all missing fields to `ManualGameEntry` type in `manualGameStore.ts`. Updated `loadDraftsFromManualEntry`, `handleSave` patch, `newEntry` construction, and `hasEdits` tracking.

### Part 6: Steam Store search fallback for manual games
- Changed `capabilities.canUseSteamMetadata` from `false` to `true` for manual/create mode
- Rewrote manual mode `handleDownloadMetadata` to support both IGDB and Steam sources
- Steam path: `resolveSteamStoreSearch({ term })` → best match → `resolveGameMetadata([app_id])` → fill all draft fields
- Added `Search` icon import + `resolveSteamStoreSearch` import for manual mode dropdown
- Manual dropdown shows "Steam (by name)" with `Search` icon, "IGDB" with `Image` icon

### Part 7: Artwork pipeline for manual games
- **GameImageSearchDialog**: Added `libraryId` optional prop. When `libraryId` is present and `appId` is absent (manual mode), `applyUrl` uses `downloadProviderMediaFromUrl("manual", libraryId, role, url)` + `updateManualGame(libraryId, patch)` instead of `safe_download_image` + `updateGameAppinfoMedia`.
- **GameEditDialog rendering guard**: Changed `appId &&` to `(appId || manualGameId) &&` to allow manual games. Passes both `appId` and `libraryId` props.
- **Refresh after image search**: When the dialog closes for manual games, re-reads the manual entry from localStorage to pick up the new media paths.
- **openGameMediaFolder**: Fixed for manual games — now uses `openProviderMediaFolder("manual", manualGameId)` instead of `openGameMediaFolder(manualGameId)` which wrote to `games/steam/` path. Also fixed the Actions tab "Open Media Folder" button.
- **Rust `open_provider_media_folder`**: New command in `provider_media.rs` — creates dir via `get_provider_media_dir`, opens via `open::that`. Registered in `lib.rs`.
- **TS binding**: `openProviderMediaFolder(providerId, providerGameId)` in `tauri.ts`.
- **handleSave media paths**: Both the update patch and create-mode `newEntry` now include `coverPath`, `landscapePath`, `backgroundPath`, `logoPath`, `iconPath` from `manualEntry`.

### Files Changed
- `src/components/games/GameImageSearchDialog.tsx` — `libraryId` prop, manual adapter path in `applyUrl`, imports for `downloadProviderMediaFromUrl` + `updateManualGame`
- `src/components/games/GameEditDialog.tsx` — rendering guard, `handleOpenMediaFolder`, `openProviderMediaFolder` import, `handleSave` media paths, `newEntry` media paths, image search close re-read
- `src/services/storeArtworkResolver.ts` — `DEBUG_MANUAL_META` flag + trace logging
- `src/services/manualGameStore.ts` — `ManualGameEntry` type expanded with 14+ fields
- `src/services/tauri.ts` — `openProviderMediaFolder` TS binding
- `src-tauri/src/commands/provider_media.rs` — `open_provider_media_folder` Rust command
- `src-tauri/src/lib.rs` — command registration

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (0 errors, only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)
