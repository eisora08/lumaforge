// ── Repack Taxonomy ──
// Known repackers, installer types, language normalization, and tags.

export const KNOWN_REPACKERS = [
  "fitgirl",
  "dodi",
  "elamigos",
  "chovka",
  "kaos",
  "skidrow",
  "codex",
  "plaza",
  "gog",
  "razor1911",
  "hoodlum",
  "cpy",
  "steamrip",
  "tenoke",
] as const;

export type RepackerId = (typeof KNOWN_REPACKERS)[number];

export const INSTALLER_TYPES = [
  "sfx",
  "inno",
  "nsis",
  "portable",
  "preinstalled",
  "unknown",
] as const;

export type InstallerType = (typeof INSTALLER_TYPES)[number];

/** Map a repacker name to a canonical ID */
export function normalizeRepackerName(name: string): string {
  const lower = name.toLowerCase().trim();
  for (const known of KNOWN_REPACKERS) {
    if (lower.includes(known)) return known;
  }
  return lower.replaceAll(/[^a-z0-9]/g, "-");
}

/** Normalize a game title for matching (strip punctuation, lowercase, single spaces) */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/** Common language tags */
export function normalizeLanguage(lang: string): string {
  const map: Record<string, string> = {
    english: "en",
    spanish: "es",
    "spanish (spain)": "es",
    "spanish (latin america)": "es-419",
    french: "fr",
    german: "de",
    italian: "it",
    portuguese: "pt",
    "portuguese (brazil)": "pt-BR",
    russian: "ru",
    japanese: "ja",
    korean: "ko",
    "chinese (simplified)": "zh-CN",
    "chinese (traditional)": "zh-TW",
    arabic: "ar",
    turkish: "tr",
    thai: "th",
    polish: "pl",
    dutch: "nl",
    swedish: "sv",
    danish: "da",
    norwegian: "no",
    finnish: "fi",
  };
  return map[lang.toLowerCase().trim()] || lang;
}
