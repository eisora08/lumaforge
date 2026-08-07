## Session — Console Grid hover backdrop + Library hover ambient + always-fixed footer

### Goal
(1) En Console Mode grid: backdrop dinámico del panel derecho según la card enfocada/hovered, con cambio **instantáneo** y alimentación del ambient store global. (2) En Library: footer de paginación **siempre fijo** abajo (también con "Show All" y 0 resultados). (3) Disparar el fondo ambiental global al hacer hover sobre cualquier card de Library.

### Part 1: ConsoleGameCard hover hooks
- `ConsoleGameCard.tsx` — props opcionales `onHover?: (game) => void` / `onHoverEnd?: () => void`; root div (rol button) conecta `onMouseEnter={() => onHover?.(game)}` + `onMouseLeave={() => onHoverEnd?.()}`. Backward-compatible (nada cambia si las props no se pasan).

### Part 2: ConsoleGridLayout instant backdrop + ambient feed
- `ConsoleGridLayout.tsx` — imports `localPathToUrl`, `isLocalPath`, `setAmbientSource`, `clearAmbientSource`.
- Estado `hoverGame`; `backdropGame = hoverGame ?? previewGame` (hover gana, fallback al preview).
- `backdropSrc = getConsoleHeroBackground(backdropGame)` (síncrono desde consoleMedia).
- `useEffect` ambient: feed scope `"console-grid-focus"` con skip de prefijos relativos `games/`/`media/`/`img/`, `isLocalPath ? localPathToUrl : raw`; cleanup `clearAmbientSource` al desmontar. Cambio instantáneo: el backdrop del panel derecho NO está debounced.
- Panel derecho (L328) restructurado a `relative overflow-hidden` + capa backdrop `<img>` (`scale-110 object-cover blur-2xl opacity-40`) + overlay `bg-(--color-bg)/70` + wrapper interno `relative h-full overflow-y-auto`.
- Cards reciben `onHover={setHoverGame}` / `onHoverEnd={() => setHoverGame(null)}`.

### Part 3: Library footer always fixed
- `Library.tsx` — condición del footer eliminada; el div `sticky bottom-0 z-10 shrink-0 border-t ... backdrop-blur-lg` se renderiza **siempre** (también con `pageSize === SHOW_ALL` y con 0 resultados). Root `flex h-full flex-col lf-page-in` (L574) garantiza posición inferior. Cierre `</>` ajustado.

### Part 4: GameLauncherTile hover → ambient global (debounced)
- `GameLauncherTile.tsx` — imports `localPathToUrl` (gameCacheService) + `setAmbientSource`/`clearAmbientSource` (ambientBackgroundStore).
- Constantes módulo: `AMBIENT_LIBRARY_HOVER_SCOPE = "library-grid-hover"`, `AMBIENT_HOVER_DEBOUNCE_MS = 150`, timer único `_libraryHoverTimer`.
- `handleHoverEnter` (envuelve `onMouseEnter` de useHoverPrefetch): debounce 150ms → raw `game.backgroundPath ?? game.landscapePath ?? displayImage ?? game.imageUrl`, skip prefijos relativos, `isLocalPath ? localPathToUrl : raw` → `setAmbientSource("library-grid-hover", url)`.
- `handleHoverLeave`: cancela timer + `clearAmbientSource("library-grid-hover")`.
- `useEffect` unmount: cancela timer + limpia el scope.
- Root div (L473): `onMouseEnter={handleHoverEnter}` / `onMouseLeave={handleHoverLeave}`.
- Ambos scopes (`"console-grid-focus"` y `"library-grid-hover"`) son del slot `_detail` del ambient store → último gana; al salir de hover se restaura el fallback de página (`_context`).

### Key Files Changed
- `src/features/console/ConsoleGameCard.tsx` — onHover/onHoverEnd props
- `src/features/console/ConsoleGridLayout.tsx` — hoverGame, backdrop instantáneo, feed `"console-grid-focus"`, panel derecho con capa backdrop
- `src/pages/Library.tsx` — footer sticky incondicional
- `src/components/games/GameLauncherTile.tsx` — hover → ambient con debounce 150ms + cleanup

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` ✅ (1.83s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos)
- `cargo check` ⏭️ skipped (no Rust changes)
