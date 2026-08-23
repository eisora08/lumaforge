## Session — RAWG/IGDB Optional Providers + Priority Resolver Integration

### Goal
Add RAWG and IGDB as graceful optional media providers in the Console Mode priority-based resolver, with settings fields, extractor functions, and proper priority chain placement.

### Part 1: Settings fields
- `rawgApiKey`, `igdbClientId`, `igdbClientSecret` added to `AppSettings` type in `src/types/settings.ts`
- Default empty-string values in `SettingsContext.tsx`
- No Settings UI yet — fields are read-only until a provider configuration page is built

### Part 2: Extractor functions (`resolveGameMediaByPriority.ts`)
- `fromRawg(input, kind)` — returns background role only (RAWG background artwork is the most useful asset for this provider; no clean covers/logos/icons)
- `fromIgdb(input, kind)` — returns cover and background roles (IGDB has clean cover art and artwork backgrounds)

### Part 3: Priority chain placement
- **Cover**: local → cached → SGDB → **IGDB** → metadata → imageUrl (RAWG skipped — no cover data)
- **Landscape**: local → cached → SGDB → metadata → screenshots → **IGDB** (RAWG skipped — no landscape data)
- **Background**: local → cached → SGDB → **RAWG** → **IGDB** → metadata → screenshots → landscape fallback
- **Logo/Icon**: unchanged (RAWG/IGDB don't provide these)

### Part 4: `MediaResolutionInputs` extended
- Added `rawgData?: RawgArtworkData | null` field
- Added `igdbData?: IgdbArtworkData | null` field
- Both are optional — null values skip the extractor gracefully

### Part 5: Build verification
- `tsc --noEmit` ✅ passes (0 errors)
- `vite build` ✅ passes (0 errors, only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

### Key Files Changed
- `src/features/media/resolveGameMediaByPriority.ts` — `fromRawg()`, `fromIgdb()`, updated `MediaResolutionInputs`, wired into resolveCover/resolveLandscape/resolveBackground, called from `resolveMediaByPriority`
- `src/types/settings.ts` — `rawgApiKey`, `igdbClientId`, `igdbClientSecret` fields
- `src/context/SettingsContext.tsx` — default empty-string values

### Relevant Files (created in prior sessions)
- `src/features/media/mediaProviderClient.ts` — `fetchRawgArtworkDeduped()`, `fetchIgdbArtworkDeduped()` with per-appId dedup, 8s timeout, graceful empty return on missing credentials
