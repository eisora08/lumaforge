## Session — Grow-on-mount en páginas LauncherAchievements y ActivityStats (barras + gráficos)

### Goal
Extender la animación de entrada grow-on-mount (sesión previa) a los pages de Achievements (`LauncherAchievements.tsx`) y Stats (`ActivityStats.tsx`), que no tenían animación al entrar: animar todas las barras de progreso y gráficos con `useGrowOnMount`.

### Part 1: Componente compartido `LevelRing` (`src/components/activity/LevelRing.tsx` — nuevo)
- Anillo de nivel/XP reutilizable que crece el stroke desde vacío hasta `percent` al montar (page-entry) vía `useGrowOnMount` + `transition-all duration-700` existente.
- Props opcionales: `svgClassName` (default `h-24 w-24`), `levelClassName` (default `text-2xl`), `labelClassName` (default `text-[8px]`) — permite ambos tamaños (Stats h-24, Achievements h-28).
- `strokeDashoffset = C * (1 - percent/100)` con `C = 2π·38`; `grow ? percent : 0`.

### Part 2: Componente compartido `GrowBar` (`src/components/common/GrowBar.tsx` — nuevo)
- Barra de ancho genérica que crece de 0 a `percent` al montar vía `useGrowOnMount` + `transition-all duration-700` en el fill.
- Props: `percent`, `minPercent?` (reserva un sliver visible para valores ~0, p.ej. `Math.max(2, ...)` en XP bars), `trackClassName?`, `fillClassName?`.

### Part 3: ActivityStats.tsx
- **Play Activity Chart** — bloque de barras de altura extraído a subcomponente `PlayActivityBars({ activityByDay, maxDaySeconds })` con `useGrowOnMount()` interno; cada barra `style={{ height: grow ? h% : 0% }}` (transición `transition-all` existente).
- **Level circle** — reemplazado por `<LevelRing percent={profile.progressPercent} level={profile.level} />`.
- **XP bar** — reemplazada por `<GrowBar percent={profile.progressPercent} minPercent={2} trackClassName="h-2.5 rounded-full bg-white/[0.06]" fillClassName="bg-linear-to-r from-amber-500 to-amber-400" />`.
- La extracción a subcomponentes es necesaria porque `games` (context) llega async; un estado raíz ya estaría `true` antes de que los gráficos monten.

### Part 4: LauncherAchievements.tsx
- **Level circle** — reemplazado por `<LevelRing ... svgClassName="h-28 w-28" levelClassName="text-3xl" labelClassName="text-[9px]" />`.
- **XP bar** (featured card) — reemplazada por `GrowBar` con `minPercent={2}`.
- **Completion bar** — reemplazada por `GrowBar` (track `h-2`, fill `from-(--color-accent) to-(--color-accent)/70`).
- **Category bars** — cada barra de categoría (en `.map`) reemplazada por `GrowBar` (track `h-1`, fill `bg-(--color-accent)/50`).
- Sin cambios en Achievement cards ni contenedores de panel.

### Key Files Changed
- `src/components/activity/LevelRing.tsx` — **nuevo** — anillo de nivel animado compartido
- `src/components/common/GrowBar.tsx` — **nuevo** — barra de progreso animada compartida
- `src/pages/ActivityStats.tsx` — `PlayActivityBars` subcomponente, `LevelRing`, `GrowBar` (chart + anillo + XP)
- `src/pages/LauncherAchievements.tsx` — `LevelRing` + `GrowBar` (anillo + XP + completion + categorías)

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en tocados)
- `vite build` ✅ (2.15s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos)
- `vitest run` ✅ 802 passed / 4 failed (solo los 4 preexistentes: sourceManagerDeclarativeWiring ×3 + tools.test extractToolConfig)
- `cargo check` ⏭️ skipped (no Rust changes)
