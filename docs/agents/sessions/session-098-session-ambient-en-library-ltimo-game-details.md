## Session — Ambient en Library: último game-details-library (opción B)

### Goal
Que el fondo ambiental de la página Library (grid) muestre el arte del último juego abierto en GameDetails en vez de quedarse en el fallback estático (primer juego del snapshot con media).

### Contexto
- El grid de Library no alimentaba el slot `_detail` del ambient store → al navegar a Library el fondo caía a `_context` (fallback de `AmbientNavFallback`: `selectedGame?.imageUrl` global o primer juego del snapshot). Estático, no reaccionaba a Library.
- `LibraryGameDetails` alimentaba `setAmbientSource("library-details", ...)` pero en unmount hacía `clearAmbientSource("library-details")` → al volver al grid el fondo volvía al fallback estático.
- El feed hover→ambient de desktop se eliminó intencionalmente por ruidoso (solo Console lo conserva) — esta sesión NO reintroduce hover.

### Part 1: Memoria del último game-details-library (`ambientBackgroundStore.ts`)
- Añadido `_lastLibraryDetailsUrl: string | null` a nivel de módulo (sesión, como el resto del store). NO se limpia en unmount del detalle.
- Exportados:
  - `rememberLibraryDetails(url: string | null)` — guarda vía `normalizeUrl` (solo valores no vacíos).
  - `getLastLibraryDetailsUrl(): string | null` — lectura para `Library.tsx`.
- No toca el modelo de dos slots (`_detail`/`_context`); es memoria auxiliar.

### Part 2: `LibraryGameDetails.tsx` — recordar al alimentar
- `rememberLibraryDetails` importada; llamada junto a ambos `setAmbientSource("library-details", ...)`:
  - Con `imageUrl` resuelto (alta calidad).
  - Con el path sincrónico de primer paint (cubre manuales sin resolución async).
- La memoria se actualiza en cada resolución (incluye cambio de juego). Los cleanups (L450-456) NO la limpian — intencional.

### Part 3: `Library.tsx` — feed `library-page`
- Nuevo efecto mount (junto a `consumePendingLibraryFocus`):
  ```ts
  useEffect(() => {
    const url = getLastLibraryDetailsUrl();
    if (url) setAmbientSource("library-page", url);
    return () => clearAmbientSource("library-page");
  }, []);
  ```
- Al volver del detalle, el cleanup de `library-details` corre antes de que monte el efecto de `Library.tsx` → último estado visible es `library-page` → el grid conserva el arte.

### Comportamiento
- **Ida y vuelta**: abrir un juego → volver al grid → el fondo sigue mostrando ese juego.
- **Primera visita (sin detalle previo en la sesión)**: memoria vacía → no alimenta → fallback actual (primer juego del snapshot). Sin regresión.
- **Library → Dashboard → Library**: la memoria persiste; al remontar Library re-alimenta `library-page`.
- **Sin hover noise**: valor estable por página, no reintroduce el feed por hover de desktop.

### Key Files Changed
- `src/services/ambientBackgroundStore.ts` — `_lastLibraryDetailsUrl`, `rememberLibraryDetails()`, `getLastLibraryDetailsUrl()`
- `src/components/library/LibraryGameDetails.tsx` — import + `rememberLibraryDetails` en ambos feeds del efecto ambient
- `src/pages/Library.tsx` — import + efecto mount `library-page`

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` ✅ (1.86s, Rolldown; solo warnings INEFFECTIVE_DYNAMIC_IMPORT + chunk)
- `cargo check` ⏭️ skipped (no Rust changes)
