## Session — Console Mode Focus Zones + Media Carousel Redesign

### Goal
Replace the flat two-column ConsoleGameDetails layout with a focus-zone model (left panel / media carousel / info cards / action hints) with keyboard navigation and console-style focus visuals. Rewrite ConsoleMediaGallery as a pure carousel, removing all video player code.

### Part 1: ConsoleMediaGallery — pure carousel
- `src/features/console/ConsoleMediaGallery.tsx` fully rewritten
- Horizontal scroll with `scroll-snap-x`, thumbnail grid, focus ring on selected item
- Trailers get play icon overlay (`Play` circle) with `bg-black/60` badge; screenshots get index badges
- Click handler delegates to parent via `onSelectMediaIndex(index)`
- No video player, no preview, no autoplay logic

### Part 2: ConsoleGameDetails — focus zone restructure
- **Focus zones**: Left panel (Identity + Actions + Stats + Description + Genres) → Media carousel → Info cards (Achievements + Reviews) → Action hints
- **Keyboard navigation**: ArrowUp/ArrowDown/ArrowLeft/ArrowRight move focus between zones, Enter selects media, Escape blurs
- **Console-style focus**: `ring-2 ring-(--color-accent)/60 shadow-lg shadow-(--color-accent)/25` with `transition-all duration-150` on focused element
- **Media carousel**: Trailers sorted by priority (MP4 → WebM → HLS) via `useMemo`, then screenshots. Trailers get play icon, screenshots get index badges
- **Video state** (`selectedMediaIndex`, `isPlayingMuted`, `showFullPlayer`, `isVideoPlaying`) lifted to ConsoleGameDetails and passed down to both Gallery and Preview
- **Left panel**: `overflow-y-auto` with `fade-edges` mask (top/bottom gradient `from-transparent via-background via-80% to-transparent`)
- **Action hints** row in `ConsoleCategoryBar` stub area, dynamically reflects current focus zone actions

### Part 3: ConsoleSelectedPreview — effect-based autoplay
- `useEffect` watches `(mediaType, selectedIndex, appId)` — autoplay fires only when these change, not on every render
- `<video key={\`${appId}-${mediaType}-${selectedIndex}\`}>` remounts on media type / index change, ensuring fresh video element
- Fullscreen button wired to `requestFullscreen()` on preview container ref
- A/V indicator badge shows resolution + framerate for trailers

### Key Files Changed
- `src/features/console/ConsoleMediaGallery.tsx` — full rewrite as pure carousel (removed all video player code)
- `src/features/console/ConsoleGameDetails.tsx` — focus zones, keyboard nav, media carousel, video state lifted, left panel fade edges, action hints
- `src/features/console/ConsolePreview.tsx` — `key` remount + effect-based autoplay

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)
