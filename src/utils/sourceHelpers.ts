import type { PackageGame, PackageSource } from "../types/package";

export function getBestAvailableSource(
  game: PackageGame
): PackageSource | undefined {
  const available = (game.sources ?? []).filter((s) => s.available);

  const hubcap = available.find((s) => s.providerId === "hubcapdb");
  if (hubcap) return hubcap;

  const ryuu = available.find((s) => s.providerId === "ryuu");
  if (ryuu) return ryuu;

  if (available.length > 0) return available[0];

  return undefined;
}

export function getSourceKey(source: PackageSource) {
  if (source.repackEntryId) return `repack:${source.repackEntryId}`;
  return `${source.providerId}-${source.fileType}`;
}
