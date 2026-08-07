## Session — Manual game favorite keys: unify via getFavoriteKey + delete-only reconciler

### Problem
A manual game that gained a Steam appId lost its favorite marker and, when re-toggled, rendered twice.

### Root cause
- manualGameLibraryMapper.ts:127 assigns ppId: entry.appId ?? entry.linkedSteamAppId to manual games.
- Favorite-key consumers computed the key inline with game.appId || game.id — so a manual game that now has a numeric ppId read the appId instead of its canonical manual:<uuid> libraryId.
- Result: the existing favorite (manual:<uuid>) no longer matched (heart unchecked), and toggling created a NEW favorite under the appId. FavoritesSection resolves both keys against its identityMap → card rendered twice.

### Fixes

#### Part 1: Unified favorite key everywhere
- Added getFavoriteKey() usage at all inline sites (game.appId || game.id → getFavoriteKey(game) ?? game.id):
  - LibraryGameDetails.tsx L281 (avoriteId)
  - GameLauncherTile.tsx L142 (_favKey) + L818 toggle
  - SidebarLibraryList.tsx L718 (_sfk) + L771 toggle
  - FavoritesSection.tsx L217 (handleToggleFavorite)
  - ConsoleGameCard.tsx L22, ConsoleGameDetails.tsx L389/L723, ConsoleGameOptionsOverlay.tsx L49/L87, ConsoleGridLayout.tsx L68, ConsoleSpotlightLayout.tsx L81, ConsoleSwitchSpotlightLayout.tsx L118/L427
- getFavoriteKey (already in gameCacheService.ts:350): manual → libraryId, Steam → appId, Epic/other → libraryId, fallback id.

#### Part 2: Delete-only reconciler
- New econcileManualFavoriteKeys(manualGames) in gameCacheService.ts (after getFavoriteKey):
  - Rule: if BOTH ppId AND libraryId are in the favorites set → delete the ppId key.
  - "appId-only" case untouched (could be a real Steam favorite).
  - Idempotent; on change writes localStorage + dispatches lumaforge-data-changed with detail.key = "lumaforge-favorites-v1" (triggers FavoritesContext reload at L67).
- Hooked in LibraryGamesContext.tsx manual-games subscription effect: one-shot boot-time reconcile + per-change reconcile. Log [FAVORITES][RECONCILE].

#### Part 3: FavoritesSection defensive dedup
- FavoritesSection.tsx favoriteIds loop now also tracks libGame.libraryId || libGame.id in seen — a game reachable via both appId and libraryId renders only once.

### Key Files Changed
- src/services/gameCacheService.ts — FAVORITES_STORAGE_KEY + econcileManualFavoriteKeys()
- src/context/LibraryGamesContext.tsx — boot-time + per-change reconcile in manual subscription effect
- src/components/library/LibraryGameDetails.tsx, src/components/games/GameLauncherTile.tsx, src/components/layout/SidebarLibraryList.tsx, src/components/dashboard/FavoritesSection.tsx — getFavoriteKey call sites
- src/features/console/ConsoleGameCard.tsx, ConsoleGameDetails.tsx, ConsoleGameOptionsOverlay.tsx, ConsoleGridLayout.tsx, ConsoleSpotlightLayout.tsx, ConsoleSwitchSpotlightLayout.tsx — getFavoriteKey call sites + imports

### Build
- 	sc --noEmit ✅ (only pre-existing extension/test errors, none in touched files)
- ite build ✅ (2.93s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- cargo check ⏭️ skipped (no Rust changes)
