## Session — ToolsModal premium redesign: landscape hero + native-fix glass rows, footer buttons removed

### Goal
Redesign `ToolsModal.tsx` into a premium modal: remove the extension-tools section and the two footer buttons ("Cancelar" + "Aplicar Fixes", user-confirmed), add a landscape hero of the game with the hero-transition preference, glass rows for native fixes, Escape to close, and ambient background feed. Also fix the `goldberg_fork` third-party tool install asset (`.7z`, not `.zip`).

### Part 1 — Rust: `preferred_asset` on ToolDef (`thirdparty.rs`)
- `ToolDef` gained `preferred_asset: Option<&'static str>` (doc: repos that publish e.g. `emu-win-release.7z`).
- `TOOL_DEFS`: `goldberg_fork` → `Some("emu-win-release.7z")`; `smokeapi`/`steamless` → `None`.
- Asset selection (~250-260) priority: exact `preferred_asset` name match → `.zip` → `.7z`.
- `get_latest_github_release`/`get_github_release_tag` signatures gained `preferred_asset: Option<&str>`; all 3 call sites (~475 list-version, ~551 auto-detect, ~592 install) pass `def.preferred_asset`.
- `game_fix.rs`'s own local `get_latest_github_release` (no `preferred_asset`) untouched.

### Part 2 — ToolsModal rewrite (`src/components/tools/ToolsModal.tsx`)
- **Removed** all extension-tools code: `initToolManager`/`subscribeToolManager`/`getAllTools`/`detectToolsForGame`/`applyTool`, `Tool`/`ToolDetectionResult`/`ToolId` types, `TOOL_ICONS`/`getToolIcon`, detection/checkbox/placeholder UI, "Opciones avanzadas", `appliedCount`/`canApply`/`toggleSelected`/`handleApply`.
- **Removed** footer "Cancelar" + "Aplicar Fixes" buttons (user-confirmed); close is via ✕ header button + backdrop click + **Escape** key.
- **Landscape hero**: resolves `game.landscapePath ?? backgroundPath ?? coverPath` via `resolveGameMediaUrl(appId, path)`; `heroClass` from `heroTransitionStore` (`crossfade`→`animate-hero-crossfade-in`, `kenburns`→`animate-hero-kenburns-in`, `focus`→`animate-hero-focus-in`); `brightness-[0.35]` + bottom gradient into `--color-bg`; `heroError` state hides the layer.
- **Ambient feed**: `setAmbientSource("tools-modal", heroUrl)` on mount/art change; `clearAmbientSource("tools-modal")` on unmount only (mirrors GameHero pattern).
- **Native fixes section**: only renders when `!nativeInfo` has any applicable/applied row (`SmokeAPI` if steam_api present, `Steamless` if installed, `OnlineFix` if `hasOnlineFix`). Glass rows (`GLASS_ROW` bg-black/40 backdrop-blur) with accent icon chip, applied state (`CheckCircle2` + emerald border), busy spinner, "Aplicar fix"/"Quitar fix" buttons (`GLASS_BUTTON`), disabled-with-hint when tool not installed/not applicable.
- Styling uses hardcoded dark glass (bg-black/40, white text) consistent with the ActiveDownloadCard premium design — ignores theme intentionally.

### Build
- `cargo check` ✅ (only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `tsc --noEmit` ✅ (only 22 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.46s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
