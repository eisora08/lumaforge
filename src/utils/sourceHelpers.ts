import type { PackageGame, PackageSource } from "../types/package";

export function getBestAvailableSource(
  game: PackageGame
): PackageSource | undefined {
  const available = (game.sources ?? []).filter((s) => s.available);

  const hubcap = available.find((s) => s.providerId === "hubcapdb");
  if (hubcap) return hubcap;

  const sushi = available.find((s) => s.providerId === "sushi");
  if (sushi) return sushi;

  const ryuu = available.find((s) => s.providerId === "ryuu");
  if (ryuu) return ryuu;

  if (available.length > 0) return available[0];

  return undefined;
}

export function getSourceKey(source: PackageSource) {
  return `${source.providerId}-${source.fileType}`;
}
