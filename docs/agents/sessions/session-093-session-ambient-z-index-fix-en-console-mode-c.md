## Session — Ambient z-index fix en Console Mode + corrección de alcance del hover desktop

### Goal
(1) Arreglar que el fondo ambiental global se renderizaba POR ENCIMA de toda la UI de Console Mode ("el dynamic se ve por encima de todo en vez de comportarse como fondo"). (2) Corregir el alcance del hover → ambient: solo en Library (única superficie sin hero); Dashboard y Store ya alimentan el ambient vía sus héroes.

### Part 1: Causa raíz del z-index console (confirmada)
- `AppLayout.tsx` rama console (L44-57): `<AmbientBackground />` (root `absolute inset-0 z-[1]`) se renderizaba como hermano ANTES de `<RouteErrorBoundary>{children}</RouteErrorBoundary>`, y el root de `ConsoleModePage` es `relative` con z-auto.
- En CSS, un elemento con z-index positivo (z-[1]) pinta POR ENCIMA de hermanos positioned z-auto → la capa ambient (arte blur opacity 30-55% + dim + gradiente) cubría toda la UI de console. Desktop no sufría el bug porque su contenido está envuelto en `relative z-10` (L132).
- El backdrop interno del panel derecho de `ConsoleGridLayout.tsx` (L351-357, `absolute inset-0` DOM-first + contenido `relative` DOM-later) estaba internamente correcto — el culpable era la capa global.

### Part 2: Fix
- `src/components/layout/AppLayout.tsx` rama console: `{children}` (providers + RouteErrorBoundary) envuelto en `<div className="relative z-10 h-full w-full">` — espejo del wrapper desktop L132.
- El ambient pasa a fondo real visible a través de las superficies `lf-console-glass`; los overlays internos console (z-[100]/z-[200]/z-[300]) quedan intactos por encima.

### Part 3: Alcance del hover desktop (corrección de alcance)
- Hover → ambient SOLO en Library (`GameLauncherTile.tsx`, ya implementado en la sesión previa: debounce 150ms, scope `"library-grid-hover"`). Library es la única superficie desktop sin hero propio.
- **Dashboard NO necesita hover**: `GameHero` ya alimenta el ambient (`setAmbientSource("dashboard", ...)` en todas sus rutas de resolución). Hover en sus cards (`lf-dash-card`, 6 secciones montadas en Home) sería redundante y ruidoso (parpadeo card→hero).
- **Store NO necesita hover**: `StoreDiscoverHeroCarousel` (hero del Discover) y `StoreGameDetailsPage` (galería de medios vía `onMediaSelect`) ya alimentan el ambient. Las cards `PackageCard`/`lf-virtual-card` no se tocaron.
- No se creó `AmbientHoverSurface` ni slot `_hover` en `ambientBackgroundStore.ts` — se descartaron por innecesarios.

### Key Files Changed
- `src/components/layout/AppLayout.tsx` — rama console: wrapper `relative z-10 h-full w-full` alrededor de children

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` ✅ (1.42s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos)
- `cargo check` ⏭️ skipped (no Rust changes)
