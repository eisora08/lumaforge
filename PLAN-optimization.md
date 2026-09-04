# Plan: Optimización de Cache, Snapshot y localStorage

## Resumen

Arreglar bugs de títulos "Unknown" en debrid, dashboard inconsistente, triple start del watcher, y limpiar el ecosistema de 69 localStorage keys / 7 capas de cache. Todo paso a paso sin romper funcionalidad existente.

---

## Fase 0: Bugs críticos (ya arreglados, commit pendiente)

### 0.1 Race condition en getOrCreateConfig
- **Archivo**: `src/services/achievementConfigService.ts`
- **Estado**: ✅ Implementado — Map de promesas serializa llamadas concurrentes por appId
- **Commit**: `3f569b9`

### 0.2 Nombre placeholder "Game 3358170"
- **Archivo**: `src/services/achievementConfigService.ts`
- **Estado**: ✅ Implementado — lookup de games_v2 siempre busca `effectiveName`
- **Commit**: `3f569b9`

### 0.3 Botón Save deshabilitado para debrid
- **Archivo**: `src/components/games/GameEditDialog.tsx:1252`
- **Estado**: ✅ Implementado — `nameDraft` agregado a la comparación de hasEdits para debrid
- **Commit**: `135d09b`

---

## Fase 1: Arreglar título "Unknown" en debrid (inmediato)

### 1.1 Poblar `_diskTitleByProviderGameId` correctamente
- **Archivo**: `src/services/debridGameStore.ts`
- **Problema**: `_diskEntryById` nunca se popula (dead code), y `toDiskEntries()` usa el fallback incorrecto
- **Fix**: ✅ Eliminar `_diskEntryById`, reemplazar por `_diskTitleByProviderGameId` en `toDiskEntries()`
- **Commit**: `135d09b`

### 1.2 Asegurar que `persistToDisk()` escribe el título correcto
- **Estado**: ✅ Resuelto por fix 1.1 — `toDiskEntries()` ya usa `_diskTitleByProviderGameId` como fallback

### 1.3 Eliminar placeholder "Unknown" de `debridGameToGameV2`
- **Archivo**: `src/services/gameV2Mapper.ts:488` + `debridGameLibraryMapper.ts:39`
- **Fix**: ✅ Cambiar `"Unknown Repack"` / `"Unknown"` por `""` — nunca escribir "Unknown" a games_v2
- **Commit**: `135d09b`

### 1.4 Verificar
- Borrar config de Big Ambitions
- Reiniciar app
- Verificar que el título se muestra correctamente en el sidebar Y el dashboard

---

## Fase 2: Dashboard lee React state, no snapshot (inmediato)

### 2.1 Cambiar LibrarySection para leer de React context
- **Archivo**: `src/components/dashboard/LibrarySection.tsx`
- **Fix**: ✅ `displayGames` ahora se deriva de `libraryGames` (useLibraryGames), no del snapshot
- **Commit**: `135d09b`

### 2.2 Eliminar `resolveDashboardTitles` redundante
- **Estado**: ⏭️ Skip — sigue siendo útil para resolver nombres reales de Steam vs placeholders

### 2.3 Verificar
- [ ] Editar título de un juego → debe actualizarse en dashboard instantáneamente
- [ ] No debe quedar "Unknown" después de editar

---

## Fase 3: Eliminar caches redundantes (corto plazo)

### 3.1 Eliminar `_sqliteNameCache`
- **Estado**: ⏭️ Skip — bulk load de names es útil para `resolveCanonicalName`

### 3.2 Eliminar `_diskEntryById`
- **Estado**: ✅ Ya eliminado en Fase 1.1

### 3.3 Agregar TTL a `canonicalMediaCache`
- **Estado**: ⏭️ Skip — ya tiene invalidación correcta (delete on update, clear on reset)

### 3.4 Agregar TTL a `gameMetadataResolver.inMemoryCache`
- **Estado**: ⏳ Pendiente — risk bajo, TTL de 30 min

### 3.5 Verificar
- [ ] Todas las imágenes de juegos siguen cargando

---

## Fase 4: Limpiar localStorage legacy (mediano plazo)

### 4.1 Eliminar keys legacy del cleanup de boot
- **Archivo**: `src/context/LibraryGamesContext.tsx:125-131`
- **Estado**: ✅ Agregados `lumaforge-snapshot-games` y `lumaforge-session-history-v1` al cleanup
- **Commit**: `135d09b`

### 4.2 Fix achievementWatcherService — reemplazar lectura muerta de localStorage
- **Archivo**: `src/services/achievementWatcherService.ts:900-911`
- **Estado**: ✅ `_populateGameTitleCache` ahora lee de `getReconciledGames()` en vez de `lumaforge-snapshot-games`
- **Commit**: `135d09b`

### 4.3 Migrar keys legacy restantes a SQLite
- **Estado**: ⏳ Pendiente — requiere migración de:
  - `lumaforge-installed-games-v1` → games_v2 (ya tiene migración en boot)
  - `lumaforge-manual-games-v1` → games_v2 (ya tiene migración en boot)
  - `lumaforge-playtime-v1` → games_v2
  - `lumaforge-launcher-achievements-v1` → achievements.db
  - `lumaforge-launcher-xp-v1` → achievements.db
  - `lumaforge-steam-user-stats-cache-v1` → cache temporal
  - `lumaforge-epic-overrides-v1` → SQLite
  - `lumaforge-favorites-v1` → games_v2.is_favorite

### 4.5 Verificar
- Favoritos persisten correctamente
- Overrides de Epic funcionan
- No hay errores en consola por keys faltantes

---

## Fase 5: Simplificar flujo de boot (largo plazo)

### 5.1 Unificar snapshot + reconciled
- **Archivos**: `startupSnapshotService.ts`, `gameStore.ts`
- **Problema**: `cachedSnapshot` y `_reconciledGames` son dos copias del mismo dato
- **Fix**:
  1. Hacer que el snapshot SEÁ el reconciled (no dos cosas separadas)
  2. `_reconciledGames` se popula desde games_v2 directamente
  3. El snapshot se construye desde `_reconciledGames` (no al revés)
  4. Eliminar la merge de 5 fuentes en `LibraryGamesContext`

### 5.2 Simplificar LibraryGamesContext
- **Archivo**: `src/context/LibraryGamesContext.tsx:809-939`
- **Problema**: Mergea snapshot + games_v2 + reconciled + manual + epic + debrid
- **Fix**:
  1. Usar games_v2 como source of truth único
  2. Manual/epic/debrid se sync a games_v2 (ya lo hacen)
  3. Eliminar el merge complejo — solo leer de games_v2
  4. Mantener fallback a snapshot solo si games_v2 está vacío

### 5.3 Verificar
- Boot sigue siendo rápido
- Todos los juegos aparecen correctamente
- No hay flickering en el sidebar

---

## Orden de ejecución

```
Fase 0 (ya hecho)     → commits 3f569b9, 135d09b
Fase 1 + 2 + 4 (parcial) → commit 135d09b
Fase 3 (skip — correcto)
Fase 4.3 (migración)  → pendiente
Fase 5 (simplificar)  → pendiente
```

## Criterios de éxito

- [x] Botón Save funciona para debrid
- [x] No más "Unknown" para juegos debrid (escritura a games_v2)
- [x] Dashboard lee React state, no snapshot stale
- [x] achievementWatcherService usa getReconciledGames en vez de localStorage muerto
- [x] Legacy keys se limpian al boot
- [ ] Debrid games muestran título correcto en sidebar Y dashboard (verificar)
- [ ] Editing título se refleja instantáneamente en dashboard (verificar)
- [ ] Startup snapshot no tiene títulos stale (verificar)
- [ ] localStorage tiene <40 keys (pendiente migración completa)
- [ ] No hay regresiones en funcionalidad existente (verificar)
