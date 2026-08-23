## Session — Gofile resolver: `.my` v1 → `.io` API + guest token + website-token (fix descarga 302→HTML)

### Objetivo
Reemplazar la resolución gofile rota (`.my/v1/content` muerta) por el flujo oficial `.io` verificado end-to-end: cuenta guest → `X-Website-Token` → `contents/{id}` → link CDN que requiere Bearer.

### Verificación en vivo (previo a la implementación)
- `api.gofile.my` NO sirve la API (404 HTML). La base correcta es `https://api.gofile.io`.
- `POST https://api.gofile.io/accounts` `{"email":null,"pass":null}` → `data.token` (guest, sin email).
- `wt = sha256("{ua}::en-US::{token}::{floor(unix/14400)}::{salt}")`; salt vigente `9844d94d963d30` (byte-exacto vs `wt.obf.js`); `5d4f7g8sd45fsd` (gallery-dl) NO coincide.
- El token `"0"` no sirve → 401 `error-token`; hace falta cuenta guest real.
- `GET /contents/{id}` con `User-Agent` + `Authorization: Bearer` + `X-Website-Token` + `X-BL: en-US` → 200; `data.children` es MAPA de objetos (legacy `data.childs` era array).
- El link CDN requiere `Authorization: Bearer` en la descarga: sin token → 302 → HTML (login page); con token → 206 `application/vnd.rar`.

### Part 1 — Constantes + imports
- `use sha2::{Digest, Sha256}` y `std::time::{Instant, SystemTime, UNIX_EPOCH}` (sha2 0.10 ya en Cargo.toml).
- `GOFILE_UA` (Chrome 124, extraída del string inline), `GOFILE_SALTS = ["9844d94d963d30", "5d4f7g8sd45fsd"]` (vigente + fallback rotación), `GOFILE_WINDOW_SECS = 14_400`.

### Part 2 — Helpers nuevos
- `gofile_website_token(token, salt, ua)` — sha256 hex del formato verificado.
- `gofile_create_guest_token(client)` — POST `/accounts` json `{"email":null,"pass":null}`, parsea `data.token`, log tier.
- `gofile_bearer_token(client)` — env `GOFILE_TOKEN` override primero; si no, cache de guest token en `OnceLock<Mutex<Option<(String, Instant)>>>` con TTL 4h; refresca al caducar.
- `gofile_get_contents(client, token, salt, content_id)` — GET `.io/contents/{id}` con los 4 headers, errores hint 401/403/404/429.
- `GofileResolved { url, bearer: Option<String> }`.

### Part 3 — `resolve_gofile_url` → `Result<GofileResolved, String>`
- Page URL `/d/{id}`: itera `GOFILE_SALTS`; en el 401 del primer salt refresca el guest token una vez y reintenta; parsea `data.children` (mapa) con fallback a `data.childs` (array) → primer child `.link`.
- Direct URL: devuelve la URL igual PERO con bearer (el CDN lo exige).
- `[DEBRID][GOFILE]` logs de resolución.

### Part 4 — `download_file_to_dest` + bearer
- Nuevo parámetro `bearer: Option<&str>`; añade `Authorization: Bearer <token>` al GET solo cuando Some y no vacío.
- Call site en `download_debrid_package`: `let (effective_uri, gofile_bearer)` desde `resolve_gofile_url`; pasa `gofile_bearer.as_deref()`.
- El guard de Content-Type `text/html` se mantiene (con auth correcta el CDN responde `application/vnd.rar`).

### Alcance
- Solo primer archivo (multi-parte fuera de scope, decisión del usuario).
- Solo Rust; sin cambios TS/UI.

### Part 5 — Tests de regresión del WT
- `gofile_website_token` refactorizada: núcleo puro `gofile_website_token_for_window(token, salt, ua, window)` (window inyectada, testable) + wrapper que computa `now / GOFILE_WINDOW_SECS`.
- Vector conocido independiente: hash sha256 calculado con PowerShell (implementación independiente) para `window=12345, token="testtoken", salt="9844d94d963d30"` → `26c3eb17...a757aaa`.
- 6 tests en `#[cfg(test)] mod tests`: vector conocido, formato (64 hex lowercase), determinismo, sensibilidad a salt, sensibilidad a window, comportamiento de rotación de salts.

### Key Files Changed
- `src-tauri/src/commands/debrid_installer.rs` — toda la resolución gofile reescrita + threading del bearer a `download_file_to_dest` + núcleo puro del WT + 6 tests de regresión

### Build
- `cargo check` ✅ (0 errores; 2 warnings preexistentes dead-code)
- `cargo test` ✅ (141 passed / 0 failed — 135 preexistentes + 6 nuevos)
- `tsc --noEmit` ⏭️ (sin cambios TS)
- `vite build` ⏭️ (sin cambios TS)
