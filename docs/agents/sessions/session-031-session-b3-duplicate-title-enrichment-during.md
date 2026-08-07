## Session — B3: Duplicate title enrichment during boot

### Goal
Avoid duplicate metadata/store/appinfo resolution for the same placeholder appIds between Stage 3.5 (enrich-snapshot-titles) and Stage 4.5 (reconcile-lua-games title enrichment).

### Root cause
- Stage 3.5 (appBootCoordinator.ts:243-289) resolves placeholder snapshot titles via `resolveGameMetadata` → `getStoreDetails`, mutates `_snapshotLoaded` in memory, and saves the snapshot.
- Stage 4.5 (appBootCoordinator.ts:483-592) separately resolves placeholder titles for `reconciledGames` via the same `resolveGameMetadata` → `getStoreDetails` chain, plus writes to canonical appinfo.
- On a warm boot, nearly all snapshot games overlap with reconciled games — causing duplicate metadata calls, duplicate store detail calls, duplicate appinfo writes (Stage 4.5 only), and duplicate snapshot saves.

### Part 1: Module-level Map tracking
- Added `_enrichedTitleAppIds: Map<string, string>` (appId → resolvedName) module-level variable, same pattern as `_cachedSettings` and `_cachedGameIndex`.
- Stage 3.5 adds to the Map after each successful enrichment (both metadata and store paths).
- Stage 4.5 checks the Map at the top of the per-game loop before attempting resolution.

### Part 2: Stage 3.5 persists canonical names
- Stage 3.5 now also writes the resolved name to canonical appinfo via `updateGameAppinfoMediaIfChanged` after each successful enrichment.
- Reads existing media from the B1 boot appinfo cache (`getCachedBootAppInfos`) to preserve all 5 media paths (coverPath, backgroundPath, logoPath, iconPath, landscapePath), remote, and mediaSources.
- Uses source tag `"bootStage35Enrichment"` to distinguish from Stage 4.5 writes.
- Safe non-critical try/catch — failure doesn't block enrichment or skip the Map entry.

### Part 3: Stage 4.5 skip logic
- At the top of the per-game loop (after `if (!game.appId) continue;`), checks `_enrichedTitleAppIds.has(game.appId)`.
- When enriched: reads the resolved name from the Map, updates `game.title`, logs `[BOOT][TITLE_ENRICH_SKIP] stage=4.5 appid=... reason=already-enriched`, and continues.
- Non-enriched games proceed through the existing full resolution chain unchanged.

### Part 4: Diagnostic logs added
- `[BOOT][TITLE_ENRICHED] stage=3.5 appid=... source=metadata|store` — per successful enrichment in Stage 3.5.
- `[BOOT][TITLE_APPINFO_WRITE] appid=... source=metadata|store` — when Stage 3.5 writes to appinfo.
- `[BOOT][TITLE_ENRICH_SKIP] stage=4.5 appid=... reason=already-enriched` — when Stage 4.5 skips a game.

### Key Changes
- `src/services/appBootCoordinator.ts` — `_enrichedTitleAppIds` Map, Stage 3.5 Map writes + appinfo persistence, Stage 4.5 skip check (3 edit blocks).

### Scenario coverage
- **A — warm boot with placeholder titles**: Stage 3.5 resolves and writes to Map + appinfo. Stage 4.5 skips those appIds. Logs show `[BOOT][TITLE_ENRICH_SKIP]` for enriched games.
- **B — Stage 3.5 cannot resolve a title**: Map has no entry. Stage 4.5 runs full resolution as before. No regression.
- **C — appinfo already has real name**: Stage 3.5 reads metadata/store, finds name, writes to Map + appinfo (no-op rewrite). Stage 4.5 skips.
- **D — media preservation**: Stage 3.5 appinfo write reads existing media from boot cache and preserves all 5 paths. No artwork fields wiped.
- **E — no snapshot / first boot**: `_snapshotLoaded` is null, Stage 3.5 skips entirely. Map stays empty. Stage 4.5 runs normally. No crash.

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)
