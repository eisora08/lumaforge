## Session � Ambient reactividad real + crossfade premium + feeds de Store

### Goal
Arreglar el fondo ambiental para que reaccione en tiempo real (antes solo cambiaba al navegar de página o al minimizar/maximizar), y hacer que la página Store alimente el fondo desde el carrusel hero de Discover y la galería de medios de detalles, con crossfade suave premium al cambiar de imagen.

### Part 1: Root cause del no-re-render (fix cr�tico)
- `src/services/ambientBackgroundStore.ts` � `emit()` mutaba el MISMO objeto `_snapshot` en cada llamada; `useSyncExternalStore` compara con `Object.is` y, al ser la misma referencia, jam�s re-renderizaba el componente. El refresh al minimizar/maximizar era un efecto secundario de un re-render por resize que rele�a el objeto mutado.
- Fix: `_snapshot` pasa de `const` a `let`; `emit()` asigna un objeto NUEVO `{ url, enabled, intensity }` cada vez (con comentario explicando el bug de `Object.is`).

### Part 2: Feeds de Store (nuevos scopes del slot `_detail`)
- `StoreDiscoverHeroCarousel.tsx` � deriva `ambientImage = getGameImage(activeGame, storeMetadataByAppId)` y llama `setAmbientSource("store-hero", ambientImage ?? null)` en efecto por cambio de imagen; cleanup al unmount.
- `StoreGameMediaGallery.tsx` � nueva prop opcional `onMediaSelect?: (imageUrl: string | null) => void`; reporta la imagen actualmente mostrada via ref (`onMediaSelectRef`) en efecto por `currentMediaImage` (screenshot ? `image`; trailer ? `thumbnail ?? poster`; null cuando no hay item).
- `StoreGameDetailsPage.tsx` � wired: `handleAmbientMedia = useCallback((u) => setAmbientSource("store-details", u), [])` + cleanup al unmount; pasa `onMediaSelect` a la galer�a. Cubre AMBAS rutas que renderizan esta p�gina: `Store.tsx` (L3351) y `GameDetails.tsx` (L440, b�squeda global).

### Part 3: Crossfade premium en AmbientBackground
- `src/components/layout/AmbientBackground.tsx` � reemplaza el remount `key={url}` por dos capas apiladas: estado `prevUrl`; cuando `url` cambia, la capa anterior queda montada con `animate-ambient-out` (fade-out) mientras la nueva entra con `animate-ambient-in` (fade-in); ambas `absolute inset-0 scale-110 object-cover` bajo los overlays compartidos (dim + gradiente). `prevUrl` se limpia tras ~650ms (`CROSSFADE_MS`). Null-safe cuando `!enabled || !url`.
- `src/App.css` � `@keyframes ambientOut` (to opacity 0) + `.animate-ambient-out` (600ms ease-in forwards); `ambientIn` pasa a 600ms ease-out; ambos dentro del guard `prefers-reduced-motion`.

### Build
- `tsc --noEmit` ? (solo los 23 errores preexistentes de extensions/tests; los errores temporales de `StoreMediaItem.image` en la galer?a se resolvieron con narrowing por tipo `trailer` vs `screenshot`)
- `vite build` ? (2.19s, Rolldown; solo warnings preexistentes + INEFFECTIVE_DYNAMIC_IMPORT informativos)
- `cargo check` ?? skipped (no Rust changes)
