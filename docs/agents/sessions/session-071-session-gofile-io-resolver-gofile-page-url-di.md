## Session — Gofile.io resolver: gofile page URL → direct download link via public API

### Problem
`install_debrid_package` descargaba desde URLs de gofile.io (`https://gofile.io/d/ABC123`), pero `reqwest` obtenía el HTML de la página, no el binario. Gofile.io requiere resolver vía su API pública para obtener el link directo.

### Fix
- **`debrid_installer.rs`**: Nueva función `resolve_gofile_url(gofile_url)` que:
  1. Extrae el `contentId` del URL (`/d/ABC123` → `ABC123`)
  2. Hace GET a `https://api.gofile.io/contents/{contentId}` (público, sin auth)
  3. Parsea el JSON y extrae el `link` del primer child en `data.children`
  4. Sin API keys, sin cookies, sin configuración extra
- **`install_debrid_package`**: Antes de Step 1 (download), detecta si el URI es gofile.io, lo resuelve a link directo, y pasa el link resuelto a `download_file_to_dest()`
- `reqwest` ya tenía feature `json` habilitado, `serde_json` ya era dependencia — cero cambios en Cargo.toml

### Repack JSON
- ContentIds verificados contra `steamrip.json`: GTA V=`O9qOj0`, RE2=`5QtuGG`, Palworld=`ukwugv` — todos correctos

### Flujo final
```
install_debrid_package("https://gofile.io/d/O9qOj0", ...)
  → detecta gofile.io
  → GET https://api.gofile.io/contents/O9qOj0
  → extrae link directo: "https://gofile.io/dl/abc123"
  → download_file_to_dest("https://gofile.io/dl/abc123", ...)
  → extract zip / run installer
  → find_largest_exe
```

### Build
- `cargo check` ✅ (0 new errors)
- `tsc --noEmit` ✅ (pre-existing only)
- `vite build` ✅ (pre-existing chunk warnings only)
