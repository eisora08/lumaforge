export type AvatarPreset = {
  id: string;
  label: string;
  gradient: string;
  icon: string;
};

export type BannerPreset = {
  id: string;
  label: string;
  gradient: string;
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "gamepad", label: "Gamepad", gradient: "linear-gradient(135deg, #6366f1, #8b5cf6)", icon: "🎮" },
  { id: "neon", label: "Neon", gradient: "linear-gradient(135deg, #06b6d4, #3b82f6)", icon: "⚡" },
  { id: "ocean", label: "Ocean", gradient: "linear-gradient(135deg, #0ea5e9, #0284c7)", icon: "🌊" },
  { id: "samurai", label: "Samurai", gradient: "linear-gradient(135deg, #ef4444, #dc2626)", icon: "🗡️" },
  { id: "synth", label: "Synth", gradient: "linear-gradient(135deg, #d946ef, #ec4899)", icon: "🌈" },
  { id: "pixel", label: "Pixel", gradient: "linear-gradient(135deg, #22c55e, #16a34a)", icon: "🟩" },
];

export const BANNER_PRESETS: BannerPreset[] = [
  { id: "midnight", label: "Midnight", gradient: "linear-gradient(135deg, #0f172a, #1e293b)" },
  { id: "ocean", label: "Ocean", gradient: "linear-gradient(135deg, #0c4a6e, #0369a1)" },
  { id: "forest", label: "Forest", gradient: "linear-gradient(135deg, #14532d, #15803d)" },
  { id: "red-night", label: "Red Night", gradient: "linear-gradient(135deg, #450a0a, #991b1b)" },
  { id: "steam-blue", label: "Steam Blue", gradient: "linear-gradient(135deg, #1a365d, #2563eb)" },
  { id: "amoled", label: "AMOLED", gradient: "linear-gradient(135deg, #000000, #111111)" },
];

export function getAvatarPreset(id: string): AvatarPreset | undefined {
  return AVATAR_PRESETS.find((p) => p.id === id);
}

export function getBannerPreset(id: string): BannerPreset | undefined {
  return BANNER_PRESETS.find((p) => p.id === id);
}
