## Session 7 — GameHero selection, hover overlay, render spam, heart icon

### Step 25: GameHero selection + hover overlay + render spam
- **GameHero selection logic**: Deterministic priority chain — running > lastPlayed > favoriteWithMedia > validMedia > installed > titledFallback. Added `[DASH][HERO_SELECT]`, `[DASH][HERO_RUNNING]`, `[DASH][HERO_CLEAR_RUNNING]` diagnostic logs (only log on change). Playtime store consulted for up-to-date lastPlayed.
- **Dashboard card hover**: Removed `group-hover/card:scale-105` image zoom from all 6 sections. Added dark overlay `bg-black/30 opacity-0 group-hover/card:opacity-100` matching Library card hover. No padding/margin changes on hover — prevents layout shift.
- **Render spam**: `[MEDIA][GRID_RENDER]` in GameLauncherTile gated behind ref-based change detection (only logs when state changes).

### Step 27: Star → Heart replacements + PopularPicksSection
- **Star → Heart**: FavoritesSection, LibraryPreview, LibraryGameDetails all use Heart icon. Active: `text-rose-400 fill-current` with `bg-black/50` dark translucent bg. Inactive: no fill, muted color. GameDetails achievements stat keeps Star (not a favorite toggle).
- **PopularPicksSection created** (Step 27): Reads global catalog from `readAllGames()` (SQLite). Filters tool/system apps ("Steamworks", "Redistributable", "Utilities"). Excludes user's library games. Prefers games with metadata/media. Sorted by `updatedAt` descending.
- **`[DASH][RECOMMEND]` diagnostic log**: Added to RecommendedSection with `source=personalized|fallback`, `appIds`, and genre tags (gated by ref).
