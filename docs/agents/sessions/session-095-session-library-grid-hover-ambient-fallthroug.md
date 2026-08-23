## Session � Library grid hover -> ambient fallthrough fix

### Problem
Library grid cards did not feed the global ambient background on hover (desktop). The console-mode ambient background was already visible; only the Library hover feed was dead.

### Root cause
`GameLauncherTile.tsx` hover handler picked `raw = game.backgroundPath ?? game.landscapePath ?? displayImage ?? game.imageUrl` and early-returned on any relative prefix (`games/`/`media/`/`img/`). For Steam games, `game.backgroundPath`/`game.landscapePath` are the RELATIVE snapshot media paths (e.g. `media/landscape.jpg`) -> truthy -> early return fired before ever reaching the absolute canonical `displayImage` (which `getCardImage` returns from `canonicalInfo.media.*` as absolute resolved paths). Result: no candidate ever fed `setAmbientSource`.

### Fix
- `handleHoverEnter` now iterates a candidate list (`game.backgroundPath`, `game.landscapePath`, `game.coverPath`, `displayImage`, `game.imageUrl`) and FALLS THROUGH relative prefixes instead of returning on the first relative path.
- First usable candidate wins; local absolute paths converted via `localPathToUrl`, remote/provider URLs used raw.
- Added `DEBUG_AMBIENT_HOVER = false` flag + `[AMBIENT][HOVER] appid=... raw=... url=...` diagnostic.

### Key Files Changed
- `src/components/games/GameLauncherTile.tsx` � candidate-fallthrough loop in `handleHoverEnter`, `game.coverPath` added to candidates, debug flag.

### Build
- `tsc --noEmit` ? (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` ? (1.38s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos)
- `cargo check` ?? skipped (no Rust changes)
