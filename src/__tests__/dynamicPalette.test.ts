/**
 * DynamicPalette — dominant-hue extraction regression tests.
 *
 * `dominantBlendedHue` is the pure, testable core of the ambient/downloads
 * palette extraction. The previous implementation divided the chroma-weighted
 * hue sum by `2 * count` (the `1 + bestScore/bucketWeight[best]` term always
 * collapsed to 2), halving the hue — yellow art (H≈110) sampled as red-orange
 * (≈55). These tests pin the weighted-mean fix so it can't regress.
 */

import { describe, it, expect } from "vitest";
import { dominantBlendedHue } from "../hooks/useDynamicPalette";

const HUE_BUCKETS = 24;
const HUE_SLICE = 360 / HUE_BUCKETS;

type Sample = { L: number; C: number; H: number };

function bucketsFromSamples(
  samples: Sample[]
): { count: Uint32Array; hue: Float32Array; weight: Float32Array; denom: Float32Array } {
  const count = new Uint32Array(HUE_BUCKETS);
  const hue = new Float32Array(HUE_BUCKETS);
  const weight = new Float32Array(HUE_BUCKETS);
  const denom = new Float32Array(HUE_BUCKETS);

  for (const { C, H } of samples) {
    const bucket = Math.floor(H / HUE_SLICE) % HUE_BUCKETS;
    count[bucket] += 1;
    weight[bucket] += C * 10;
    hue[bucket] += H * (1 + C);
    denom[bucket] += 1 + C;
  }

  return { count, hue, weight, denom };
}

function fill(samples: Sample[], L: number, C: number, H: number, n: number): void {
  for (let i = 0; i < n; i += 1) samples.push({ L, C, H });
}

describe("dominantBlendedHue", () => {
  it("keeps yellow art yellow (regression: was halved to red-orange)", () => {
    const samples: Sample[] = [];
    fill(samples, 0.7, 0.25, 110, 200); // yellow OKLCH hue
    const { count, hue, weight, denom } = bucketsFromSamples(samples);

    const result = dominantBlendedHue(count, hue, weight, denom);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(95);
    expect(result!).toBeLessThan(140);
    expect(result!).toBeGreaterThan(80); // NOT the buggy ~55 red-orange
  });

  it("keeps red art red", () => {
    const samples: Sample[] = [];
    fill(samples, 0.5, 0.2, 30, 200); // red OKLCH hue
    const { count, hue, weight, denom } = bucketsFromSamples(samples);

    const result = dominantBlendedHue(count, hue, weight, denom)!;
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(45);
  });

  it("weights by chroma (1+C), not pixel count — the exact bug being fixed", () => {
    // Same 15° bucket: lots of low-chroma pixels at H=106, few vivid at H=118.
    const samples: Sample[] = [];
    fill(samples, 0.6, 0.05, 106, 1000);
    fill(samples, 0.6, 0.5, 118, 5);

    const { count, hue, weight, denom } = bucketsFromSamples(samples);

    // Weighted mean: ΣH(1+C) / Σ(1+C) ≈ (1000·106·1.05 + 5·118·1.5) / (1050 + 7.5) ≈ 106.08,
    // then +10% blend toward the accent (H≈235) ⇒ ≈ 119.
    const result = dominantBlendedHue(count, hue, weight, denom)!;
    expect(result).toBeGreaterThan(114);
    expect(result).toBeLessThan(124);
    // Old denominator (2·count = 2010) would give ≈55.8 → red-orange.
    expect(result).toBeGreaterThan(80);
  });

  it("returns null when the dominant bucket has fewer than 2 pixels", () => {
    const samples: Sample[] = [{ L: 0.6, C: 0.2, H: 110 }];
    const { count, hue, weight, denom } = bucketsFromSamples(samples);
    expect(dominantBlendedHue(count, hue, weight, denom)).toBeNull();
  });

  it("returns null when there is no data at all", () => {
    const { count, hue, weight, denom } = bucketsFromSamples([]);
    expect(dominantBlendedHue(count, hue, weight, denom)).toBeNull();
  });
});
