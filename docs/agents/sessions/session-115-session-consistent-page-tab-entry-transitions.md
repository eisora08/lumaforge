## Session � Consistent page/tab entry transitions (lf-page-in coverage + Store tab re-mount fix)

### Problem
Several pages and content switches had no entry animation while the rest of the app animates (`lf-page-in` 400ms translateY/fade). Root cause analysis found two issues:

1. **Missing `lf-page-in`**: `ActivityStats`, `LauncherAchievements`, `Tools`, `Verification` roots, and `StoreGameDetailsPage` roots (timeout/loading/main) lacked the class. `StoreGameDetailsPage` opened from Store.tsx (`selectedDetailGameWithOverlay`, routeKey stays "store") had zero entry transition.
2. **Store tabs dead animation**: All 5 tab branches already had `<div className="lf-tab-panel-in">`, BUT React reconciles the div (same position [0], same element type) across branches � the DOM node is recycled, the CSS animation only runs on first mount of the tab area, never re-fires on tab switch. Adding a unique `key` forces unmount/remount ? animation replays.

### Part 1: `lf-page-in` on page roots
- `src/pages/ActivityStats.tsx` � root `w-full px-6...` + `lf-page-in`
- `src/pages/LauncherAchievements.tsx` � root idem
- `src/pages/Tools.tsx` � root `space-y-6 p-5 lg:p-7` + `lf-page-in`
- `src/pages/Verification.tsx` � root `p-5 lg:p-7` + `lf-page-in`

### Part 2: `lf-page-in` on StoreGameDetailsPage
- `src/components/store/StoreGameDetailsPage.tsx` � all 3 roots (`space-y-6`): timeout (L1165), metadataLoading (L1189), main (L1221) + `lf-page-in`
- Covers Store.tsx?details (no routeKey change) and is harmless under GameDetails.tsx wrapper (already has `lf-page-in`)

### Part 3: Store tab re-mount via keys
- `src/pages/Store.tsx` � unique `key` on each tab wrapper: `store-tab-browse`, `store-tab-repacks`, `store-tab-lua`, `store-tab-news`, `store-tab-discover`
- Forces React to destroy/recreate the `<div className="lf-tab-panel-in">` on tab switch so `lfTabPanelIn` animation re-fires (was silent before)

### Part 4: Store in-page sections
- `src/pages/Store.tsx` � viewAll section (`space-y-5` ? + `lf-page-in`) and search results section (`space-y-4` ? + `lf-page-in`)

### Build
- `tsc --noEmit` ? (only the 23 pre-existing extension/test errors, none in touched files)
- `vite build` ? (2.16s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ?? skipped (no Rust changes)
