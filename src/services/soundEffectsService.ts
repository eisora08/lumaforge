import { getAudioContext } from "./audioContext";

const STORAGE_KEY = "lumaforge-settings";

function readSoundSettings(): { enabled: boolean; volume: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: true, volume: 0.7 };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      enabled: typeof parsed.soundEffectsEnabled === "boolean" ? parsed.soundEffectsEnabled : true,
      volume: typeof parsed.soundEffectsVolume === "number" ? parsed.soundEffectsVolume : 0.7,
    };
  } catch {
    return { enabled: true, volume: 0.7 };
  }
}

export function playNavigateSound(): void {
  const { enabled, volume } = readSoundSettings();
  if (!enabled || volume <= 0) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.08 * volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  gain.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(800, now);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.06);
}

export function playSelectSound(): void {
  const { enabled, volume } = readSoundSettings();
  if (!enabled || volume <= 0) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.12 * volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  gain.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(900, now + 0.08);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.12);
}

export function playLaunchSound(): void {
  const { enabled, volume } = readSoundSettings();
  if (!enabled || volume <= 0) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.14 * volume, now);
  master.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  master.connect(ctx.destination);

  const notes = [523.25, 659.25, 783.99];
  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(notes[i], now);

    const delay = i * 0.04;
    const noteGain = ctx.createGain();
    noteGain.gain.setValueAtTime(0, now + delay);
    noteGain.gain.linearRampToValueAtTime(1, now + delay + 0.02);
    noteGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4 + delay);
    noteGain.connect(master);

    osc.start(now + delay);
    osc.stop(now + 0.4 + delay + 0.01);
  }
}

export function playEntrySound(): void {
  const { enabled, volume } = readSoundSettings();
  if (!enabled || volume <= 0) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.1 * volume, now + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  gain.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.exponentialRampToValueAtTime(660, now + 0.15);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.3);
}

export function playOpenSound(): void {
  const { enabled, volume } = readSoundSettings();
  if (!enabled || volume <= 0) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.1 * volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  gain.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(500, now);
  osc.frequency.exponentialRampToValueAtTime(700, now + 0.1);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.15);
}

export function playCloseSound(): void {
  const { enabled, volume } = readSoundSettings();
  if (!enabled || volume <= 0) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.08 * volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  gain.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(700, now);
  osc.frequency.exponentialRampToValueAtTime(400, now + 0.08);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.12);
}

export function playSwitchSound(): void {
  const { enabled, volume } = readSoundSettings();
  if (!enabled || volume <= 0) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.1 * volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  gain.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
  osc.frequency.exponentialRampToValueAtTime(600, now + 0.16);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.2);
}

export function playExitSound(): void {
  const { enabled, volume } = readSoundSettings();
  if (!enabled || volume <= 0) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.1 * volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  gain.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(660, now);
  osc.frequency.exponentialRampToValueAtTime(330, now + 0.2);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.25);
}
