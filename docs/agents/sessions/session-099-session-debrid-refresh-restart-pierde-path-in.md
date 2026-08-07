## Session — Debrid: refresh/restart pierde path instalado + Download Metadata no hace nada

### Problema
1. Con el path del ejecutable ya guardado en `debrid-games.json`, al refrescar/reiniciar el juego aparecía como "instalar" (sin `isInstalled`, sin `executablePath`) y el diálogo de edición no traía el path — no se leía lo guardado.
2. "Download Metadata"→Steam no hacía nada en juegos Debrid.

### Causa raíz Bug 1 (Download Metadata)
- El guard de `handleDownloadMetadata` (`GameEditDialog.tsx`) hacía early-return silencioso en Debrid porque `appId` llega vacío (los call sites solo pasan `appId` para `steam`/`lua`); `isManualMode`/`isCreateMode`/`isEpicMode` eran false → guard `if (!appId && !isManualMode && !isCreateMode && !isEpicMode) return;` bloqueaba.

### Causa raíz Bug 2 (path perdido)
- La restauración vive en `refreshDebridGames()` (`debridGameStore.ts`), que lee `getDebridLaunchMetadata()` → el mapa `_launchMetadataByProviderGameId`, que SOLO se puebla en `loadDebridGamesFromDisk()` y en `updateDebridGame`.
- Carrera: `refreshDebridGames()` (context, `LibraryGamesContext.tsx`) vs Stage 3.35 del boot (`appBootCoordinator.ts`). Si refresh corre primero → mapa vacío → loop de restauración no hace nada → entradas `isInstalled=false` sin path; el loader corre después pero NUNCA re-mapea `_debridGames` → roto toda la sesión.
- El guardado era correcto (`updateDebridGame` setea mapa + `_userLibraryAppIds` + statuses); el JSON en disco tenía el path. El diálogo pre-rellenaba SOLO desde el prop `game` (entrada rota) sin consultar el store.

### Fixes

#### `debridGameStore.ts`
- `refreshDebridGames()`: `await loadDebridGamesFromDisk()` como primera línea del `try` (idempotente vía `_loadedFromDisk` → ambos órdenes de boot convergen).
- `loadDebridGamesFromDisk()`: `_loadedFromDisk = true` movido a DESPUÉS de un `readDebridGames()` exitoso (fail-open ante fallo transitorio — antes estaba antes del try, congelando el estado vacío toda la sesión).
- `loadDebridGamesFromDisk()`: restaura `_debridAppIdOverrides` desde disco (`if (entry.appId) _debridAppIdOverrides.set(entry.id, String(entry.appId))`) — el `appId` en disco es autoritativo.
- Nueva `updateDebridGameTitle(providerGameId, title)`: persiste el título (decisión: solo nombre + diálogo, sin tocar schema Rust); no-op si vacío/inexistente.

#### `GameEditDialog.tsx`
- Guard `:487` → añadido `&& !isDebridMode`.
- Rama explícita `if (isDebridMode)` en `handleDownloadMetadata` antes del flujo Steam: resuelve por `appIdDraft || game?.appId`; `steam` → `resolveGameMetadata` → `fillDraftsFromMetadata` + `setMetadata` + toast; `igdb`/`rawg` por appId; appId vacío → `showError("No Steam App ID — introduce uno en el campo App ID")`; `appIdDraft` en deps del useCallback.
- Mount Debrid (rama ~`:407`): fallback a `getDebridLaunchMetadata()` + `getDebridGame()` cuando `game` no traiga path/appId/título → el diálogo siempre muestra lo guardado en disco; añadido `setNameDraft(game?.title ?? savedGame?.title ?? "")` (antes el nombre quedaba vacío en Debrid).
- Rama Debrid de `handleSave`: añadido `updateDebridGameTitle(debridProviderGameId, nameDraft)` junto a path/appId.

### Key Files Changed
- `src/services/debridGameStore.ts` — await del loader en refresh, fail-open `_loadedFromDisk`, restore de overrides, `updateDebridGameTitle()`
- `src/components/games/GameEditDialog.tsx` — guard `!isDebridMode`, rama Debrid de metadata, fallback del mount al store, persistencia de título en save

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` ✅ (1.82s, Rolldown; solo warnings INEFFECTIVE_DYNAMIC_IMPORT)
- `cargo check` ⏭️ skipped (no Rust changes — decisión del usuario: no extender schema Rust)
