## Session 12 — Sidebar collapse toggle refactor + auto-repair hotfix

### Step 48: Remove floating chevron, add PanelLeft toggle
- Removed floating chevron button (`absolute -right-3 top-24`) from `Sidebar.tsx`
- Added `PanelLeftClose`/`PanelLeftOpen` toggle in sidebar header right side
- Replaced `ChevronLeft`/`ChevronRight` imports with `PanelLeftOpen`/`PanelLeftClose`

### Step 49: Merge logo and toggle
- Logo container acts as toggle when collapsed: Flame fades out, PanelLeft fades in on hover
- Removed standalone right-side PanelLeft button

### Step 50: Refine toggle placement
- **Expanded header**: `justify-between px-5` — static logo on left, separate `PanelLeftClose` button on right (no hover-swap)
- **Collapsed header**: `justify-center px-2` — centered logo button with hover-swap Flame→PanelLeftOpen; click expands
- Reverted collapsed width to `w-[72px]`
- Drawer mode unchanged (X close on right)

### Hotfix: Auto-repair all 5 media roles
- Fixed bug in `executeRepairGameMedia` where stale relative paths (e.g., `"logo.png"`) were truthy non-HTTP strings → skipped to "already-on-disk" → never consulted `mediaSources`
- Restructured: `const httpUrl = (url && typeof url === "string" && url.startsWith("http")) ? url : null;` — only HTTP URLs trigger primary download; everything else falls through to `mediaSources`
- Created shared `CANONICAL_GAME_MEDIA_ROLES` constant (`gameCacheService.ts:62`) — used by `backgroundJobQueue.ts:334` instead of inlined roles array
- All 5 roles (cover, landscape, background, logo, icon) now get downloaded even when appinfo has stale local paths
- Rust `safe_download_image` skips existing files, so redundant downloads are safe

### Key Files Changed
- `src/components/layout/Sidebar.tsx` — header restructured (expanded: static logo + PanelLeftClose; collapsed: centered logo hover-swap)
- `src/services/backgroundJobQueue.ts` — `executeRepairGameMedia` URL check restructured, uses `CANONICAL_GAME_MEDIA_ROLES`
- `src/services/gameCacheService.ts` — `CANONICAL_GAME_MEDIA_ROLES` constant exported

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ✅ passes
