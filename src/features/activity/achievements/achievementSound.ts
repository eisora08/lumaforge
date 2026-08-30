/**
 * Achievement sound player using preloaded audio buffers.
 * Sounds are loaded from /sounds/achievements/ at app startup.
 * Each play creates a fresh AudioContext for guaranteed playback.
 */

import { getAchievementStyle, getAllAchievementStyles } from "./achievementSoundStyles";

const STORAGE_KEY = "lumaforge-settings";
const _bufferCache = new Map<string, AudioBuffer>();

/** Convert a Steam rarity percentage to a rarity string for sound lookup. */
export function rarityFromPercent(percent?: number): string {
  if (percent == null || percent <= 0) return "common";
  if (percent >= 50) return "common";
  if (percent >= 20) return "uncommon";
  if (percent >= 10) return "rare";
  if (percent >= 5) return "epic";
  return "legendary";
}

function readSoundSettings(): { enabled: boolean; styleId: string; volume: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: true, styleId: "classic", volume: 0.7 };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      enabled: typeof parsed.achievementSoundsEnabled === "boolean" ? parsed.achievementSoundsEnabled : true,
      styleId: typeof parsed.achievementSoundStyle === "string" ? parsed.achievementSoundStyle : "classic",
      volume: typeof parsed.soundEffectsVolume === "number" ? parsed.soundEffectsVolume : 0.7,
    };
  } catch {
    return { enabled: true, styleId: "classic", volume: 0.7 };
  }
}

/** Preload all achievement sound files into AudioBuffer cache. Call once at app startup. */
export async function preloadAchievementSounds(): Promise<void> {
  let ctx: AudioContext;
  try { ctx = new AudioContext(); } catch { return; }

  const files = new Set<string>();
  for (const style of getAllAchievementStyles()) {
    for (const file of Object.values(style.sounds)) {
      files.add(file);
    }
  }

  let loaded = 0;
  await Promise.all(
    [...files].map(async (file) => {
      try {
        const res = await fetch(`/sounds/achievements/${file}`);
        if (!res.ok) {
          console.warn(`[ACH] Failed to fetch ${file}: ${res.status}`);
          return;
        }
        const data = await res.arrayBuffer();
        const buffer = await ctx.decodeAudioData(data);
        _bufferCache.set(file, buffer);
        loaded++;
      } catch (e) {
        console.warn(`[ACH] Failed to decode ${file}:`, e);
      }
    }),
  );
  console.log(`[ACH] Preloaded ${loaded}/${files.size} achievement sounds`);
  ctx.close().catch(() => {});
}

function playBuffer(buffer: AudioBuffer, volume: number): void {
  let ctx: AudioContext;
  try { ctx = new AudioContext(); } catch { return; }

  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  source.connect(gain);
  gain.connect(ctx.destination);

  if (ctx.state === "suspended") {
    ctx.resume().then(() => { source.start(); }).catch(() => {});
  } else {
    source.start();
  }

  setTimeout(() => { ctx.close().catch(() => {}); }, buffer.duration * 1000 + 500);
}

export function playAchievementSound(rarity: string): void {
  const { enabled, styleId, volume } = readSoundSettings();
  if (!enabled || volume <= 0) return;

  const style = getAchievementStyle(styleId);
  const file = style.sounds[rarity] ?? style.sounds.common;
  const buffer = _bufferCache.get(file);

  console.log(`[ACH] play: rarity=${rarity} style=${styleId} file=${file} buffer=${!!buffer} vol=${volume} enabled=${enabled}`);

  if (!buffer) return;

  playBuffer(buffer, volume);
}

export function previewAchievementSound(styleId: string, rarity: string): void {
  const style = getAchievementStyle(styleId);
  const file = style.sounds[rarity] ?? style.sounds.common;
  const buffer = _bufferCache.get(file);

  console.log(`[ACH] preview: style=${styleId} rarity=${rarity} file=${file} buffer=${!!buffer}`);

  if (!buffer) return;

  let ctx: AudioContext;
  try { ctx = new AudioContext(); } catch { return; }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);

  if (ctx.state === "suspended") {
    ctx.resume().then(() => { source.start(); }).catch(() => {});
  } else {
    source.start();
  }

  setTimeout(() => { ctx.close().catch(() => {}); }, buffer.duration * 1000 + 500);
}
