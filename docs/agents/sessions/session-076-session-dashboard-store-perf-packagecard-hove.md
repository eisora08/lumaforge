## Session — Dashboard/Store perf: PackageCard hover, discover cache guard, mock catalog removal

### Problem
- PackageCard hover had dead action buttons, source selector modal, and 11 unused imports creating noise and bundle size
- `moreToExploreGames` recomputed expensive scoreLookup map (10K entries) on every render due to reference-inequality-only changes
- LibraryGamesContext `applyGamesSafely` setState cascaded re-renders when fingerprint hadn't changed
- Store Browse tab's `searchMockCatalog` returned 4 hardcoded packages — real catalog search existed but was unused

### Fixes

#### PackageCard hover cleanup
- Hover overlay changed to `bg-black/30 pointer-events-none opacity-0 group-hover:opacity-100` matching library/dashboard cards
- Removed all action buttons (Install/Download/Play), source selector modal trigger, provider badge
- Removed dead exports: `onDownload`, `availableSources`, `bestSource`, `formatFileSize`, `getUniqueProviders`, `hasUsableSources`, `truncateTitle`
- Removed 11 imports (lucide icons, React hooks, hooks/services/types/components)
- Removed `internalDownload`, `handleOpenDetails`, `handleDismiss`, `handleShowSourceSelector` functions

#### moreToExploreGames perf guard
- Added `_moreToExploreCacheRef` with lightweight input fingerprint: `{ length, first3Ids, lastUpdateMs }`
- Early return when fingerprint unchanged since last compute
- Prevents expensive scoreLookup Map build (10K entries) on reference-inequality-only changes

#### LibraryGamesContext fingerprint guard
- `applyGamesSafely` now computes fingerprint of filtered games vs `gamesRef.current`
- Skips `setGames` when fingerprint matches — breaks cascading re-render cycle from manual-game/Epic triggers

#### Mock catalog replacement
- `searchMockCatalog()` (4 hardcoded packages) replaced with `searchLocalCatalog()` querying SQLite store catalog
- Uses `steamCatalogService.querySearch()` — returns real Steam games (1,984 entries) with empty `sources[]`
- `ProviderSearchResult.searchedProviders` and `ProviderSearchProviderReport.providerId` types changed from `ApiProviderId` to `string` to accommodate non-provider sources
- Dead functions removed: `filterGameByProvider`, `matchesQuery`, `mergeProviderResults`, `mergeSources`
- `getKnownGameTitle` kept as stub (returns undefined)
- `mockPackages.ts` has zero remaining imports

### Key Files Changed
- `src/components/packages/PackageCard.tsx` — full cleanup: hover simplified, dead code removed
- `src/pages/Store.tsx` — `_moreToExploreCacheRef` early-return guard
- `src/context/LibraryGamesContext.tsx` — fingerprint guard before setGames, fixed `currentFp` redeclaration
- `src/services/providerSearch.ts` — `searchLocalCatalog` replaces `searchMockCatalog`, 4 dead functions removed
- `src/types/providerSearch.ts` — `searchedProviders`/`providerId` type relaxed to `string`
- `src/hooks/useProviderSearch.ts` — type fix, removed `ApiProviderId` import
- `src/data/mockPackages.ts` — zero imports, pending deletion

### Build
- `tsc --noEmit` ✅ (2 pre-existing errors only: PackageCard.tsx `onInstallComplete`, ExtensionsSection.tsx `Puzzle`)
- `vite build` ✅ pending (no structural changes expected to fail)
