# LumaForge Achievements — Agent Summary

## Goal
Complete LumaForge achievements: lazy image downloading, correct statId/bit progress from UserGameStats, librarycache JSON as primary progress source, deep debug, clean resolver priority, and log cleanup.

## Constraints & Preferences
- Settings values (steamWebApiKey, steamId64, accountId, steamRoot, achievementSchemaPath, steamAchievementsEnabled) must be verified with `[ACH][INPUT]` logs
- `achievementpercentages.json` is NEVER used for unlock state — only `rarityPercent`
- Local progress uses `(statValue & (1 << bit)) !== 0` from UserGameStats ↔ schema statId/bit
- API key + SteamID64 only required for Web API progress; schema, images, rarity, and local progress work without them
- Eager image base64 embedding during schema read is forbidden; raw paths (`img/<hash>.jpg`) returned and resolved lazily via queue
- Max 3 concurrent image downloads; 24h cooldown on failure; priority: high (current details/modal) → normal → low (preload)
- HTTP 403 on GetPlayerAchievements is non-fatal; cached per-session via `cached403Apps` Set, log once, fall through to librarycache → UserGameStats → appcache
- Librarycache JSON has highest progress priority; checked before Web API; if `nTotal > 0` → source is `"librarycache"`, `progressAvailable = true`, Web API is skipped
- Schema-only disk cache must NOT early-return; continue to librarycache and other progress sources then merge
- Librarycache entries may be partial (< `nTotal`); canonical achievements list must retain full count from schema
- Unlock detection via `previousUnlockedState` Map per `{appId}` → toast notifications
- When app schema folder is not configured, fall back to cached schema entries as metadata source

## Completed

### Rust
- `AchievementsAppSchemaEntry`: field aliases for all naming conventions; `LocaleValue` enum; `resolve_localized` full fallback chain
- `read_achievements_app_schema_folder`: path detection, returns raw `icon`/`icon_gray` paths + `base_dir` (no longer embeds images)
- `AchievementsAppPercentagesFile` reads root `file.achievements`; `deserialize_f64` accepts `"31.1"` strings
- `AppAchievementSummary.source` defaults to `"schema-only"`; `updated_at` defaults to 0
- `UserGameStatsRawResult` + `StatPair` models; `parse_user_game_stats_raw` command returns stat pairs + achievement entries
- `download_achievement_image` command: downloads single image, saves to `achievements/<appid>/img/<filename>`, returns data URL; skips existing valid files, deletes empty files
- `resolve_achievement_image_paths` command: checks which images exist on disk (no download)
- `ensure_achievement_images` command: bulk download missing images (5 for preload, all for details/modal)
- `debug_achievement_progress` command: reads UserGameStats + UserGameStatsSchema files; returns hex dump, KV tree, stat pairs, achievement entries, per-achievement statId/bit match results, app schema, librarycache info
- `parse_librarycache_achievements` command: reads `<steamRoot>/userdata/<accountId>/config/librarycache/<appid>.json`; parses vecHighlight/vecUnachieved/vecAchievedHidden with strID, bAchieved, rtUnlocked (seconds), flAchieved (rarity); returns `LibraryCacheProgress` with nTotal/nAchieved/progressAvailable
- `LibraryCacheProgress`, `LibraryCacheAchievementEntry`, `DebugAchievementReport`, `DebugFileInfo`, `DebugKvNode`, `DebugMatchResult`, `AchievementImageStatus` models

### TypeScript
- `steamAchievementsResolver.ts`: priority order is cache → app schema → Steam API → global % → librarycache JSON → Web API → UserGameStats → appcache
- `buildLibraryCacheProgress`: reads librarycache result, creates progressMap (strID → bAchieved/rtUnlocked * 1000), rarityMap (strID → flAchieved)
- `buildLocalProgressFromStats`: statId/bit → `(statValue & (1 << bit)) !== 0`; populates `GameAchievement`
- Resolver: schema-only disk cache does NOT early-return; continues to progress sources; librarycache overrides
- Resolver: fallback to cached schema metadata when app schema folder isn't configured — `[ACH][MERGE]` logged
- Resolver: 403 session cache via module-level `cached403Apps` Set; log `[ACH][PROGRESS_API] appid=X status=403 cachedFailure=true`
- Resolver: librarycache merge uses `nAchieved` from librarycache for unlocked count, prefers canonical schema count for total
- Resolver: `[ACH][MERGE]` and `[ACH][FINAL]` logs for librarycache merge and final summary
- `achievementImageQueue.ts`: singleton queue with maxConcurrent=3, priority sorting, 24h cooldown, `subscribe(cb)` for reactive UI
- `resolveImageSource(value, appId, type)`: accepts hash, CDN URL, `img/` local path; constructs CDN URL; skips invalid sources
- `LibraryGameDetails.tsx`: image subscription + enqueue effects; dependency array includes all Settings fields; Debug buttons in achievement sections
- `AchievementsModal.tsx`: image enqueue effect on open
- `debugAchievements(appId, options)` dev console: calls deep Rust command + logs JSON report + `console.table` for match results + librarycache info
- Tauri bindings: `debugAchievementProgress`, `parseLibraryCacheAchievements`, `resolveAchievementImagePaths`, `ensureAchievementImages`
- Types: `LibraryCacheProgress`, `LibraryCacheAchievementEntry`, `DebugAchievementReport`, `DebugFileInfo`, `DebugKvNode`, `DebugMatchResult`, `AchievementImageStatus`; `GameAchievementsSummary.source` includes `"librarycache"`
- Unlock event detection via `previousUnlockedState` Map → toast notifications

### Log Cleanup
- `diag_log` changed to `[ACH]` prefix; `[ACH][SCHEMA]`, `[ACH][PROGRESS]`, `[ACH][IMG]`, `[ACH][CACHE]`, `[ACH][LIBRARYCACHE]`, `[ACH][LIBRARYCACHE_ENTRY]`, `[ACH][MERGE]`, `[ACH][DEBUG_REPORT]`, `[ACH][RARITY]`, `[ACH][PROGRESS_API]`, `[ACH][FINAL]`, `[ACH][INPUT]`, `[ACH][APPCACHE]`
- All 21 `[steamAchievementsResolver]` log prefixes in resolver.ts converted to categorized `[ACH]` prefixes (`[CACHE]`, `[SCHEMA]`, `[RARITY]`, `[PROGRESS_API]`, `[PROGRESS]`, `[APPCACHE]`)

## Key Decisions
- Image downloading is lazy via TypeScript queue (Rust `download_achievement_image` per file) — no eager base64 embedding during schema read
- Librarycache JSON is highest-priority progress source, checked before Web API; avoids 403 blocking entirely
- Schema-only disk cache no longer early-returns; becomes metadata source, allowing librarycache to override
- Librarycache entries may be partial; canonical achievements list retains full count from schema, progress map merged per apiName
- Librarycache `rtUnlocked` is Unix seconds; converted to ms (* 1000) for frontend
- `flAchieved` is rarity only, never used for unlock state
- `cached403Apps` session Set persists across resolver calls; first 403 skips all future GetPlayerAchievements for that appId
- `AppAchievementCacheEntry.stat_id` and `bit` come from App schema folder (canonical); UserGameStatsSchema is fallback / debug-only
- Cached schema entries used as metadata fallback when no app schema folder is configured

## Key Files
- `src-tauri/src/models/steam_appcache_achievements.rs` — all data models including `LibraryCache*`, `Debug*`, `AchievementImageStatus`
- `src-tauri/src/commands/steam_achievements.rs` — all Tauri commands (schema reader, stats parser, image downloader, librarycache parser, debug report, KV tree)
- `src/services/steamAchievementsResolver.ts` — resolver orchestration, `buildLibraryCacheProgress`, `buildLocalProgressFromStats`, `debugAchievements`, cache read/write, 403 cache
- `src/services/achievementImageQueue.ts` — singleton download queue, CDN URL construction, image source validation
- `src/services/tauri.ts` — TypeScript bindings for all Rust commands + exported types
- `src/types/gameAchievements.ts` — `GameAchievement`, `GameAchievementsSummary` (includes `"librarycache"` source)
- `src/components/library/LibraryGameDetails.tsx` — achievements preview, image queue + progress debug effects, Debug buttons
- `src/components/library/AchievementsModal.tsx` — full list modal, image enqueue effect
