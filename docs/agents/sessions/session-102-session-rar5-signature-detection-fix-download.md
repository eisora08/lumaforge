## Session — RAR5 signature detection fix (download RAR5 ya funcionaba; solo el detector fallaba)

### Problema
Descarga gofile correcta (bearer ya funcional) de un repack con archivo **RAR5** (`The-Operator-SteamRIP.com.rar`). Error al final del download: `Unknown file type (magic bytes: 52 61 72 21 1A 07 01 00). Expected RAR, ZIP, or Windows executable.`

### Causa raíz
`detect_file_type` (`debrid_installer.rs:56`) solo comparaba la firma **RAR4** (`Rar!\x1A\x07\x00` — byte[6]=0x00). El archivo descargado era **RAR5** (`Rar!\x1A\x07\x01\x00` — byte[6]=0x01) → caía al brazo `Unknown` → error. El download en sí fue un éxito (los magic bytes del archivo en disco son RAR válido); el fix del bearer de la sesión previa funciona.

### Fix
- Check RAR ampliado: primeros 6 bytes `52 61 72 21 1A 07` + byte[6] ∈ `{0x00, 0x01}` (cubre RAR4 y RAR5). Doc del enum actualizado.
- Extracción ya soporta RAR5 en los 3 fallbacks (verificado, sin cambios): `extract_rar_with_cli` (unrar.exe/7z.exe/unar modernos), `extract_rar_with_unrar` (unrar crate 0.5.8 → unrar_sys 0.5.8 bundlea UnRAR 6.x), `extract_rar_via_7z` (7-Zip 15.06+).
- Retry tras el fix: `download_file_to_dest` short-circuita con archivo existente (L1222) → salta re-descarga y va directo a detección → extracción.

### Tests (3 nuevos en `mod tests`)
- `detect_rar5_signature` — fichero 16B con firma RAR5 → `DetectedFileType::Rar` (regresión del bug).
- `detect_rar4_signature` — firma RAR4 → `Rar` (evita regresión en sentido contrario).
- `detect_unknown_signature` — magic no relacionado → `Unknown(_)`.
- Ojo: fixtures deben tener ≥16 bytes (el detector hace `read_exact` de 16); con 8 bytes daba `cannot_read` y fallaba el test (no el código).

### Build
- `cargo test` ✅ (144 passed / 0 failed — 141 previos + 3 nuevos)
- `cargo check` ✅ (solo 2 warnings preexistentes dead-code)
- `tsc --noEmit` ⏭️ (sin cambios TS)
- `vite build` ⏭️ (sin cambios TS)
