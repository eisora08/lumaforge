## Session — Global User Profile + Expanded Console Settings

### Goal
Create a global aesthetic user profile reusable by Desktop UI and Console Mode, expand Console Settings with 6 sections (Profile, General, Visuals, Layout, Input, Advanced) for Playnite/Solaris-style customization.

### Part 1: UserProfile store
- `src/features/profile/userProfile.ts` — **new** — localStorage key `lumaforge-user-profile-v1`
- Types: `UserProfile` with `displayName`, `status`, `avatarPreset`, `avatarUrl?`, `bannerPreset`, `bannerUrl?`, `accentMode`, `accentColor?`, `updatedAt`
- Defaults: displayName="Gamer", status="Exploring the library", avatarPreset="gamepad", bannerPreset="midnight", accentMode="follow-theme"
- Exports: `DEFAULT_USER_PROFILE`, `getUserProfile()`, `saveUserProfile()`, `resetUserProfile()`, `useUserProfile()`

### Part 2: Global profile reuse
- `ConsoleTopHud.tsx` — reads real avatar/displayName from `useUserProfile()` instead of hardcoded "Gamer"; removed unused `Gamepad2`, `displayName`, `playtimeHours` props; passes `settings` for `showClock`
- `ConsoleProfileHeader.tsx` — reads `useUserProfile()` + `getAvatarPreset`/`getBannerPreset` for full profile display with banner gradient background
- `TopBar.tsx` — compact profile badge (avatar + displayName) to the left of search; navigates to settings
- `ConsoleModePage.tsx` — passes `profile` + `onProfilePatch` through `sharedProps`

### Part 3: Avatar/banner presets
- `src/features/profile/profilePresets.ts` — **new** — `AVATAR_PRESETS` (6: gamepad, neon, ocean, samurai, synth, pixel) with CSS gradients + emoji icons; `BANNER_PRESETS` (6: midnight, ocean, forest, red-night, steam-blue, amoled) with CSS gradients
- `getAvatarPreset(id)` / `getBannerPreset(id)` lookup helpers

### Part 4: Console Settings overlay 6-section rewrite
- `ConsoleSettingsOverlay.tsx` — fully rewritten with sections:
  - **Profile**: display name input, status input, avatar preset picker (gradient swatches), banner preset picker, accent mode toggle + color picker, Reset Profile button
  - **General**: layout (Grid/Spotlight), start category selector, show clock/profile HUD/platform label toggles
  - **Visuals**: theme picker (5 options), background texture picker (4 options), focus shine toggle
  - **Layout**: sliders (cardSize 180-280, gridColumns 4-14, gridGap 16-64, leftPadding 24-160, sidePanelWidth 560-860), bottom bar position (center/left/right), horizontal/smooth scrolling toggles, Reset Layout button
  - **Input**: input hints picker (Xbox/PS/Keyboard/Auto), show button/bottom hints toggles
  - **Advanced**: Reset Console Settings, Reset All Console & Profile Settings buttons
- Accepts `profile` + `onProfilePatch` props alongside `settings` + `onPatch`

### Part 5: Console settings schema expanded
- `consoleSettings.ts` — new fields: `startCategory`, `themeMode` (renamed from `theme`), `backgroundTexture`, `inputHints` (renamed from `inputGlyphs`), `showClock`, `showProfileHud`, `showPlatformLabel`, `showButtonHints`, `showBottomHints`, `leftPadding`, `bottomBarPosition`, `horizontalScrolling`, `smoothScrolling`, `focusShine` (renamed from `enableShineAnimation`)
- Defaults: layoutMode=grid, themeMode=follow-app, cardSize=220, sidePanelWidth=720, leftPadding=64
- `LAYOUT_DEFAULTS`, `resetConsoleLayoutSettings()`, `resetAllConsoleAndProfileSettings()` exports
- Legacy migration: reads old `lumaforge-console-settings-v1` format, maps `theme`→`themeMode`, `inputGlyphs`→`inputHints`, `enableShineAnimation`→`focusShine`, removes old key after migration

### Part 6: Reset defaults (all 4 buttons)
- **Reset Profile**: `resetUserProfile()` + `onProfilePatch(DEFAULT_USER_PROFILE)` — instant
- **Reset Layout**: `resetConsoleLayoutSettings()` + `onPatch(LAYOUT_DEFAULTS)` — partial
- **Reset Console Settings**: `resetConsoleSettings()` + `onPatch(defaults)` — full
- **Reset All**: `resetAllConsoleAndProfileSettings()` + patches both stores — clears both localStorage keys

### Part 7: Theme behavior + CSS presets
- `ConsoleModePage.tsx` — `data-console-theme={consoleSettings.themeMode}` on root wrapper
- `App.css` — 4 console theme CSS presets: solaris-dark (bluish-purple), steam-deck (dark blue-gray/green), midnight (deep blue-black), amoled (true black)
- `follow-app` uses existing global CSS variables (no override)

### Part 8: Layout setting integration
- `ConsoleGridLayout.tsx` — uses `settings.cardSize`, `settings.gridColumns`, `settings.gridGap`, `settings.leftPadding`, `settings.sidePanelWidth` from new defaults (cardSize=220, sidePanelWidth=720, leftPadding=64)

### Part 9: Input hints updated
- `consoleInputHints.ts` — `ConsoleInputHintStyle` includes `"auto"` (auto-detects PlayStation on macOS, Xbox on others); `ConsoleInputGlyphStyle` removed

### Key Files Changed
- `src/features/profile/userProfile.ts` — **new** — global user profile store
- `src/features/profile/profilePresets.ts` — **new** — avatar/banner preset definitions
- `src/features/console/consoleInputHints.ts` — added `"auto"` mode, type rename
- `src/features/console/consoleSettings.ts` — expanded schema, legacy migration, reset helpers
- `src/features/console/ConsoleSettingsOverlay.tsx` — full 6-section rewrite
- `src/features/console/ConsoleTopHud.tsx` — profile-driven, removed hardcoded values
- `src/features/console/ConsoleProfileHeader.tsx` — profile-driven with banner/avatar
- `src/features/console/ConsoleModePage.tsx` — `useUserProfile`, `data-console-theme`, passes profile props
- `src/features/console/ConsoleGridLayout.tsx` — new setting field names, profile/onProfilePatch props
- `src/features/console/ConsoleSpotlightLayout.tsx` — profile/onProfilePatch props, removed unused playtime computation
- `src/features/console/ConsoleCategoryBar.tsx` — `inputGlyphs`→`inputHints` rename
- `src/components/layout/TopBar.tsx` — compact profile badge with avatar + displayName
- `src/App.css` — 4 console theme CSS presets

### Build
- `tsc --noEmit` ✅ passes (0 errors)
- `vite build` ✅ passes (0 errors, only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)
