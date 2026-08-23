## Session — Tools page → ToolsModal: per-game fix application, no persistent tracking

### Goal
Replace the Tools page (`src/pages/Tools.tsx`) with a modal opened from the game context menu (`GameLauncherTile`), the library detail page, and the sidebar. Remove all persistent fix tracking (`AppliedFix`, `APPLIED_FIXES_KEY`, `MAX_APPLIED_FIXES`, history, `gameId` in `applyTool`/`revertTool`). The modal only detects/applies fixes per game.

### Part 1: types.ts cleanup
- Removed `AppliedFix`, `APPLIED_FIXES_KEY`, `MAX_APPLIED_FIXES`.
- Kept `ToolId`, `ToolGameStatus`, `ToolDetectionResult`, `ToolApplyResult`, `ToolRegistrySnapshot`.

### Part 2: ToolManager.ts cleanup
- Removed `_appliedFixes`, `_loadAppliedFixes`/`_persistAppliedFixes`, `gameMeta` in `applyTool`, `gameId` in `revertTool`.
- Removed exports: `getAppliedFixes`, `getAppliedFixesForGame`, `isToolApplied`, `clearAppliedFixes`.
- Signatures now: `applyTool(toolId, gameInstallDir, extensionInstallDir)`, `revertTool(toolId, gameInstallDir)`.
- `resetToolManagerForTest` without fix cleanup; `getToolManagerDiagnostics` reduced to `{ toolCount, toolIds }`.
- `showSuccess` toasts kept in apply/revert.

### Part 3: tests updated
- `tools.test.ts`: removed "Applied fixes persistence" describe (4 tests), game-removal tests, "Tool constants"; `applyTool`/`revertTool` describes use new signatures.
- `criteriaToolManagerIntegration.test.ts`: does not use the fixes API — no changes.

### Part 4: ToolsModal.tsx (new)
- Props `{ open: boolean; game: LibraryGame | null; onClose: () => void }`.
- `initToolManager()` + `subscribeToolManager`; detection via `detectToolsForGame(game.installDir)` with `cancelled` flag.
- Default selection = not-applied fixes; `handleApply` iterates `applyTool(tool.id, game.installDir!, extensionDir)` + re-detection.
- Overlay via `createPortal`; applied fixes shown checked+disabled (no revert from modal); empty state; detection spinner.
- "Opciones avanzadas" = disabled visual placeholder (no version selector / install pipeline).
- Footer: `[Cancelar]` left, `[Aplicar Fixes]` right, `[✕]` right of title.

### Part 5: Triggers wired
- **GameLauncherTile.tsx**: "Game Fixes" item in Manage submenu (`setMenuOpen(false); setToolsModalOpen(true);`), `ToolsModal` rendered alongside `GameEditDialog`.
- **LibraryGameDetailPage.tsx** + **LibraryGameDetails.tsx**: optional `onOpenTools?: (game: LibraryGame) => void` prop; "Game Fixes" `DropdownItem` after "Manage Artwork"/"Refresh Artwork"; render with `displayGame = resolvedGame || selectedGame`.
- **SidebarLibraryList.tsx** (context menu — user correction: no nav icon in sidebar): "Game Fixes" `MenuItem` (`Wrench` icon) after "Browse Local Files"; opens `ToolsModal` with `menuGame`; `ToolsModal` rendered in collapsed/list/full branches alongside `GameEditDialog`.
- **Sidebar.tsx**: unchanged (no "Herramientas" nav item — the earlier item was removed per user clarification).

### Part 6: Tools page removed
- `src/pages/Tools.tsx` deleted; `App.tsx` without import / `KNOWN_PAGES` / `case "tools"`; `navigation.ts` without `| "tools"`.
- Remaining `"tools"` references are only the extension `ExtensionSurface = "settings" | "tools" | "library"` concept — unrelated.

### Key Files Changed
- `src/extensions/tools/types.ts` — cleaned
- `src/extensions/tools/ToolManager.ts` — cleaned
- `src/__tests__/tools.test.ts` — updated
- `src/components/tools/ToolsModal.tsx` — **new**
- `src/components/games/GameLauncherTile.tsx` — trigger 1 (+ sibling-modals fragment fix)
- `src/pages/LibraryGameDetailPage.tsx`, `src/components/library/LibraryGameDetails.tsx` — trigger 2
- `src/components/layout/SidebarLibraryList.tsx` — trigger 3 (context menu "Game Fixes")
- `src/pages/Tools.tsx` — deleted
- `src/App.tsx`, `src/types/navigation.ts` — no "tools" page

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vitest run` ✅ (only pre-existing `tools.test.ts extractToolConfig` failure: expected `{…(5)}` vs actual `{…(15)}`)
- `vite build` ✅ (only pre-existing chunk warnings)
