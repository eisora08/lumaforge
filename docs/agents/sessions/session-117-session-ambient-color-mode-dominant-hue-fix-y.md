## Session — Ambient color mode: dominant-hue fix (yellow showed as red/pink)

### Problem
In "Color dominante" ambient mode, yellow-dominant art (e.g. Cuphead) sampled as reddish/pinkish instead of yellow. Both consumers affected: `AmbientBackground` (color mode) and `ActiveDownloadCard` (Downloads hero).

### Root cause (`useDynamicPalette.ts` `samplePaletteFromCanvas`)
- Line 171 denominator `bucketCount[best] * (1 + bestScore / Math.max(1, bucketWeight[best]))` — since `best` is the argmax of `bucketWeight`, `bestScore === bucketWeight[best]` → `1 + ratio` **always collapses to 2** → denominator = `2 * count`.
- Numerator `bucketHue[best]` accumulates `Σ H·(1+C)` (chroma-weighted hue sum). So computed hue ≈ `ΣH·(1+C)/(2·count)` ≈ **half the real dominant hue**. Yellow (OKLCH `H≈110`) → ~55 = red-orange; the bright low-chroma `secondary`/`glow` render that as pinkish.
- Line 154 `bucketSum[bucket] += H` was dead code (never read) — leftover from a plain-average attempt.

### Fix (`src/hooks/useDynamicPalette.ts`)
- **Proper chroma-weighted mean**: added `bucketDenom = new Float32Array(HUE_BUCKETS)`; accumulate `bucketDenom[bucket] += 1 + C;` next to `bucketHue[bucket] += H * (1 + C);`; compute `hue = bucketHue[best] / (bucketDenom[best] || 1)`.
- Removed dead `bucketSum` accumulation + declaration.
- **Brand blend reduced** `SAMPLE_BLEND` `0.18` → `0.10` (user decision) so yellows read yellow instead of drifting green toward the blue accent; doc comment updated.
- Extracted the argmax+guard+mean+blend into **pure, exported `dominantBlendedHue(bucketCount, bucketHue, bucketWeight, bucketDenom)`** (returns `number | null`), used by `samplePaletteFromCanvas` — testable without canvas.

### Regression tests (`src/__tests__/dynamicPalette.test.ts` — new, 5 tests)
- Yellow art stays yellow (asserts result > 80 — NOT the buggy ~55 red-orange).
- Red art stays red.
- **Chroma weighting exact-bug test**: same bucket, 1000 low-chroma pixels (H=106, C=0.05) + 5 vivid (H=118, C=0.5) → weighted mean ≈ 106.08 + 10% blend ≈ 119 (old 2·count denominator gave ≈55.8).
- Empty data → null; single-pixel bucket → null.

### Key Files Changed
- `src/hooks/useDynamicPalette.ts` — `bucketDenom`, proper weighted mean, removed `bucketSum`, `SAMPLE_BLEND` 0.10, exported `dominantBlendedHue`
- `src/__tests__/dynamicPalette.test.ts` — **new** — 5 regression tests

### Build
- `vitest run src/__tests__/dynamicPalette.test.ts` ✅ 5/5 passed
- `tsc --noEmit` ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.23s, Rolldown; only pre-existing chunk warnings + informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ⏭️ skipped (no Rust changes)
