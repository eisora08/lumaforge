# Plan: Actualizar Vite 7 → 8.2

Estado actual (verificado): `vite 7.3.6`, `@vitejs/plugin-react 4.7.0`, `@tailwindcss/vite 4.3.1`, `vitest 4.1.10`, Node v24.16.0.

## Pasos

1. **Editar `package.json`** (3 bumps):
   - `vite`: `^7.0.4` → `^8.2.0`
   - `@vitejs/plugin-react`: `^4.6.0` → `^6.0.5` (v6 es el de Vite 8; Oxc-based, sin Babel)
   - `@tailwindcss/vite`: `^4.3.1` → `^4.3.3` (declara peer de Vite 8)
   - `vitest`: se queda en `^4.1.10` (peer `^6‖^7‖^8` ✅)
2. **`npm install`**
3. **Verificar:**
   - `npx tsc --noEmit` → solo los 23 errores pre-existentes (tests/extensions)
   - `npx vite build` → build OK; comparar chunks vs actual (warning 1.9MB pre-existente)
   - `npx vitest run` → baseline 826 pass / 22 fail pre-existentes
   - `npm run tauri dev` → confirmar HMR + arranque (manual, requiere ventana)

## Compatibilidad confirmada (npm)
- `vite@8.2.0`: engines `^20.19.0 || >=22.12.0` (Node 24 OK); Rolldown (reemplaza esbuild+Rollup)
- `@vitejs/plugin-react@6.0.5`: peer `vite ^8.0.0` (obligatorio actualizar juntos); sin Babel, sin React Compiler en el proyecto → drop-in
- `@tailwindcss/vite@4.3.3`: peer `^5.2‖^6‖^7‖^8`
- `vitest@4.1.10`: peer `^6‖^7‖^8`

## Config: sin cambios
`vite.config.ts` solo tiene `server` + plugins (react, tailwindcss). Sin `rollupOptions`/`manualChunks`/`esbuild` que migrar a `rolldownOptions`.

## Riesgos
- Dev server Rolldown usa ~7x RAM (conocido, en reducción por el equipo Vite)
- Cambios de interop CJS en imports dinámicos (improbable: casi todo ESM/tauri packages)
- Chunk 1.9MB pre-existente puede persistir o re-empaquetarse (inofensivo)
