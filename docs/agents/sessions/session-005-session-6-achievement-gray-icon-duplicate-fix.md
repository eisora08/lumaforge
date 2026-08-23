## Session 6 — Achievement Gray Icon Duplicate Fix

### Problem
`resolveImageSource` for `remote-url` type ignored the `type` parameter when generating filenames. For Steam CDN URLs (the standard achievement image source), both `icon` and `icon_gray` URLs end with `<hash>.jpg`. The `icon_gray` source was saved as `hash.jpg` instead of `hash_gray.jpg`. On cache re-read, the `relative-schema-path` handler correctly added `_gray` suffix, triggering a second download — producing both `hash.jpg` and `hash_gray.jpg`.

### Part 1 — `resolveImageSource` remote-url filename fix
- `achievementImageQueue.ts:resolveImageSource` — remote-url case now extracts 40-char hex hash from URL and applies `_gray` suffix for `icon_gray` type
- Added `[ACH][IMG_RESOLVE]` diagnostic log with filename

### Part 2 — Role mismatch detection
- `achievementImageQueue.ts:enqueue` — detects when a gray source URL is accidentally enqueued as `type="icon"`, skips and logs `[ACH][IMG_ROLE_MISMATCH]`

### Part 3 — Gray dedup at queue level
- `achievementImageQueue.ts:enqueue` — when an icon job's hash matches an existing/completed icon_gray job's hash, skips the icon job (`[ACH][IMG_DEDUP_GRAY]`)
- Added dedup by filename across all queued jobs (not just per apiName+type)

### Part 4 — Distinct icon preservation
- Dedup logic only triggers when hash matches an existing gray job — distinct hashes pass through normally

### Part 5 — Existing cache repair
- `achievementStore.ts:repairGrayIconPaths` — reads cached `achievements.json`, finds entries where `icon_gray` is `img/<hash>.jpg` (without `_gray`), repairs to `img/<hash>_gray.jpg`, writes back
- Called during boot in `appBootCoordinator.ts` for first 5 apps in background repair phase (`[ACH][SCHEMA_REPAIR_GRAY]` log)

### Part 6 — Skip existing files before download
- `achievementImageQueue.ts:downloadItem` — checks `resolveAchievementImagePaths` for existing icon/icon_gray files before downloading, skips with `[ACH][IMG_SKIP]` log

### Part 7 — Dry-run duplicate detection
- `achievementImageQueue.ts:detectDuplicateGrayIcons` — scans img folder for `<hash>.jpg`/`<hash>_gray.jpg` pairs, checks which are referenced by schema, logs suspects via `[ACH][IMG_DUPLICATE_GRAY]`
- Exposed as `window.__detectDuplicateGrayIcons`

### Part 8 — Queue dedup enhancements
- Added dedup by destination filename across all queued jobs (not just per apiName+type)

### Rust side already correct
- `cdn_url_to_relative_icon_path` and `normalize_icon_url_for_cache` already produce correct `img/<hash>_gray.jpg` for gray icons — no Rust changes needed

### Key Files Changed
- `src/services/achievementImageQueue.ts` — Part 1, 2, 3, 4, 6, 7, 8
- `src/services/achievementStore.ts` — Part 5 (`repairGrayIconPaths`)
- `src/services/appBootCoordinator.ts` — Part 5 boot integration

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ✅ passes
