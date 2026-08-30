/**
 * Ambient background sound for Console mode.
 * Plays audio_background.mp3 in loop with fade-in/out.
 * Preloaded at app startup for zero-latency start.
 */

import { getAudioContext } from "./audioContext";

let _buffer: AudioBuffer | null = null;
let _source: AudioBufferSourceNode | null = null;
let _gain: GainNode | null = null;
let _filter: BiquadFilterNode | null = null;
let _compressor: DynamicsCompressorNode | null = null;
let _playing = false;
let _fadeTimer: ReturnType<typeof setTimeout> | null = null;

/** Preload the ambient audio file. Call once at app startup. */
export async function preloadAmbientSound(): Promise<void> {
  try {
    const res = await fetch("/sounds/ambient/audio_background.mp3");
    if (!res.ok) return;
    const data = await res.arrayBuffer();
    const ctx = getAudioContext();
    if (!ctx) return;
    _buffer = await ctx.decodeAudioData(data);
  } catch {
    // ignore missing file
  }
}

export function startAmbientSound(volume: number): void {
  // StrictMode: cancel pending fade-out and clean up old nodes
  if (_fadeTimer) {
    clearTimeout(_fadeTimer);
    _fadeTimer = null;
    try { _source?.stop(); } catch {}
    try { _source?.disconnect(); } catch {}
    try { _filter?.disconnect(); } catch {}
    try { _compressor?.disconnect(); } catch {}
    try { _gain?.disconnect(); } catch {}
    _source = null;
    _filter = null;
    _compressor = null;
    _gain = null;
    _playing = false;
  }
  if (_playing || !_buffer) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  // Lowpass filter — warmth and depth (cutoff ~2500Hz)
  _filter = ctx.createBiquadFilter();
  _filter.type = "lowpass";
  _filter.frequency.setValueAtTime(2500, ctx.currentTime);
  _filter.Q.setValueAtTime(0.7, ctx.currentTime);

  // Compressor — even out dynamics for polished feel
  _compressor = ctx.createDynamicsCompressor();
  _compressor.threshold.setValueAtTime(-20, ctx.currentTime);
  _compressor.ratio.setValueAtTime(3, ctx.currentTime);
  _compressor.attack.setValueAtTime(0.003, ctx.currentTime);
  _compressor.release.setValueAtTime(0.25, ctx.currentTime);

  // Master gain — fade in/out + volume control
  _gain = ctx.createGain();
  _gain.gain.setValueAtTime(0, ctx.currentTime);
  _gain.connect(ctx.destination);

  // Chain: source → filter → compressor → gain → destination
  _source = ctx.createBufferSource();
  _source.buffer = _buffer;
  _source.loop = true;
  _source.connect(_filter);
  _filter.connect(_compressor);
  _compressor.connect(_gain);
  _source.start();

  // Fade in over 5 seconds (volume * 0.5 for lower ambient level)
  _gain.gain.linearRampToValueAtTime(volume * 0.5, ctx.currentTime + 5);

  _playing = true;
}

export function stopAmbientSound(): void {
  if (!_playing || !_gain || !_source) return;

  if (_fadeTimer) clearTimeout(_fadeTimer);

  const ctx = getAudioContext();
  if (!ctx) return;

  // Fade out over 1s
  const now = ctx.currentTime;
  _gain.gain.cancelScheduledValues(now);
  _gain.gain.setValueAtTime(_gain.gain.value, now);
  _gain.gain.linearRampToValueAtTime(0, now + 1);

  _fadeTimer = setTimeout(() => {
    try { _source?.stop(); } catch {}
    try { _source?.disconnect(); } catch {}
    try { _filter?.disconnect(); } catch {}
    try { _compressor?.disconnect(); } catch {}
    try { _gain?.disconnect(); } catch {}
    _source = null;
    _filter = null;
    _compressor = null;
    _gain = null;
    _playing = false;
  }, 1100);
}

export function setAmbientVolume(volume: number): void {
  if (!_playing || !_gain) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  _gain.gain.cancelScheduledValues(now);
  _gain.gain.setValueAtTime(_gain.gain.value, now);
  _gain.gain.linearRampToValueAtTime(volume * 0.5, now + 0.3);
}

export function isAmbientPlaying(): boolean {
  return _playing;
}
