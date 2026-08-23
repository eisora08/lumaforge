## Session — 8 Bug Investigation + Critical UI State Hardening + Dedup

### Part A: Bug Investigation (8 bugs)
1. **AchievementIcon race condition** — Fixed: `loadedRef` guard in `useResolvedUrl` prevents stale state after appId change
2. **Missing iconUrl hidden achievements** — Handled by Part 1 fix (race condition was root cause)
3. **Progress N/A in achievements** — Fixed `progressAvailable` derivation in `achievementStore.ts`: checks `highestUnlockTime` and schema `achievementGoal` alongside `unlockedCount`
4. **Manual refresh not persisting** — Determined NOT a bug: `refreshAchievements` writes to disk via `applyProgressPatch`, flush is async but consistent
5. **Store provider mismatch** — Identified root cause: `PackagesToolbar.tsx` passes `provider="hubcapdb"` but Rust command expects `HubcapDB` (capitalized). Needs separate session to fix since it involves Tauri event keys
6. **MediaIndex guards for Store/Browse** — Already exist: `mediaDownloadQueue.ts`, `gameCacheService.ts`, `startupSnapshotService.ts` all guard `#/store` routes
7. **BootSnapshot writes from Store** — Already guarded: `notifyMediaUpdated` returns early for `#/store` routes
8. **Log cleanup** — Discussed: `[MEDIA][DETAILS_RENDER]`, `[MEDIA][GRID_RENDER]` gated; `ENABLE_VERBOSE_*` flags set to false

### Part B: Composite keys (Part 1 of UI State Hardening)
- Changed `StoreHorizontalSection.tsx` — accepts `sectionKey` prop, uses `sectionKey:steam:index` for wrapper keys
- Changed `StoreGameDetailsPage.tsx` — uses `more-like-this:steam:index`, `details:steam:appId`
- Changed `StoreMoreLikeThisSection.tsx` — uses `more-like-this:steam:appId`
- Changed `StoreDiscoverHeroCarousel.tsx` — each `StoreHorizontalSection` call passes `sectionKey={section.id}`
- Changed `Store.tsx` — removed `key={game.appId}` from renderStoreCard, passes `sectionKey` to all StoreHorizontalSection calls, dedup via `seen` Set in moreToExploreGames
- Changed 4 dashboard GameHero calls to pass `key={…}`
- Changed `GameLauncherTile.tsx` — fixed to use composite `section:provider:appId` key
- Changed `InstalledGamesSidebar.tsx`, `Achievements.tsx` — composite keys
- Changed `SidebarLibraryList.tsx` — dedup by appId in visibleItems computation
- Changed `InstalledGameDetails.tsx` — composite keys in action buttons/watcher tabs
- Changed `PackagesToolbar.tsx`, `PackagesToolbarSearch.tsx` — avoid duplicate keys
- Total: 15 files with key fixes, 0 duplicate key warnings

### Part C: Dedup within each section
- Added `deduplicateByAppId<T>(items)` in `gameCacheService.ts` (moved from `gameStore.ts`, removed duplicate from `gameStore.ts`)
- Type constraint uses `appId?: string | null | undefined` to accept both required and optional appId
- Wrapped render `.map()` calls in all 7 dashboard sections:
  - `ContinuePlayingSection.tsx` — import + `deduplicateByAppId(games).map()`
  - `FavoritesSection.tsx` — `deduplicateByAppId(displayGames).map()`
  - `TopPlayedSection.tsx` — import + `deduplicateByAppId(displayGames).map()`
  - `LibrarySection.tsx` — import + `deduplicateByAppId(displayGames).map()`
  - `RecommendedSection.tsx` — import + `deduplicateByAppId(displayGames).map()`
  - `FeaturedPicksSection.tsx` — import + `deduplicateByAppId(displayGames).map()`
  - `NewNoteworthySection.tsx` — import + `deduplicateByAppId(displayGames).map()`
- `tsc --noEmit` ✅ passes (only pre-existing unused-import warnings)

### Key Decisions
- **Inline dedup at render point** — Not changing displayGames useMemo logic; wrapping render `.map()` with dedup is simpler and avoids altering data used by other effects
- **Single dedup function** — `deduplicateByAppId` in `gameCacheService.ts` reused by all 7 sections (already imported by most)
- **Set-based dedup** — O(n) dedup preserving first occurrence order

### Key Files Changed (this session)
- `src/services/gameCacheService.ts` — `deduplicateByAppId()` added, type constraint relaxed
- `src/services/gameStore.ts` — removed duplicate `deduplicateByAppId()`/`composeDerivedData()`
- `src/components/dashboard/*.tsx` (7 files) — import + dedup at render map
- `src/components/store/*.tsx` (5 files), `src/pages/Store.tsx` — composite keys
- `src/components/games/GameLauncherTile.tsx` — composite key fix
- `src/components/layout/SidebarLibraryList.tsx` — dedup in visibleItems
- `src/components/installed/InstalledGameDetails.tsx` — composite keys
- `src/components/installed/InstalledGamesSidebar.tsx` — composite key
- `src/components/packages/PackagesToolbar.tsx`, `PackagesToolbarSearch.tsx` — composite key
- `src/pages/Achievements.tsx` — composite key
- `src/components/achievements/AchievementWatcherInit.tsx` — composite key
