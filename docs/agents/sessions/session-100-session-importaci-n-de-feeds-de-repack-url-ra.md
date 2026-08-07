## Session — Importación de feeds de repack (URL/raw pegado) con parser Rust tolerante

### Objetivo
Permitir importar feeds de repack (URL o raw pegado) leyendo los JSON scrapeados (`fitgirl.json`/`steamrip.json`) preservando sus links de descarga en `download_uris_json` para que el instalador Debrid los use. Plan de 4 partes aprobado.

### Datos verificados
- `steamrip.json`: raíz `{name:"SteamRip", downloads[]}` (~1,239 items), items `{title, uploadDate, fileSize:"33 GB" string, uris[]}` HTTP tipo `https://gofile.io/d/...`.
- `fitgirl.json`: raíz `{name:"FitGirl", downloads[]}` (8,548 items), uris `magnet:?xt=urn:btih:...` → `installer_type = "torrent"`.
- Ambos sin `appId` ni `repacker` → `repacker` inferido del `name` de la raíz (lowercase); `app_id = 0` (resolución por título queda FUERA de fase 1, es fase 2 con `matchIndexer.ts`).
- 3 formatos detectados por clave raíz: `games` (Hydra), `records` (artefacto oficial), `downloads` (scrapeado).

### Part 1 — Parser Rust tolerante (`hydra_source.rs`)
- `RepackRowData` struct: title, app_id, repacker, repack_group, installer_type, file_size/install_size `Option<i64>`, languages, selective_features, uris, checksum, updated_at, tags.
- Helpers: `parse_human_size(s)` (TB/GB/MB/KB/B → bytes), `infer_installer_type(uris)` (magnet→"torrent", else "zip"), `parse_repack_feed_value(value, fallback_name)` con despacho a `parse_hydra_feed` / `parse_artifact_feed` / `parse_scraped_feed`.
- `parse_artifact_feed` usa `RepackCatalogArtifact`; `parse_scraped_feed` infiere repacker del `name` raíz, `parse_human_size` en `fileSize`, `uploadDate`→`updated_at`.
- `insert_repack_rows(db, rows, source_url, source_name) -> (u32, u32)` — UPSERT de 18 columnas, devuelve `(imported, updated)`; `id` canónico `"{normalized_title}-{repacker}"`.
- `fetch_and_import_hydra_source`, `validate_hydra_source_url` e `import_hydra_source_entries` (path refresh) refactorizados para usar el parser compartido.
- **Nuevo comando `import_repack_feed(app_handle, contents, source_name?, source_url?)`** — parsea raw pegado y lo inserta (fallback name `"pasted-feed"`, sin cache de raw).

### Part 2 — Registro en `lib.rs` (L288, entre `clear_hydra_cache` y `webview_fetch_callback`).

### Part 3 — TS (`hydraSourceService.ts`)
- `tauriImportRepackFeed(contents, sourceName?, sourceUrl?)` — invoke directo a `"import_repack_feed"` con args camelCase `{contents, sourceName, sourceUrl}` (patrón del archivo, sin binding en `tauri.ts`).
- Público `importRepackFeed(contents, options?) → HydraImportResult`.

### Part 4 — UI (`DebridProvidersCard.tsx`)
- Bloque "Importar feed repack": textarea (font-mono, placeholder con ejemplo de steamrip), botón "Importar" (estado `importingFeed`, icono `Download`/`Loader2`), texto explicativo de que los links se conservan.
- Post-import: `showSuccess("Feed importado: N nuevos, M actualizados")` + `await refreshDebridGames()` para refrescar la librería.

### Key Files Changed
- `src-tauri/src/commands/hydra_source.rs` — parser tolerante, `insert_repack_rows`, comando `import_repack_feed`, refactor de los 3 paths de import
- `src-tauri/src/lib.rs` — comando registrado
- `src/services/hydraSourceService.ts` — `importRepackFeed` + `tauriImportRepackFeed`
- `src/components/settings/DebridProvidersCard.tsx` — UI de importación de feed + `refreshDebridGames` post-import

### Build
- `cargo check` ✅ (0 errores; 2 warnings preexistentes dead-code)
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` ✅ (1.73s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos)
