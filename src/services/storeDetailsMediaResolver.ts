import type { SteamAppMetadata } from "../types/gameMetadata";
import type { PackageGame, PackageSource } from "../types/package";
import { isHttpUrl } from "./libraryLocalCacheService";

export type DetailsMediaSource =
  | "selected-source"
  | "saved-source"
  | "provider-result"
  | "catalog"
  | "canonical"
  | "placeholder";

export type ResolveDetailsMediaInput = {
  appId: string;
  game: PackageGame;
  metadata?: SteamAppMetadata | null;
  selectedSource?: PackageSource | null;
  providerResults?: PackageGame | null;
  isChecking: boolean;
};

export type ResolveDetailsMediaResult = {
  url: string | null;
  source: DetailsMediaSource;
  provider: string | null;
};

function getPreviewFromSource(source: PackageSource): string | null {
  const url = (source as any).previewImage || (source as any).heroImage || (source as any).headerImage || (source as any).bannerImage || (source as any).capsuleImage || null;
  return url && isHttpUrl(url) ? url : null;
}

export function resolveStoreDetailsPreviewImage(
  input: ResolveDetailsMediaInput,
): ResolveDetailsMediaResult {
  const { game, metadata, selectedSource, providerResults } = input;

  // 1. selectedSource with preview image
  if (selectedSource) {
    const src = getPreviewFromSource(selectedSource);
    if (src) {
      return { url: src, source: "selected-source", provider: selectedSource.providerName };
    }
  }

  // 2. providerResults (overlay) imageUrl
  if (providerResults?.imageUrl && isHttpUrl(providerResults.imageUrl)) {
    return { url: providerResults.imageUrl, source: "provider-result", provider: providerResults.sources.find(s => s.available)?.providerName || null };
  }

  // 3. metadata header_image / capsule
  if (metadata) {
    const metaUrl = metadata.header_image || metadata.capsule_image_v5 || metadata.capsule_image || metadata.library_hero_image;
    if (metaUrl) {
      return { url: metaUrl, source: "catalog", provider: null };
    }
  }

  // 4. game.imageUrl fallback
  if (game.imageUrl && isHttpUrl(game.imageUrl)) {
    return { url: game.imageUrl, source: "catalog", provider: null };
  }

  // 5. placeholder
  return { url: null, source: "placeholder", provider: null };
}

export function logDetailsMedia(
  appId: string,
  result: ResolveDetailsMediaResult,
  isChecking: boolean,
) {
  console.log(
    `[STORE][DETAILS_MEDIA] appid=${appId} selected=${result.source} source=${result.source} provider=${result.provider || "null"} hasUrl=${!!result.url} checking=${isChecking}`,
  );
}
