## Session — Steam-style Library GameDetails Hero Redesign

### Problem
The Library GameDetails hero used a rounded card (`rounded-2xl` + shadow + padding) for the foreground image, creating a floating-poster effect disconnected from the blurred backdrop. The Back to Library button used hardcoded white text on hover instead of the theme accent color.

### Root Cause
- **Floating card effect**: Foreground image wrapped in `rounded-2xl overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.45)]` with `p-2 sm:p-3` padding — created a distinct card boundary with visible rounded corners and a heavy shadow, making the image look like a separate poster floating on top of the blurred backdrop
- **Blur never visible**: `object-cover` on the foreground image filled 100% of the hero, completely hiding the blurred backdrop behind it
- **No theme accent**: Back button hover used `hover:text-white` — never followed the user's selected theme accent

### Changes

#### Steam-style 3-layer hero structure
- **Layer 1 — Blurred backdrop**: Full `absolute inset-0`, `object-cover`, `blur-2xl`, `scale-110`, `saturate-[1.5]`, dim overlay `bg-black/35`
- **Layer 2 — Main image**: Centered horizontally, `w-[85%]` width, fills hero height (`h-full`), `object-cover`, no rounded corners, no shadow, no padding — image naturally fills 85% width, blurred backdrop visible on the 7.5% sides
- **Layer 3 — Edge blending gradients**: Left/right `w-[clamp(40px,12vw,160px)]` gradients (`from-black/40 via-black/10 to-transparent`) blend main image edges into blurred backdrop. Bottom `h-[clamp(80px,15vh,180px)]` gradient ensures smooth transition into action row

#### Hero dimensions
- Updated from `min-h-[260px] max-h-[480px]` to `min-h-[340px] max-h-[520px]` — taller, more cinematic

#### Back to Library — theme accent on hover
- Idle: `bg-black/15 text-white/60`
- Hover: `bg-(--color-accent)/85 text-white shadow-lg shadow-(--color-accent)/25` — uses `--color-accent` CSS variable, follows theme changes in Settings
- Focus: `ring-2 ring-(--color-accent)/60`

#### Loading skeleton
- Hero skeleton dimensions: `min-h-[340px] max-h-[520px]` matching live hero

#### Action row
- Retained `bg-linear-to-b from-white/[0.03] to-transparent` gradient transition (no hard border)

### Key File Changed
- `src/components/library/LibraryGameDetails.tsx` — complete hero restructure

### Build
- `tsc --noEmit` ✅ passes (0 errors)
- `vite build` ✅ passes (0 errors, only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)
