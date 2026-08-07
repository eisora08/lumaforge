## Session — Console Trailers: Remote-only from metadata.movies[], remove all local file/cache lookups

### Problem
Console trailer preview tried to load local files from `media/trailers/` directory via `file:///` URLs, which the WebView blocked. The prior approach of converting local paths through `localPathToUrl` → `http://asset.localhost/...` added complexity with local cache download, stale file handling, and fallback logic that wasn't needed. The correct design is remote-only: use Steam movie links from `metadata.movies[]` directly, never touch local trailer files.

### Decision
- Console trailer videos use remote Steam movie links from `metadata.movies[]` only
- No download/cache of full trailer videos
- No search for local MP4/WebM trailer files
- No embedded `about_the_game`/`detailed_description` videos
- No `file://` local trailer paths

### Part 1 — `consoleTrailerData.ts`: Remove all cache code
- Removed `cacheTrailerFile` import from `tauri.ts`
- Removed `CachedTrailerResult`, `TRAILER_VIDEO_CACHE_ENABLED`, `_cachedTrailerKeys`, `DEBUG_CACHE`
- Removed `extractExt()`, `cacheTrailerForMovie()`, `cacheBestTrailer()`, `clearCachedTrailerKeys()`
- `extractTrailerData` now purely derives from `metadata.movies[]` — no API calls, no side effects

### Part 2 — `ConsoleGameDetails.tsx`: Remove cache wiring
- Removed `cacheBestTrailer` import and call
- Removed `CachedTrailerResult` type import
- Removed `cachedTrailer` state and `setCachedTrailer`
- Removed cache effect block in `useEffect`
- Removed `localVideoPath`/`localThumbnailPath` from `ConsoleSelectedPreview` JSX props

### Part 3 — `ConsoleSelectedPreview.tsx`: Remote-only, no local paths
- Removed `localPathToUrl` import
- Removed `localVideoPath`/`localThumbnailPath` props
- Removed `localMediaFailed` state, `safeLocalThumbnailUrl`/`safeLocalVideoUrl` useMemos
- Removed `useEffect` for resetting error states on local paths
- Image priority (simplified): `trailerData.thumbnail` → `movies[0].thumbnail` → `screenshots[0]` → landscape/background fallback
- Video priority (simplified): `trailerData.mp4Url` → `trailerData.webmUrl` → null (HLS/DASH → disabled overlay)
- `handleImgError` simplified: no local vs remote detection, always sets `imgError`
- `<img>` key retains `${appId}-${displaySrc}` pattern for fresh mount on src change

### Cuphead (appId=268910) expected behavior
- Trailer thumbnail: remote `movie.thumbnail` URL (e.g. `https://shared.akamai.steamstatic.com/...`)
- `hasDirectVideo=false`, `hasStreamFallback=true` (HLS/DASH only)
- Play overlay: disabled `CircleSlash` with "Stream preview unavailable" tooltip
- No `file:///` loading attempts
- No `media/trailers/*` lookup

### Key Files Changed
- `src/features/console/consoleTrailerData.ts` — stripped all cache/download code (6 functions, 3 constants removed)
- `src/features/console/ConsoleGameDetails.tsx` — removed `cacheBestTrailer`, `CachedTrailerResult`, `cachedTrailer` state, cache effect, local path props
- `src/features/console/ConsoleSelectedPreview.tsx` — remote-only image/video priority, removed all local path handling, simplified error handling

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)
