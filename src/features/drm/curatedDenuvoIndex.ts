export interface CuratedDenuvoSource {
  id: string;
  name: string;
  url: string;
}

export interface CuratedDenuvoDrmInfo {
  hasDenuvo: boolean;
  type: "Denuvo Anti-Tamper";
  status: "active" | "removed" | "unknown";
  confidence: "high" | "medium" | "low";
  sourceIds: string[];
}

export interface CuratedDenuvoEntry {
  appId?: string;
  title: string;
  normalizedTitle: string;
  series?: string | null;
  developers: string[];
  publishers: string[];
  releaseDate?: string | null;
  platforms: string[];
  drm: CuratedDenuvoDrmInfo;
  notes?: string;
}

export interface CuratedDenuvoIndex {
  schemaVersion: number;
  updatedAt: string;
  sources: CuratedDenuvoSource[];
  entries: CuratedDenuvoEntry[];
}

export function normalizeDenuvoTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type MatchCuratedDenuvoParams = {
  appId?: string | number | null;
  title?: string | null;
  developerNames?: string[];
  publisherNames?: string[];
  index: CuratedDenuvoIndex;
};

export function matchCuratedDenuvoEntry(
  params: MatchCuratedDenuvoParams,
): CuratedDenuvoEntry | undefined {
  const { appId, title, developerNames = [], publisherNames = [], index } = params;

  if (!appId && !title) return undefined;

  // Priority 1: Exact appId match
  if (appId) {
    const appIdStr = String(appId);
    const byAppId = index.entries.find((e) => e.appId === appIdStr);
    if (byAppId) return byAppId;
  }

  // Priority 2: Exact normalized title match + developer/publisher overlap
  if (title) {
    const normalized = normalizeDenuvoTitle(title);
    const candidates = index.entries.filter((e) => e.normalizedTitle === normalized);
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];

    // Multiple candidates with same normalized title — prefer developer/publisher overlap
    const developerSet = new Set(developerNames.map((n) => n.toLowerCase()));
    const publisherSet = new Set(publisherNames.map((n) => n.toLowerCase()));

    const withOverlap = candidates.filter((e) => {
      const entryDevs = new Set(e.developers.map((d) => d.toLowerCase()));
      const entryPubs = new Set(e.publishers.map((p) => p.toLowerCase()));
      const devOverlap = [...developerSet].some((d) => [...entryDevs].some((ed) => ed.includes(d) || d.includes(ed)));
      const pubOverlap = [...publisherSet].some((p) => [...entryPubs].some((ep) => ep.includes(p) || p.includes(ep)));
      return devOverlap || pubOverlap;
    });
    if (withOverlap.length === 1) return withOverlap[0];
    if (withOverlap.length > 1) return withOverlap[0];

    // No overlap — return first candidate (still an exact title match)
    return candidates[0];
  }

  return undefined;
}
