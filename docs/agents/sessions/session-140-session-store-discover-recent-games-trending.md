## Session — Store Discover: "Recent Games" + "Trending Games" sections + 6-card cap

### Goal
Add two new SteamSpy-powered sections to Store Discover, cap ALL discover sections at 6 cards with "Ver todo" for full browsing.

### Sections (7 total Free sections on Discover)
| Section | Source | Endpoint | Description |
|---------|--------|----------|-------------|
| **Free — Recent** | SteamSpy `top100in2days` | `ccu` sorted | "Fresh releases getting attention right now." |
| **Free — Trending** | SteamSpy `top100in2weeks` | `players_2weeks` sorted | "Games with sustained momentum over 2 weeks." |
| **Free — Top Players** | SteamSpy `top100in2weeks` | `ccu` sorted | "Highest player count right now." |
| **Free — Leaderboard** | SteamSpy `all` | `players_total` sorted | "All-time most owned free games." |
| **Free — Featured** | Curated whitelist | `freeAppIds[]` | "Hand-picked free games worth trying." |
| **Free — Hidden Gems** | SteamSpy `top100in2weeks` | `owners` sorted | "Low owner count, high review scores." |
| **Free — Most Played** | SteamSpy `all` | `ccu` sorted | "Free games people are playing right now." |

### Parts implemented

#### Part 1: `freeCatalogService.ts` — `getRecentGames()`
- New function using SteamSpy `top100in2days` endpoint
- Sorted by `ccu` (current concurrent players) to capture new releases getting attention
- Shared 5-min TTL cache with other SteamSpy endpoints
- Throttled to 1 req/sec

#### Part 2: `freeCatalogService.ts` — `getTrendingGames()` rewritten
- Changed from delegating to `getTopByPlayers()` to using `top100in2weeks` directly
- Sorted by `players_2weeks` (sustained 2-week momentum, not snapshot CCU)
- Description updated to: "Games with sustained momentum over 2 weeks."

#### Part 3: `Store.tsx` — `freeRecentGames` state + fetch
- Added `freeRecentGames` state at ~L611
- Added `getRecentGames` to the `Promise.allSettled` batch at ~L675
- Added `_seedFreeFromCache("free-recent")` for cache hydration
- Dedup logic added to prevent double-render with existing sections

#### Part 4: `Store.tsx` — `discoverSections` push block
- Added `free-recent` section as FIRST in the Free push block (before `free-trending`)
- Section type `"rail"`, source `"free-catalog"`
- Falls back to cached `allStoreSections` when empty

#### Part 5: `Store.tsx` — 6-card cap for ALL sections
- Changed `isFreeCatalog ? 6 : SECTION_GRID_COUNT` → just `6` for all sections
- Removed unused `SECTION_GRID_COUNT = 24` constant
- Every section now shows at most 6 games with "Ver todo" button

#### Part 6: `Store.tsx` — View All for non-genre sections
- Updated the View All effect to handle non-genre section IDs (`free-*`, `for-you`, `top-picks`)
- When `activeSectionId` starts with `free-`/`for-you`/`top-picks`, finds the section in `allStoreSections` and populates `viewAllGames` from `section.games`
- Sets `viewAllHasMore = false` (static, no more pages)
- `activeSection.description` used as subtitle for non-genre sections

#### Part 7: `Store.tsx` — description map for all Free sections
- `free-recent`: "Fresh releases getting attention right now."
- `free-trending`: "Games with sustained momentum over 2 weeks."
- `free-top-players`: "Highest player count right now."
- `free-leaderboard`: "All-time most owned free games."
- `free-featured`: "Hand-picked free games worth trying."
- `free-hidden-gems`: "Low owner count, high review scores."
- `free-most-played`: "Free games people are playing right now."

### Key Files Changed
- `src/services/freeCatalogService.ts` — `getRecentGames()` (new), `getTrendingGames()` rewritten
- `src/pages/Store.tsx` — `freeRecentGames` state, fetch effect, `discoverSections` push, 6-card cap, View All for non-genre sections, description map

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.78s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
