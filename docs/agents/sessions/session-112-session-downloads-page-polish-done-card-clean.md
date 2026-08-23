## Session — Downloads page polish: done-card cleanup + active mock buttons (post-premium-redesign)

### Goal
Close the remaining gaps after the ActiveDownloadCard premium redesign: remove the misleading 100% blue bar in completed cards, only show the progress bar for active statuses, make rows compact (single badge, provider+type as metadata, larger hit targets), and make the dev mock preview's Pause/Cancel actually do something.

### Part 1: `DownloadJobCard.tsx` — completed-card cleanup
- **Removed the 100% blue bar** in both done branches (Debrid and Steam): previously rendered a full-width accent bar + "100%" label. Replaced with a compact completion row: `CheckCircle2` emerald icon + "Completada" label + installed size (`· {formatBytes(job.installedSize)}`) when available.
- **Single badge in done branches**: removed the hardcoded "Debrid"/"Steam" pill and (for Debrid) the separate repacker pill from the title row — kept only `DownloadStatusBadge`. Provider+repacker+message folded into the metadata line: `["Debrid", job.repacker?.toUpperCase(), job.message || "Instalado · Listo para jugar"].filter(Boolean).join(" · ")` for Debrid; `Steam · Instalado · Listo para jugar` for Steam.
- **Removed the separate "Tamaño instalado" `<p>`** in both done branches — the installed-size metadata now lives only in the completion row.
- **Generic branch progress bar gated**: `DownloadProgressBar` now only renders when `canCancel(job.status)` (queued/waiting/checking/downloading/extracting/installing/paused). done/failed/cancelled are terminal — no progress bar. Comment updated.
- **Generic branch single badge**: removed the extra `debrid-install` repacker pill; repacker+provider+type folded into the metadata fallback line: `{job.repacker.toUpperCase()} · {job.providerName || "Debrid"} · .{job.fileType}` when no message, debrid, and repacker present.
- **All three subtitle lines** (`job.message`, steam-install, debrid, generic) now use `truncate` to prevent long repacker/message strings from breaking the compact layout.
- **Hit target bump**: trash (Quitar) buttons in both done branches bumped from `p-2` → `p-2.5` (40px hit target).
- Added `CheckCircle2` to the lucide imports.

### Part 2: ActiveDownloadCard cancel menu gating
- The `•••` menu's "Cancelar descarga" `MenuItem` is now rendered only when `canCancel` (active + cancellable status), matching the Pause/Resume buttons. Previously it always showed (the mock preview is in `downloading` state, so the item stays visible there).
- `canCancel` local (CANCELLABLE.has) is now actually read — fixes the TS6133 unused-var.

### Part 3: `useDynamicPalette.ts` fix
- Fixed TS2300 duplicate identifier in `srgbToOklch`: the OKLCH `b` axis local conflicted with the function's `b` parameter. Renamed the local to `bAxis` (3 references: the axis computation, `C = sqrt(a²+bAxis²)`, and `H = atan2(bAxis, a)`).

### Key Files Changed
- `src/components/downloads/DownloadJobCard.tsx` — done-branch cleanup (no 100% bar, single badge, compact metadata, `truncate`), generic progress bar gated by `canCancel`, trash hit targets 40px, `CheckCircle2` import
- `src/components/downloads/ActiveDownloadCard.tsx` — cancel menu item gated by `canCancel`
- `src/hooks/useDynamicPalette.ts` — `b` → `bAxis` rename in `srgbToOklch`

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en tocados)
- `vite build` ✅ (2.24s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos)
- `vitest run` ✅ 802 passed / 4 failed (solo los 4 preexistentes: sourceManagerDeclarativeWiring ×3 + tools.test extractToolConfig)
- `cargo check` ⏭️ skipped (no Rust changes)
