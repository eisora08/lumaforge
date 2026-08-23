## Session — Global User Profile in Sidebar Bottom + Profile Modal

### Goal
Move the global user profile from being only in Console Mode/TopBar to the primary sidebar bottom location (replacing "Reiniciar Steam" / "Sistema listo"), with a dedicated Discord-like ProfileModal for editing.

### Part 1: ProfileModal.tsx (new)
- `src/features/profile/ProfileModal.tsx` — **new** — Discord/Playnite style profile editing modal
- Uses `createPortal` to render at body level, `z-50` backdrop blur
- Sections:
  - **Preview**: banner gradient header, circular avatar overlapping banner, display name, status, accent color dot
  - **Identity**: display name input (max 32), status input (max 48)
  - **Avatar**: 6-preset gradient grid selector with ring highlight, optional custom URL field
  - **Banner**: 6-preset gradient grid selector (3-col) with ring highlight, label on each swatch
  - **Accent**: Follow Theme / Custom toggle; `input[type="color"]` picker when custom
- Footer: Reset Profile (rose/destructive), Cancel, Save (accent)
- Live preview updates while editing (draft state)
- Save calls `onSave`, Cancel discards draft, Reset restores `DEFAULT_USER_PROFILE`
- Escape key, backdrop click close modal
- Focus trap (Tab cycling)
- No Rust, no backend, no file upload

### Part 2: Sidebar bottom profile block
- `Sidebar.tsx` — bottom block replaced from "Reiniciar Steam" + "Sistema listo" to:
  - **Profile block**: avatar circle (gradient from preset or custom URL), accent status dot, display name, status line, "..." menu button on hover
  - Clicking profile opens `ProfileModal`
  - **"..." dropdown menu**: "Configuración" (navigates to settings), "Reiniciar Steam" (placeholder, no real functionality removed)
  - Collapsed mode: avatar only (centered, larger), name in tooltip
  - Version text preserved below profile block
  - External click handler closes dropdown
  - Dynamic import avoided: `saveUserProfile` imported statically alongside `useUserProfile`
- Imports: `useUserProfile`, `saveUserProfile`, `getAvatarPreset`, `ProfileModal`, `Ellipsis` icon

### Part 3: Reuse in Console/TopBar (already done in previous session)
- No changes needed — Console HUD, ProfileHeader, and TopBar already consume `useUserProfile()`

### Part 4: Settings separation
- `ProfileModal` is entirely separate from `ConsoleSettingsOverlay`
- Console Settings remains for layout/visual/input options
- Profile Modal remains for avatar/banner/name/status/accent

### Key Files Changed
- `src/features/profile/ProfileModal.tsx` — **new** — Discord-like profile editing modal
- `src/components/layout/Sidebar.tsx` — replaced "Reiniciar Steam" + "Sistema listo" with profile block + "..." menu + ProfileModal integration

### What happened to Reiniciar Steam / Sistema listo
- "Sistema listo" block completely removed (the new profile block takes its space)
- "Reiniciar Steam" moved into the "..." dropdown menu in the profile block — still accessible but less prominent
- No real functionality removed (original "Reiniciar Steam" was a decorative button with no onClick handler)

### Build
- `tsc --noEmit` ✅ passes (0 errors)
- `vite build` ✅ passes (0 errors, only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)
