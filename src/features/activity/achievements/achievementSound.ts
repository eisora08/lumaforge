/**
 * Lightweight Web Audio synth for achievement unlock sounds.
 * No external audio files — pure oscillator-based chimes.
 * Rarity determines pitch and complexity: common = simple beep, legendary = rich chord.
 */

let _audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!_audioCtx) {
      _audioCtx = new AudioContext();
    }
    if (_audioCtx.state === "suspended") {
      _audioCtx.resume().catch(() => {});
    }
    return _audioCtx;
  } catch {
    return null;
  }
}

type RarityTone = { freqs: number[]; duration: number; gain: number; waveType: OscillatorType };

const RARITY_TONES: Record<string, RarityTone> = {
  common:    { freqs: [880], duration: 0.15, gain: 0.12, waveType: "sine" },
  uncommon:  { freqs: [880, 1100], duration: 0.2, gain: 0.12, waveType: "sine" },
  rare:      { freqs: [660, 880, 1100], duration: 0.28, gain: 0.14, waveType: "triangle" },
  epic:      { freqs: [440, 554, 660, 880], duration: 0.35, gain: 0.15, waveType: "triangle" },
  legendary: { freqs: [440, 554, 660, 880, 1100], duration: 0.5, gain: 0.16, waveType: "sine" },
};

export function playAchievementSound(rarity: string): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const tone = RARITY_TONES[rarity] ?? RARITY_TONES.common;
  const now = ctx.currentTime;

  // Master gain — fade out at end
  const master = ctx.createGain();
  master.gain.setValueAtTime(tone.gain, now);
  master.gain.exponentialRampToValueAtTime(0.001, now + tone.duration);
  master.connect(ctx.destination);

  for (let i = 0; i < tone.freqs.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = tone.waveType;
    osc.frequency.setValueAtTime(tone.freqs[i], now);

    // Stagger higher notes slightly for shimmer
    const delay = i * 0.03;
    const noteGain = ctx.createGain();
    noteGain.gain.setValueAtTime(0, now + delay);
    noteGain.gain.linearRampToValueAtTime(1, now + delay + 0.02);
    noteGain.gain.exponentialRampToValueAtTime(0.001, now + tone.duration + delay);
    noteGain.connect(master);

    osc.start(now + delay);
    osc.stop(now + tone.duration + delay + 0.01);
  }
}
