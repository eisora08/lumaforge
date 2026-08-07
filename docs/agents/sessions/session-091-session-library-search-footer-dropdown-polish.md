## Session � Library search/footer/dropdown polish + Liquid Glass console
### Goal
Centered topbar search with drag on both sides, fixed pagination footer that hides with Show All, glass dropdown with enter/exit animation, and Liquid Glass look applied to main console surfaces respecting `data-console-theme` overrides.

### Part A: TopBar + PackagesToolbarSearch
- `TopBar.tsx` � new 5-zone header: left group (hamburger only in drawer mode) ? left drag-spacer (`flex-1` + `data-tauri-drag-region` + double-click maximize) ? centered search wrapper (`flex min-w-0 flex-1 items-center justify-center px-2` around `w-full max-w-[540px]`) ? right drag-spacer (identical) ? right group + window controls.
- `showSearch = activePage !== "store"`.
- `PackagesToolbarSearch.tsx` L121 � topbar variant `h-9 w-full` (width controlled by centered wrapper); dropdown unchanged `lf-popover-enter absolute z-50 w-[400px]`.

### Part B: Library pagination footer
- `Library.tsx` � footer renders only when `visibleGames.length > 0 && pageSize !== SHOW_ALL`; `sticky bottom-0 z-10 shrink-0 border-t border-(--surface-active-border)/40 bg-(--color-bg)/70 backdrop-blur-lg`; inner div preserves `mx-auto flex w-full items-center justify-between px-6 py-2.5 lg:px-8 xl:px-10` + `max-w-[1900px]` only when `!settings.libraryUseFullWidth`.

### Part C: CardActionMenu glass + exit animation
- `CardActionMenu.tsx` � `EXIT_MS = 140`, `closing` state + `wasOpenRef` + `closeTimerRef`; render guard `if ((!open && !closing) || !pos) return null`; menu and submenu use `bg-(--color-surface)/95 backdrop-blur-xl`; animation class `closing ? "lf-popover-exit" : "lf-popover-enter"`.
- `App.css` � `@keyframes lfPopoverExit` (140ms ease-in forwards, reverse of enter) + `.lf-popover-exit`.

### Part D: Liquid Glass console surfaces
- `App.css` � `.lf-console-glass` (`color-mix(in srgb, var(--color-surface) 55%, transparent)` + `blur(28px) saturate(1.4)` + inset top highlight) and `.lf-console-glass-strong` (72% + blur(32px) + highlight 0.08); both with `-webkit-backdrop-filter` and `prefers-reduced-motion` guard. Use `--color-surface` so `data-console-theme` overrides are respected.
- Applied to: `ConsoleGridLayout.tsx` right panel (L328) + bottom bar (L567); `ConsoleTopHud.tsx` clock badge + buttons; `ConsoleSpotlightDock.tsx` (L22, kept `ring-white/[0.12]`); `ConsoleGameOptionsOverlay.tsx` panel (L425); `ConsoleSearchOverlay.tsx` sheet (L465); `ConsoleInstallModal.tsx` modal (L186); `ConsoleGameDetails.tsx` panel via `surfaceBg` (liquid-glass?`lf-console-glass`, default?`lf-console-glass-strong`, solid?opaque unchanged).
- Out of scope (kept hardcoded): badge/chip fills (`bg-black/40` dim backdrops, `bg-amber-600/85` toast, `bg-cyan-500/20` rings, category pill hovers).

### Build
- `tsc --noEmit` (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` (1.74s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos)
