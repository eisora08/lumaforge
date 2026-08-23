## Session — Playtime Lookup Fixes (Phases 2-8)

### Goal
Fix playtime not showing correctly across all surfaces by auditing the entire playtime data flow — from Rust `record_play_session_end` to TS consumer components.

### Phase 1: Audit complete
Root causes identified:
- **`computeTotalPlaytime()`** was fundamentally wrong: returned `externalPlaytimeSeconds` for external-source games (ignoring local session playtime) and `localPlaytimeSeconds` for local games (ignoring external/imported playtime). Rust already correctly maintains `totalPlaytimeSeconds`.
- **Key construction mismatch**: Some call sites used `game.id` (e.g., `"steam-480"`) instead of `\`app-${game.appId}\`` (e.g., `"app-480"`) for playtime store lookup, producing cache misses.
- **GameHero.tsx** displayed snapshot playtime (`heroGame.playtime` in minutes) instead of playtime store data with per-second precision.
- **`lastPlayedAt`** was only set on session end (Rust) — sessions that ran for hours showed stale `lastPlayedAt` until the game exited.
- **Snapshot playtime** used only Steam stats, ignoring LumaForge-tracked sessions.
- **Manual Refresh Achievements** handled all layers (store + disk) but didn't explicitly schedule a snapshot write.

### Phase 2: Helper functions + `computeTotalPlaytime` fix
- **`computeTotalPlaytime()`** (`playtimeService.ts:122`) now returns `entry.totalPlaytimeSeconds` — trusts Rust's authoritative total.
- **`getPlaytimeEntryByAppId(appId)`** — normalized lookup via `\`app-${appId}\`` key; returns `null` for null/missing appId.
- **`getPlaytimeSecondsForAppId(appId)`** — convenience wrapper returning `totalPlaytimeSeconds` or 0.
- Fixed 6 call sites to use helpers:
  - `GameHero.tsx` — `getEffectiveLastPlayedMs` and hero selection
  - `TopPlayedSection.tsx` — session count + totalSeconds
  - `LibraryGameDetails.tsx` — key construction + lookup
  - `LibraryGameDetailPage.tsx` — key construction for import

### Phase 3: GameHero display
- `heroPlaytimeStr` useMemo — prefers playtime store seconds, falls back to snapshot minutes.
- `lastPlayedStr` useMemo — prefers playtime store `lastPlayedAt` (updated at session start), falls back to snapshot.
- Playtime display shows `"X min"` from store (per-second precision) or snapshot (backup).

### Phase 4: `lastPlayedAt` updated on session launch
- `GameSessionContext.tsx:1078-1083` — after `startPlaySession` succeeds, also updates `cachedStore.games[key].lastPlayedAt` to `Date.now() / 1000` immediately.
- UI now shows "just now" for currently-playing games without waiting for session end.

### Phase 5: Playtime merged into snapshot
- `startupSnapshotService.ts:1184` — snapshot `playtime` field uses `getPlaytimeSecondsForAppId(appId) / 60` (playtime store first), falls back to `game.steamPlaytimeMinutes`.
- Dashboard sections reading snapshot data now see LumaForge-tracked playtime.

### Phase 6: Achievement summary refresh (no changes needed)
- Already implemented in Session — `LibraryGameDetails.tsx:522-638` reads disk cache for visible app only, no auto-scan.
- `ACHIEVEMENT_READ_EXISTING_CACHE_FOR_VISIBLE_APP = true` flag.

### Phase 7: Manual Refresh Achievements
- Handler calls `achievementStore.setSummary(appIdStr, s)` which persists to disk.
- Next snapshot write (triggered by LibraryGamesContext) picks up fresh achievement data from `achievementStore` during `buildStartupSnapshotFromCurrentState`.
- No explicit snapshot schedule needed — incremental flow captures it.

### Phase 8: Snapshot write reason logging
- `scheduleSnapshotWrite()` now accepts optional `reason` parameter (defaults to `"full-rebuild"`).
- `[BootSnapshot][SCHEDULE] reason=<caller>` log for each call site:
  - `library-reconcile` — from LibraryGamesContext effect
  - `batch-media-update` — from `notifyMediaUpdatedBatch`
  - `media-change` — from `scheduleSnapshotUpdateAfterMediaChange`
- All defer/no-op logs also include `caller=<reason>`.

### Key Files Changed
- `src/services/playtimeService.ts` — `computeTotalPlaytime` fix, `getPlaytimeEntryByAppId`, `getPlaytimeSecondsForAppId`
- `src/components/dashboard/GameHero.tsx` — helper imports, `getEffectiveLastPlayedMs` rewrite, `heroPlaytimeStr` + `lastPlayedStr` useMemoi
- `src/components/dashboard/TopPlayedSection.tsx` — helper imports, sessionCount + totalSeconds via helpers
- `src/components/library/LibraryGameDetails.tsx` — `getPlaytimeEntryByAppId` import, key construction fix
- `src/pages/LibraryGameDetailPage.tsx` — key construction fix for playtime import
- `src/context/GameSessionContext.tsx` — `getCachedPlaytimeStore` import, `lastPlayedAt` update on session start
- `src/services/startupSnapshotService.ts` — `getPlaytimeSecondsForAppId` import, snapshot playtime merge, `reason` param on `scheduleSnapshotWrite`

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
