## Session — Apartado "Animaciones": selector de transición de hero/fondo (crossfade default)

### Goal
Añadir el apartado **"Animaciones"** en Ajustes con un selector de transición de hero/fondo (3 opciones) y aplicarlo a los 4 heros: LibraryGameDetails, GameHero (dashboard), StoreDiscoverHeroCarousel y ConsoleGameDetails.

### Decisiones (confirmadas por el usuario)
- **Crossfade = default en todos los heros** (incluye dashboard; el Ken Burns deja de ser fijo y pasa a ser opción).
- El **ambient global** siempre usa el crossfade premium — queda fuera del selector.
- El apartado Animaciones contiene solo el selector (sin toggles globales de animaciones menores).

### Part 1: `src/services/heroTransitionStore.ts` (nuevo)
- `HeroTransitionId = "crossfade" | "kenburns" | "focus"`; `HERO_TRANSITION_OPTIONS` (label + description por opción).
- localStorage `lumaforge-hero-transition`; `setHeroTransition` / `getHeroTransition` / `subscribeHeroTransition` / `getHeroTransitionSnapshot`.
- `emit()` asigna snapshot NUEVO por llamada (lección aprendida del bug `Object.is` del ambient store).

### Part 2: `src/hooks/useCrossfadeSrc.ts` (nuevo)
- `CROSSFADE_HOLD_MS = 650`; dos capas `{ prevSrc, currentSrc }`; la capa previa se mantiene montada (fade-out) mientras la nueva hace fade-in, y se limpia tras `holdMs`.
- `prevSrc` es `null` cuando no hay capa previa que conservar.

### Part 3: CSS en App.css
- `heroCrossfadeIn` (600ms ease-out both) → `.animate-hero-crossfade-in`
- `heroMediaOut` (600ms ease-in forwards) → `.animate-hero-media-out`
- `.animate-hero-kenburns-in` (combina `heroKenburns` 25s infinite alternate + `heroCrossfadeIn` 600ms)
- Guard `prefers-reduced-motion` con `animation: none !important` para las tres.

### Part 4: Aplicación en los 4 heros
- **LibraryGameDetails.tsx**: suscripción `useSyncExternalStore`; `sharpHeroClass` (kenburns→`animate-hero-kenburns-in`, focus→`animate-hero-focus-in`, else→`animate-hero-crossfade-in`) en la capa nítida.
- **GameHero.tsx** (dashboard): `heroBgClass` (kenburns→`animate-hero-kenburns`, focus→`animate-hero-focus-in`, else→`animate-hero-crossfade-in`) en el div `data-hero-bg-layer`.
- **StoreDiscoverHeroCarousel.tsx**: crossfade real de dos capas con `useCrossfadeSrc(ambientImage)` — capa previa `animate-hero-media-out` + capa actual `animate-hero-crossfade-in`; modos kenburns/focus con clase única. Reactivo a clicks y auto-advance de 7s.
- **ConsoleGameDetails.tsx**: `consoleHeroClass` (misma lógica) en el `<img>` del hero backdrop.

### Part 5: Settings.tsx — sección "Animaciones"
- Insertada justo después de la sección Apariencia (antes de Display).
- Selector segmentado de 3 columnas (mismo patrón que "Intensidad del fondo ambiental") con label + descripción por opción.
- Nota: "El fondo ambiental siempre usa la transición de fundido premium, independientemente de esta selección."

### Key Files Changed
- `src/services/heroTransitionStore.ts` — **nuevo** — store de la preferencia + opciones
- `src/hooks/useCrossfadeSrc.ts` — **nuevo** — hook de dos capas para surfaces de imagen única
- `src/App.css` — `heroCrossfadeIn`, `heroMediaOut`, `.animate-hero-kenburns-in`, reduced-motion guard
- `src/components/library/LibraryGameDetails.tsx` — `sharpHeroClass` en capa nítida
- `src/components/dashboard/GameHero.tsx` — `heroBgClass` en bg layer
- `src/components/store/StoreDiscoverHeroCarousel.tsx` — crossfade de dos capas + modos
- `src/features/console/ConsoleGameDetails.tsx` — `consoleHeroClass` en hero backdrop
- `src/pages/Settings.tsx` — sección Animaciones + suscripción al store

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` ✅ (1.97s, Rolldown; solo warnings preexistentes + INEFFECTIVE_DYNAMIC_IMPORT informativos)
- `cargo check` ⏭️ skipped (no Rust changes)
