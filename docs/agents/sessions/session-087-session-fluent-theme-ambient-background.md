## Session — Fluent theme + Ambient background

### Goal
Add a Windows 11-style "Fluent" theme (neutral Mica-like backdrop optimized for Liquid Glass) and a global ambient background: the active game's artwork shown blurred behind the whole UI, with translucent shell surfaces so the art shows through (acrylic effect) on every screen.

### Part 1: Fluent theme
- `src/theme/themes.ts` — new `fluent` theme added to the `themes` list + `themeVariables` (neutral dark grays: bg `#1f1f1f`, surface `#2b2b2b`, accent `#60cdff`); description "Estilo Windows 11 con acento azul y superficies de vidrio. Ideal con Liquid Glass."
- `src/types/theme.ts` — `"fluent"` added to `ThemeId` union
- `src/App.css` — neutral Mica-like backdrop for `:root[data-theme="fluent"] body` + `.lf-backdrop` (blue-tinted radial glows over a `#23252a → bg` linear gradient); `:root[data-theme="fluent"][data-surface="liquid-glass"]` gets `--shell-border: rgba(255,255,255,0.14)` + deeper `--surface-active-shadow`
- Renders through the existing theme grid in Settings automatically (no new UI)

### Part 2: Ambient background store (`src/services/ambientBackgroundStore.ts` — **new**)
- Module-level store: `url`, `scope`, `enabled` + listener set; snapshot object consumed via `useSyncExternalStore`
- localStorage key `lumaforge-ambient-background` (`"1"`/`"0"`), read once at module init
- `setAmbientSource(scope, url)` — scoped writes, last-scope-wins, emits only on change; `clearAmbientSource(scope)`
- `setAmbientEnabled(bool)` — persists + emits; `isAmbientEnabled()`, `subscribeAmbient()`, `getAmbientSnapshot()`
- Syncs `document.documentElement.dataset.ambient = "on" | "off"` on every emit

### Part 3: AmbientBackground component (`src/components/layout/AmbientBackground.tsx` — **new**)
- `useSyncExternalStore` on the store; renders `null` when disabled or no URL
- Fixed full-screen `pointer-events-none absolute inset-0 z-[1] overflow-hidden` layer, mounted in `AppLayout.tsx` right after `.lf-backdrop` in BOTH the Desktop layout and the Console Mode layout
- Art `<img>`: `animate-ambient-in h-full w-full scale-110 object-cover blur-2xl` at `opacity-40`, crossfade handled by `key={url}` remount
- Overlays: `bg-black/45` dim + `bg-linear-to-t from-(--color-bg)/75 via-transparent to-(--color-bg)/40` bottom blend into the UI background

### Part 4: Translucent shell CSS (`src/App.css`)
- `:root[data-ambient="on"]` makes the shell/page translucent so the art shows through: `--page-bg: transparent`, `--shell-bg: color-mix(in srgb, var(--color-bg) 55%, transparent)`, `--shell-blur: blur(24px)`, `--shell-border: color-mix(in srgb, var(--color-border) 60%, transparent)`
- `ambientIn` keyframes (opacity 0→1) + `.animate-ambient-in` (500ms ease-out both); disabled under `prefers-reduced-motion`

### Part 5: Source feeding (3 surfaces)
- **GameHero.tsx (dashboard)** — every background resolution path now also calls `setAmbientSource("dashboard", url)` on success and `clearAmbientSource("dashboard")` on null/error; unmount effect clears
- **LibraryGameDetails.tsx** — feeds the resolved `imageUrl` as scope `"library-details"`; clears on `game.appId` change + unmount
- **ConsoleGameDetails.tsx** — feeds `heroSrc` as scope `"console-details"`; clears on game change + unmount

### Part 6: Settings toggle
- `src/pages/Settings.tsx` — "Fondo ambiental" `ToggleOption` in the Apariencia section ("Muestra el arte del juego activo (difuminado) detrás de la interfaz en todas las pantallas."), bound via `useSyncExternalStore` + `setAmbientEnabled`

### Key Files Changed
- `src/services/ambientBackgroundStore.ts` — **new** — ambient store + dataset sync
- `src/components/layout/AmbientBackground.tsx` — **new** — ambient art layer component
- `src/App.css` — fluent backdrop, `:root[data-ambient=on]` shell overrides, `ambientIn` keyframes
- `src/components/layout/AppLayout.tsx` — AmbientBackground mounted (Desktop + Console)
- `src/components/dashboard/GameHero.tsx` — ambient source feed for dashboard hero
- `src/components/library/LibraryGameDetails.tsx` — ambient source feed for library details
- `src/features/console/ConsoleGameDetails.tsx` — ambient source feed for console details
- `src/pages/Settings.tsx` — "Fondo ambiental" toggle
- `src/theme/themes.ts` + `src/types/theme.ts` — Fluent theme

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (Rolldown; verified in dist: `animate-ambient-in` + `ambientIn` keyframes, `:root[data-ambient=on]` overrides, `from-(--color-bg)` gradient utilities, AmbientBackground module + "Fondo ambiental" settings row all present)
- `cargo check` ⏭️ skipped (no Rust changes)

