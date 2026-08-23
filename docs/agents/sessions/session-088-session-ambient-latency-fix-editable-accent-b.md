## Session � Ambient latency fix + editable accent + blur intensity + Fluent 2/Mica/Acrylic audit

### Goal
(1) Fix ambient background updating late/stale across page navigation, (2) make the theme accent color user-editable, (3) add subtle blur intensity levels, (4) audit a Fluent 2 + Mica/Acrylic + Dynamic Effect global theme overhaul (spec only � no UI overhaul executed).

### Part 1: Ambient store � two-slot source model
- `src/services/ambientBackgroundStore.ts` rewritten:
  - **`_detail` slot** � active-page scoped source (`dashboard`, `library-details`, `console-details`) set via `setAmbientSource(scope, url)` while a surface is mounted; cleared on unmount.
  - **`_context` slot** � navigation-level fallback set via `setPageContextSource(url)` on every page change (`page-context` scope); `clearPageContextSource()` resets it.
  - `clearAmbientSource(scope)` now falls back to the context URL instead of nulling the ambient entirely � fixes the flash-to-black when navigating between games/pages while detail art is still resolving.
  - Snapshot shape `{ url, enabled, intensity }`; same `subscribeAmbient`/`getAmbientSnapshot` contract (backward compatible).
- **Sync first-paint feeds** (before async resolution):
  - `LibraryGameDetails.tsx` � first effect feeds from `imageUrl` OR raw in-memory snapshot path (`game.backgroundPath ?? landscapePath ?? coverPath`) via `localPathToUrl`/`isLocalPath`, skipping relative `media/`/`img/`/`games/` prefixes (async effect upgrades those later).
  - `GameHero.tsx` � parallel synchronous feed effect (deps: `runningLibGame, heroAppId, heroGame?.media.*, heroManualGame, heroEpicGame`); new imports `localPathToUrl`, `isLocalPath`.
- **Nav fallback** (`App.tsx`): new `AmbientNavFallback({ activePage })` mounted inside `GameDetailsProvider` after `GameSessionHUD`; feeds `selectedGame.imageUrl` if present, else first snapshot game with `backgroundPath ? landscapePath ? coverPath`, else `games[0]`; skips relative provider paths; clears context otherwise.

### Part 2: Editable accent color
- `src/context/ThemeContext.tsx` � new `accentOverride: string | null` + `setAccentOverride(hex | null)`; storage key `lumaforge-accent` (validates `HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/`); theme effect applies `--color-accent` + derived `--color-accent-text` (luminance threshold 0.62 ? near-black vs white) after `themeVariables[theme]`; synced across windows via `lumaforge-data-changed`; `useMemo` value includes the new members.
- `src/components/settings/AccentColorPicker.tsx` � **new** � native `<input type="color">` bound to `useTheme().accentOverride`/`setAccentOverride`, live hex display, "Restaurar" button clearing to null; `lf-surface rounded-2xl border p-4` styling; swatch shows theme accent (`themeVariables[selectedTheme]["--color-accent"]`) when no override.
- `src/pages/Settings.tsx` � picker mounted in Apariencia section (below theme grid, above surface modes); `themeVariables` + `accentOverride`/`setAccentOverride` destructured.

### Part 3: Ambient blur intensity
- `ambientBackgroundStore.ts` � `AmbientIntensity = "sutil" | "equilibrado" | "vivido"` (default `equilibrado`), `setAmbientIntensity`/`getAmbientIntensity`, localStorage `lumaforge-ambient-intensity`.
- `src/components/layout/AmbientBackground.tsx` � reads `intensity`; mapping: `sutil` ? `blur-xl` + art `opacity-30` + `bg-black/50`; `equilibrado` ? `blur-2xl` + `opacity-40` + `bg-black/45`; `vivido` ? `blur-3xl` + `opacity-55` + `bg-black/40`.
- `src/pages/Settings.tsx` � 3-option segmented control (Sutil/Equilibrado/V�vido) under the ambient toggle, hidden when ambient disabled.

### Part 4: Fluent 2 + Mica/Acrylic + Dynamic Effect audit (spec � no overhaul)
Mapping of Windows 11 Fluent 2 concepts to existing LumaForge infrastructure:

| Fluent 2 concept | Current LumaForge infra | Status |
|---|---|---|
| **Mica backdrop** (desktop wallpaper bleed) | `:root[data-theme="fluent"] .lf-backdrop` neutral radial glows; `data-ambient=on` makes shell translucent showing ambient art | Partial � Mica reads OS wallpaper, we use ambient art instead |
| **Acrylic material** (translucent blur) | `--shell-blur: blur(24px)` + `--shell-bg: color-mix(... 55%, transparent)` when `data-ambient=on` | Present via CSS `backdrop-filter` |
| **Reveal/Hover glow** | `--surface-active-border`, `hover:bg-white/10`, accent hovers | Partial � no dynamic pointer-lighting |
| **Dynamic Effect** (accent flows through UI, but keep solid surfaces opaque) | `--color-accent` theming + new `accentOverride`; solid surface mode keeps `--shell-bg` opaque | Accent editable now; effect flow = theme+accent vars |
| **Accent color picker** | Settings ? Apariencia ? AccentColorPicker | Implemented (Part 2) |
| **Mica/acrylic tint** | `--color-bg` + `--shell-border: rgba(255,255,255,0.14)` for liquid-glass | Present |
| **Window chrome** | `TopBar.tsx` merged window controls, `--shell-bg` header | Present |
| **Dynamic Effect per-surface** | No per-surface accent derivation (e.g. buttons vs selected nav pill) | **Gap** � future: compute `--color-accent-soft`/`--color-accent-strong` variants |
| **System accent detection** | None � accent always from theme | **Gap** � future: read `windows` registry accent via Rust |
| **Mica OS wallpaper capture** | None � uses ambient art instead | **Gap** � future: Tauri `windows` crate capture |

**No UI overhaul executed** � Parts 1-3 are the deliverable; Part 4 documents the roadmap (per-surface Dynamic Effect variants, system-accent detection, Mica OS capture) for a future session.

### Key Files Changed
- `src/services/ambientBackgroundStore.ts` � two-slot model, page-context API, intensity state/persistence
- `src/components/layout/AmbientBackground.tsx` � intensity ? blur/dim/opacity mapping
- `src/components/settings/AccentColorPicker.tsx` � **new** � accent picker + reset
- `src/pages/Settings.tsx` � accent picker mount + intensity segmented control
- `src/context/ThemeContext.tsx` � accentOverride apply/persist/sync
- `src/App.tsx` � `AmbientNavFallback` component
- `src/components/library/LibraryGameDetails.tsx` � synchronous ambient feed from snapshot path
- `src/components/dashboard/GameHero.tsx` � synchronous ambient feed + `localPathToUrl`/`isLocalPath` imports

### Build
- `tsc --noEmit` ? (only 23 pre-existing extension/test errors, none in touched files)
- `vite build` ? (2.00s, Rolldown; verified `sutil/equilibrado/vivido` + "Color de acento" strings in bundle)
- `cargo check` ?? skipped (no Rust changes)
