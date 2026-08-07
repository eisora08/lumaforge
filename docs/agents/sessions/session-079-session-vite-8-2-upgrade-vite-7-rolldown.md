## Session — Vite 8.2 upgrade (Vite 7 → Rolldown)

### Goal
Upgrade the bundler from Vite 7 (esbuild + Rollup) to Vite 8.2 (Rolldown) for faster builds and lower memory in production builds.

### Changes
- **`package.json`** bumps:
  - `vite`: `^7.0.4` → `^8.2.0` (engines `^20.19.0 || >=22.12.0` — OK with Node v24.16.0)
  - `@vitejs/plugin-react`: `^4.6.0` → `^6.0.5` (Vite 8 requires the React 6 plugin; Oxc-based, no Babel)
  - `@tailwindcss/vite`: `^4.3.1` → `^4.3.3` (declares Vite 8 peer support)
  - `vitest`: unchanged at `^4.1.10` (peer `^6‖^7‖^8`)
- **`npm install`** regenerated lockfile: 12 added / 35 removed / 12 changed. EPERM cleanup warnings on native binaries (esbuild/rollup/oxide) are cosmetic.
- **No config changes**: `vite.config.ts` (server + plugins only) needed no Rolldown migration.

### Verification
- `npx tsc --noEmit` ✅ — only the 23 pre-existing errors (tests/extensions), none in touched files
- `npx vite build` ✅ — **1.85s** (was ~6.7s); main chunk `index-*.js` 1,752 kB / gzip 439 kB (similar to pre-existing 1.9MB warning)
- New Rolldown `[INEFFECTIVE_DYNAMIC_IMPORT]` warnings are informational (dynamic imports that stay in the same chunk because they're also statically imported) — not errors
- `npx vitest run` ✅ — 802 passed / 4 failed. The 4 failures are **stale behavioral tests**, NOT Vite-related:
  - `sourceManagerDeclarativeWiring.test.ts` (×3) — tests the OLD behavior (repo-sourced extensions with `managedFiles` get a DeclarativeExtension), which was deliberately removed in the "Lua Adapter Bypass Fix" session (repo-sourced + managedFiles now SKIP DeclarativeExtension)
  - `tools.test.ts` `extractToolConfig` — expects an old 5-field `toolConfig` shape, actual now has 15 fields
- `cargo check` ⏭️ skipped (no Rust changes)

### Known trade-offs
- Rolldown dev server uses ~7x RAM (known upstream, being reduced)
- Pre-existing chunk-size warning persists

### Key Files Changed
- `package.json` — 3 dependency bumps
- `package-lock.json` — regenerated

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors)
- `vite build` ✅ (1.85s, Rolldown; informational INEFFECTIVE_DYNAMIC_IMPORT warnings only)
- `vitest run` ✅ (802 pass / 4 stale behavioral fails — pre-existing)
- `cargo check` ⏭️ skipped (no Rust changes)
