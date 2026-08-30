export type AchievementSoundStyle = {
  id: string;
  label: string;
  sounds: Record<string, string>;
};

export const ACHIEVEMENT_SOUND_STYLES: AchievementSoundStyle[] = [
  {
    id: "classic",
    label: "Classic",
    sounds: {
      common: "gog-galaxy.wav",
      uncommon: "gog-galaxy.wav",
      rare: "gog-galaxy.wav",
      epic: "gog-galaxy.wav",
      legendary: "gog-galaxy.wav",
    },
  },
  {
    id: "playstation",
    label: "PlayStation",
    sounds: {
      common: "playstation.wav",
      uncommon: "playstation.wav",
      rare: "playstation5.wav",
      epic: "playstation5.wav",
      legendary: "playstation5-platinum.wav",
    },
  },
  {
    id: "xbox",
    label: "Xbox",
    sounds: {
      common: "xbox.wav",
      uncommon: "xbox.wav",
      rare: "xbox-v1.wav",
      epic: "xbox-rare.wav",
      legendary: "xbox-rare-v1.wav",
    },
  },
  {
    id: "retro",
    label: "Retro",
    sounds: {
      common: "gog-galaxy.wav",
      uncommon: "gog-galaxy.wav",
      rare: "gog-galaxy.wav",
      epic: "gog-galaxy.wav",
      legendary: "gog-galaxy.wav",
    },
  },
  {
    id: "minimal",
    label: "Minimal",
    sounds: {
      common: "steam.wav",
      uncommon: "steam.wav",
      rare: "steam.wav",
      epic: "steam.wav",
      legendary: "steam.wav",
    },
  },
  {
    id: "epic",
    label: "Epic",
    sounds: {
      common: "epic-games.wav",
      uncommon: "epic-games.wav",
      rare: "epic-games.wav",
      epic: "epic-games.wav",
      legendary: "epic-games.wav",
    },
  },
  {
    id: "steam",
    label: "Steam",
    sounds: {
      common: "steam.wav",
      uncommon: "steam.wav",
      rare: "steam.wav",
      epic: "steam-deck.wav",
      legendary: "steam-deck.wav",
    },
  },
];

export function getAchievementStyle(id: string): AchievementSoundStyle {
  return ACHIEVEMENT_SOUND_STYLES.find((s) => s.id === id) ?? ACHIEVEMENT_SOUND_STYLES[0];
}

export function getAllAchievementStyles(): AchievementSoundStyle[] {
  return ACHIEVEMENT_SOUND_STYLES;
}
