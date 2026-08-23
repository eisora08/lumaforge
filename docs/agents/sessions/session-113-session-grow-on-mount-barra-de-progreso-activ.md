## Session — Grow-on-mount: barra de progreso ActiveDownloadCard + barra de achievements del GameDetails

### Goal
Restaurar la animación de entrada (grow desde 0) de las barras de progreso, perdida en el rediseño premium del ActiveDownloadCard, y extenderla a la barra de progreso del panel de achievements del GameDetails de Library. Patrón replicado del de Stats/Logros (transición CSS de width/height sobre un estado `entered` activado tras el primer paint).

### Part 1: Hook `useGrowOnMount` (`src/hooks/useGrowOnMount.ts` — **nuevo**)
- Devuelve `false` en el primer render y `true` tras el siguiente `requestAnimationFrame`.
- Bajo `prefers-reduced-motion: reduce` resuelve a `true` inmediatamente (barra al valor final, sin flash de barra vacía).
- Se empareja con las transiciones CSS ya existentes en el elemento objetivo.

### Part 2: ActiveDownloadCard.tsx
- **Barra de progreso principal** — `transform: scaleX(${grow ? progressValue : 0})` (el fill ya usa `origin-left` y la transición `.lf-download-progress-fill`).
- **SpeedChart** — mismo hook dentro del subcomponente; barras `style={{ height: ${grow ? h : 0}% }}` (transición `.lf-download-chart-bar` ya existente).
- **Sin `transition-delay`/stagger**: el delay persistiría en las actualizaciones en vivo del chart. Todas las barras crecen juntas.
- Doc comment del SpeedChart actualizado.
- Sin cambios en `App.css` (transiciones y guards reduced-motion ya existen).

### Part 3: LibraryGameDetails.tsx — barra de achievements
- Bloque de la barra de progreso del panel extraído a subcomponente interno `AchievementProgressBar({ unlocked, total, isPerfected, syncing })`.
- Usa `useGrowOnMount()` internamente → `width: ${grow ? percent : 0}%` con el `transition-all duration-500` existente.
- La extracción es necesaria porque el panel aparece de forma asíncrona (`achievementsSummary` puede cargar después del mount raíz); un estado en el raíz ya estaría `true` antes de que la barra monte y no se vería la animación.
- Solo la barra — el contenedor del panel NO se anima (decisión del usuario).
- Re-mount keyed (`LibraryGameDetailPage.tsx:1233`, `key=library:game-details:{source}:{appId}`) re-ejecuta la animación al cambiar de juego.

### Sin cambios en Downloads.tsx
- `ActiveDownloadRow` ya keyed por `job.id` → re-mount al cambiar descarga activa re-ejecuta la animación; el mock preview la muestra al entrar.

### Key Files Changed
- `src/hooks/useGrowOnMount.ts` — **nuevo** — hook de grow-on-mount con guard reduced-motion
- `src/components/downloads/ActiveDownloadCard.tsx` — `scaleX` condicional en la barra de progreso + `height` condicional en las barras del SpeedChart
- `src/components/library/LibraryGameDetails.tsx` — subcomponente `AchievementProgressBar` con grow-on-mount

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en tocados)
- `vite build` ✅ (2.13s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos)
- `cargo check` ⏭️ skipped (no Rust changes)
