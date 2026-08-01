import { useEffect, useState } from "react";

/**
 * Dynamic palette extraction for the Downloads hero.
 *
 * Samples the artwork on a tiny 64×36 canvas, keeps only "interesting" pixels
 * (ignores black/white/grey/desaturated), converts each to OKLCH (own
 * sRGB→OKLCH implementation, no dependencies), quantizes by hue into 24
 * buckets, picks the dominant hue and derives a tri-color palette:
 *
 *   primary   — dominant hue, medium-dark, saturation-clamped  (muted backdrop)
 *   secondary — same hue, brighter, more saturated              (bars, accent)
 *   glow      — bright secondary                                (radial glow)
 *
 * The chosen hue is blended 18% toward the LumaForge blue-cyan accent so the
 * result always reads "on brand" even for strongly colored art.
 *
 * If the artwork can't be sampled (CORS-tainted canvas, no window, load
 * failure, etc.) the hook falls back to a fixed blue-cyan palette — never
 * throws. Results are cached per URL for the session.
 */

export type DynamicPalette = {
  primary: string;
  secondary: string;
  glow: string;
};

const FALLBACK_PALETTE: DynamicPalette = {
  primary: "#1d3343",
  secondary: "#2f9fff",
  glow: "#2f9fff",
};

const CANVAS_W = 64;
const CANVAS_H = 36;

// Hue buckets: [0, 360) split into 24 slices of 15°.
const HUE_BUCKETS = 24;
const HUE_SLICE = 360 / HUE_BUCKETS;

// Pixels outside these OKLCH bounds are "noise" for palette purposes.
const MIN_LIGHTNESS = 0.08;
const MAX_LIGHTNESS = 0.93;
const MIN_CHROMA = 0.03;

const SAMPLE_BLEND = 0.18; // toward the LumaForge blue-cyan accent
const ACCENT_HUE = 235; // OKLCH hue of the blue-cyan accent

// Clamp targets (OKLCH space).
const PRIMARY_L = 0.32;
const PRIMARY_C = 0.1;
const SECONDARY_L = 0.7;
const SECONDARY_C = 0.2;

const DEBOUNCE_MS = 100;

const _paletteCache = new Map<string, DynamicPalette>();

/* ── sRGB → OKLCH (Björn Ottosson's formulation) ────────────────────────── */

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function srgbToOklch(r: number, g: number, b: number): { L: number; C: number; H: number } {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bAxis = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const C = Math.sqrt(a * a + bAxis * bAxis);
  let H = (Math.atan2(bAxis, a) * 180) / Math.PI;
  if (H < 0) H += 360;

  return { L, C, H };
}

function oklchToSrgb(L: number, C: number, H: number): [number, number, number] {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return [clamp(r), clamp(g), clamp(bl)];
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function oklchToHex(L: number, C: number, H: number): string {
  const [r, g, b] = oklchToSrgb(L, C, H);
  const to255 = (v: number) => Math.round(linearToSrgb(v) * 255);
  return `#${[r, g, b].map((v) => to255(v).toString(16).padStart(2, "0")).join("")}`;
}

/* ── Sampling ───────────────────────────────────────────────────────────── */

function samplePaletteFromCanvas(canvas: HTMLCanvasElement): DynamicPalette | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    // Canvas is tainted (cross-origin artwork without CORS headers) — bail.
    return null;
  }

  const bucketSum = new Float32Array(HUE_BUCKETS);
  const bucketCount = new Uint32Array(HUE_BUCKETS);
  const bucketHue = new Float32Array(HUE_BUCKETS);
  const bucketWeight = new Float32Array(HUE_BUCKETS);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const a = data[i + 3] / 255;

    if (a < 0.5) continue;

    const { L, C, H } = srgbToOklch(r, g, b);

    if (L < MIN_LIGHTNESS || L > MAX_LIGHTNESS) continue;
    if (C < MIN_CHROMA) continue;

    const bucket = Math.floor(H / HUE_SLICE) % HUE_BUCKETS;
    bucketSum[bucket] += H;
    bucketCount[bucket] += 1;
    bucketWeight[bucket] += C * 10; // chroma-weighted dominance
    bucketHue[bucket] += H * (1 + C);
  }

  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < HUE_BUCKETS; i += 1) {
    if (bucketWeight[i] > bestScore) {
      bestScore = bucketWeight[i];
      best = i;
    }
  }

  if (best < 0 || bucketCount[best] < 2) return null;

  const hue = bucketHue[best] / (bucketCount[best] * (1 + bestScore / Math.max(1, bucketWeight[best])) + 1e-6);

  // Blend the dominant hue toward the LumaForge blue-cyan accent.
  let dh = hue - ACCENT_HUE;
  while (dh > 180) dh -= 360;
  while (dh < -180) dh += 360;
  const blendedHue = (hue - dh * SAMPLE_BLEND + 360) % 360;

  return {
    primary: oklchToHex(PRIMARY_L, PRIMARY_C, blendedHue),
    secondary: oklchToHex(SECONDARY_L, SECONDARY_C, blendedHue),
    glow: oklchToHex(Math.min(0.82, SECONDARY_L + 0.08), SECONDARY_C, blendedHue),
  };
}

function extractPaletteFromUrl(src: string): Promise<DynamicPalette | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      resolve(null);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";

    let settled = false;
    const finish = (palette: DynamicPalette | null) => {
      if (settled) return;
      settled = true;
      resolve(palette);
    };

    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
        finish(samplePaletteFromCanvas(canvas));
      } catch {
        finish(null);
      }
    };
    img.onerror = () => finish(null);

    img.src = src;
  });
}

/**
 * Extracts a DynamicPalette for `src` (cached per URL). Returns the cache hit
 * synchronously when available, otherwise falls back immediately and refines
 * async once the sample resolves. Never throws.
 */
export function useDynamicPalette(
  src: string | null | undefined
): DynamicPalette {
  const resolved = src ?? null;

  const [palette, setPalette] = useState<DynamicPalette>(() => {
    if (resolved) {
      const cached = _paletteCache.get(resolved);
      if (cached) return cached;
    }
    return FALLBACK_PALETTE;
  });

  useEffect(() => {
    if (!resolved) {
      setPalette(FALLBACK_PALETTE);
      return;
    }

    const cached = _paletteCache.get(resolved);
    if (cached) {
      setPalette(cached);
      return;
    }

    // Debounce: let the artwork (and the main thread) settle before sampling.
    const timer = window.setTimeout(() => {
      let cancelled = false;
      extractPaletteFromUrl(resolved).then((result) => {
        if (cancelled || !result) return;
        _paletteCache.set(resolved, result);
        setPalette(result);
      });
      return () => {
        cancelled = true;
      };
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [resolved]);

  return palette;
}
