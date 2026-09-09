import { emulatorPlatforms } from "../data/emulatorDefinitions/platforms";

const _shortNameById = new Map<string, string>();
for (const p of emulatorPlatforms) {
  _shortNameById.set(p.id, p.shortName);
}

export function getPlatformShortName(platformId: string | null | undefined): string | null {
  if (!platformId) return null;
  return _shortNameById.get(platformId) ?? null;
}

export function getPlatformFullName(platformId: string | null | undefined): string | null {
  if (!platformId) return null;
  return emulatorPlatforms.find(p => p.id === platformId)?.name ?? null;
}
