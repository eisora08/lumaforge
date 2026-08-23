## Session — Console Mode: ambient background visible en toda la página (variable --console-bg)

### Goal
Que el fondo ambiental global se muestre en TODA la página de Console Mode desktop (zona de cards del grid, spotlight, details), no solo en el panel de detalles glass. El dynamic ya se veía en el panel; la zona de cards quedaba opaca.

### Part 1: Causa raíz
- Desktop logra transparencia porque `.lf-page { background: var(--page-bg) }` (App.css L209-211) y `:root[data-ambient="on"]` (L399-404) vuelve `--page-bg: transparent`. `--color-bg` NO se reasigna.
- Los roots de los layouts console usan `bg-(--color-bg)` OPACO directo, que tapa la capa ambient (z-[1] por detrás del wrapper z-10). No existen variables `--console-*` previas.

### Part 2: Variable `--console-bg` ambient-aware (App.css)
- `[data-console-theme] { --console-bg: var(--color-bg) }` — por defecto, el bg del tema console (se resuelve al color del mismo elemento donde el tema fija `--color-bg`).
- `:root[data-ambient="on"] [data-console-theme] { --console-bg: transparent }` — bajo ambient, el fondo de página console se vuelve transparente (espejo del contrato `--page-bg`).
- Definida tras el tema neon-noir (L1619+), antes de la sección de texturas.

### Part 3: Aplicación en los roots de layouts console
- `ConsoleGridLayout.tsx` L298 root → `bg-(--console-bg)` (zona de cards, cambio principal).
- `ConsoleSwitchSpotlightLayout.tsx` L186 root → `bg-(--console-bg)`.
- `ConsoleSpotlightLayout.tsx` L125 root → `bg-(--console-bg)`.
- `ConsoleGameDetails.tsx` L950 fallback del hero (sin heroSrc) → `bg-(--console-bg)`.

### Sin cambios (intencional)
- `AppLayout.tsx` rama console L46 `bg-(--color-bg)`: es la base POR DETRÁS de la capa ambient — queda como fallback.
- `ConsoleGridLayout.tsx` L355 overlay `bg-(--color-bg)/70`: dim del backdrop interno del panel derecho para legibilidad.
- `ConsoleSettingsPanelV2.tsx` L1914 `bg-(--color-bg)/95`: panel lateral interactivo — se mantiene opaco.
- Tarjetas (`ConsoleGameCard.tsx` `bg-(--color-surface)/40` + overlays) sin tocar: legibilidad intacta sobre el ambient.

### Key Files Changed
- `src/App.css` — `[data-console-theme]`/`:root[data-ambient=on] [data-console-theme]` + `--console-bg` (default/transparent)
- `src/features/console/ConsoleGridLayout.tsx` — root `bg-(--console-bg)`
- `src/features/console/ConsoleSwitchSpotlightLayout.tsx` — root `bg-(--console-bg)`
- `src/features/console/ConsoleSpotlightLayout.tsx` — root `bg-(--console-bg)`
- `src/features/console/ConsoleGameDetails.tsx` — fallback hero `bg-(--console-bg)`

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` ✅ (1.43s, Rolldown; verificado en dist: `[data-console-theme]{--console-bg:var(--color-bg)}`, `:root[data-ambient=on] [data-console-theme]{--console-bg:transparent}`, `background-color:var(--console-bg)`)
- `cargo check` ⏭️ skipped (no Rust changes)
