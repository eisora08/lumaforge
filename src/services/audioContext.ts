/**
 * Shared AudioContext singleton for all procedural sounds.
 * First user gesture (console mode keydown) creates and activates it.
 * All subsequent callers reuse the same running context.
 */

let _ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext | null {
  try {
    if (!_ctx) {
      _ctx = new AudioContext();
    }
    if (_ctx.state === "suspended") {
      _ctx.resume().catch(() => {});
    }
    return _ctx;
  } catch {
    return null;
  }
}
