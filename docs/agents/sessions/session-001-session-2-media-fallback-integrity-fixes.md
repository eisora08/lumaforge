## Session 2 — Media fallback integrity fixes

### Part 1: resolveGameMediaUrl helper
- `resolveGameMediaUrl(appId, path, provider)` in gameCacheService.ts — resolves relative paths (`media/`, `img/`) via `resolveRelativeMediaPath` then `localPathToUrl`; handles `.tmp`, HTTP/S, `asset://`, `data:`, `file://`, and absolute paths
- `[MEDIA][RESOLVE]` log for verbose mode

### Part 2: GameHero.tsx fallback + logging
- Added `iconPath` to hero fallback chain (was missing)
- Added `[MEDIA][HERO]` diagnostic logs for landscape/cover/background/icon each tagged `selected=Y|N`
- Simplified `src` assignment with `resolveGameMediaUrl`

### Part 3: SidebarLibraryList.tsx retry logic
- Retries media fetch when `canonicalInfoMap` becomes populated after initial load
- Always removes from `sidebarMediaLoading.current` in `finally` block (was missing on error path)

### Part 4: seedResolvedMediaCacheFromSnapshot repair grip
- Only marks game as "repaired" when snapshot has landscape AND (cover OR background) — not just for any single path

### Part 5: loadGameAppInfoWithMediaFallback cache trust
- Does NOT trust incomplete snapshot cache; missing background/logo/icon triggers cache invalidation and repair instead of returning broken snapshot data

### Part 6: Rust media_path_exists_for_app
- `media_path_exists_for_app(app_id, media)` helper in `game_cache.rs` — checks which media paths exist on disk
- Used by `update_game_appinfo_media` and `repair_appinfo_media_paths`

### Part 7: notifyMediaUpdated in flushAppInfoUpdates
- Added `notifyMediaUpdated()` call in `mediaDownloadQueue.ts` `flushAppInfoUpdates` so dashboards react immediately after downloads

### Part 8: mediaCheckDoneRef reset on game switch
- `GameHero.tsx` now resets `mediaCheckDoneRef` when `selectedGame.appId` changes, allowing re-check

### Part 9: Skip "Steam App <appid>" placeholder names
- `updateAppInfoFromGames` in gameStore.ts skips names matching `/^Steam App \d+$/`

### Part 10: AchievementIcon relative path resolution
- `AchievementIcon` accepts `appId` prop; resolves relative `img/` paths via `resolveGameMediaUrl`
- Fixed 3 call sites: `AchievementsModal.tsx`, `LibraryGameDetails.tsx`, `AchievementTooltip.tsx`

### Part 11: Achievement image normalization verified
- `normalizeAchievementImagePath` already normalizes to `img/<file>` correctly — no changes needed

### Part 12: Fix settings keys
- `settings.steamApiKey` → `settings.steamWebApiKey`
- `settings.steamPath` → `settings.steamRoot`
- Both fixes in backgroundJobQueue.ts

### Part 13: TSC fixes in AchievementsModal.tsx
- Added `appIdStr` prop to `GlobalAchievementsTab` and `AchievementGroupsTab` component types (was missing, caused TSC/vite errors)
