## Session — Delete src/features/media/ directory (consolidate into existing services)

### Goal
Remove duplicated media pipeline files under `src/features/media/` by merging their logic into existing services. All 5 files were moved, exports re-exported, and the empty directory deleted.

### Results
- `src/features/media/` **deleted** — no longer exists
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (1992 modules, only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)

### File disposition

| File | Merged into | Notes |
|------|-------------|-------|
| `resolveGameTrailerByPriority.ts` | `gameMetadataResolver.ts` | `resolveGameHeroTrailers` coalesced into existing `resolveGameHeroTrailers`; `resolveGameTrailerByPriority` kept as thin wrapper |
| `resolveGameMediaByPriority.ts` | `gameCacheService.ts` | `resolveMediaByPriority` (sync), `from*` extractors, `resolve*` per-role, priority chain, `pickUrl`, `pickBackgroundUrl`, `isStorePageBackground`, types (`GameDetailsMediaOptions`, `MediaResolutionInputs`) all merged |
| `resolveGameDetailsArtwork.ts` | `gameCacheService.ts` | `resolveGameDetailsArtwork` (sync-first) and `resolveGameDetailsArtworkAsync` (network-backed) merged |
| `mediaProviderClient.ts` | `storeArtworkResolver.ts` | `fetchRawgArtworkDeduped` and `fetchIgdbArtworkDeduped` moved to existing artwork resolver service |
| `materializeGameMedia.ts` | `gameCacheService.ts` | `materializeResolvedGameMedia`, `clearMaterializeInFlight`, `MaterializeResult` export added |

### Key re-exports
All merged functions are re-exported from their new homes, so consumers (`LibraryGameDetailPage.tsx`, `libraryGameResolver.ts`, `GameLauncherTile.tsx`, etc.) continue to work with updated import paths.

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)
