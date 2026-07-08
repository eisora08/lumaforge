import type { SteamAppMetadata } from "../../types/gameMetadata";
import type { CuratedDenuvoEntry } from "./curatedDenuvoIndex";

export interface StoreDrmInfo {
  hasThirdPartyDrm: boolean;
  hasDenuvo: boolean;
  drmNames: string[];
  source: "steam-metadata" | "steam-html" | "curated-denuvo-index" | "none";
  matchedText?: string;
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

const DENUVO_PATTERNS = [
  /\bdenuvo\b/i,
  /\bdenuvo anti-tamper\b/i,
];

const THIRD_PARTY_DRM_PATTERNS = [
  /incorporates 3rd.party drm/i,
  /3rd.party drm/i,
  /third.party drm/i,
];

export function extractStoreDrmInfo(
  metadata: SteamAppMetadata | undefined
): StoreDrmInfo {
  const result: StoreDrmInfo = {
    hasThirdPartyDrm: false,
    hasDenuvo: false,
    drmNames: [],
    source: "none",
  };

  if (!metadata) return result;

  // Priority 1: legal_notice from Steam appdetails API (steam-metadata)
  if (metadata.legal_notice) {
    searchField(result, metadata.legal_notice, "steam-metadata");
    if (result.hasThirdPartyDrm) return result;
  }

  // Priority 2: store_drm_notice from Steam Store HTML (steam-html)
  if (metadata.store_drm_notice) {
    searchField(result, metadata.store_drm_notice, "steam-html");
    if (result.hasThirdPartyDrm) return result;
  }

  // Priority 3: detailed_description
  if (metadata.detailed_description) {
    searchField(result, metadata.detailed_description, "steam-metadata");
    if (result.hasThirdPartyDrm) return result;
  }

  // Priority 4: about_the_game
  if (metadata.about_the_game) {
    searchField(result, metadata.about_the_game, "steam-metadata");
    if (result.hasThirdPartyDrm) return result;
  }

  // Priority 5: short_description
  if (metadata.short_description) {
    searchField(result, metadata.short_description, "steam-metadata");
  }

  return result;
}

export function applyCuratedDenuvoFallback(
  current: StoreDrmInfo,
  curatedEntry: CuratedDenuvoEntry | undefined,
): StoreDrmInfo {
  if (!curatedEntry || !curatedEntry.drm.hasDenuvo) return current;

  // Only apply curated fallback when no official source found DRM info
  if (current.source !== "none") return current;

  return {
    hasThirdPartyDrm: true,
    hasDenuvo: true,
    drmNames: ["Denuvo Anti-Tamper"],
    source: "curated-denuvo-index",
    matchedText: "Curated Denuvo index",
  };
}

function searchField(
  result: StoreDrmInfo,
  raw: string,
  source: "steam-metadata" | "steam-html",
): void {
  const text = stripHtml(raw);

  for (const denuvoPattern of DENUVO_PATTERNS) {
    const match = text.match(denuvoPattern);
    if (match) {
      result.hasDenuvo = true;
      result.hasThirdPartyDrm = true;
      result.drmNames.push("Denuvo Anti-Tamper");
      result.matchedText = text.slice(
        Math.max(0, (match.index ?? 0) - 20),
        (match.index ?? 0) + match[0].length + 20,
      ).trim();
      result.source = source;
      return;
    }
  }

  for (const drmPattern of THIRD_PARTY_DRM_PATTERNS) {
    const match = text.match(drmPattern);
    if (match) {
      result.hasThirdPartyDrm = true;
      const afterDrm = text.slice((match.index ?? 0) + match[0].length).trim();
      const drmName = afterDrm.split(/[,.;\n]/)[0]?.trim() || "Unknown DRM";
      result.drmNames.push(drmName);
      result.matchedText = text.slice(
        Math.max(0, (match.index ?? 0) - 20),
        (match.index ?? 0) + match[0].length + 30,
      ).trim();
      result.source = source;
      return;
    }
  }
}
