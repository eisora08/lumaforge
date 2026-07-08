// ---------------------------------------------------------------------------
// Store Discovery Index — derived from steamdb.json + appdetails + reviews.
// Compiled from existing in-memory/disk cache — never fetches fresh API data
// during index builds. Staged/capped enrichment happens via separate resolvers.
// Persisted to disk under app_data/store/discovery-index.json.
// ---------------------------------------------------------------------------

import type { SteamAppMetadata } from "../types/gameMetadata";
import type { SteamReviewSummary } from "../types/gameReview";
import type { StoreDiscoveryIndex, DiscoveryAppScore, DiscoveryAppEntry } from "./storeDiscoverCache";
import {
  DISCOVERY_INDEX_VERSION,
  DISCOVER_SCORING_VERSION,
  DISPLAY_GENRES,
  QG_TOP_PICK_MIN_REVIEWS,
  QG_TOP_PICK_MIN_SCORE,
  QG_TOP_PICK_MIN_PCT,
  QG_FEATURED_MIN_REVIEWS,
  QG_FEATURED_MIN_PCT,
  QG_GENRE_MIN_REVIEWS,
  QG_GENRE_MIN_SCORE,
  QG_GENRE_MIN_PCT,
  QG_TOP_RATED_MIN_REVIEWS,
  QG_TOP_RATED_MIN_SCORE,
  QG_TOP_RATED_MIN_PCT,
  QG_NEW_RELEASE_DAYS,
} from "./storeDiscoverCache";

// ── Cache ──

let _cachedIndex: StoreDiscoveryIndex | null = null;
let _loadPromise: Promise<StoreDiscoveryIndex | null> | null = null;
let _savePromise: Promise<void> | null = null;

export function getCachedDiscoveryIndex(): StoreDiscoveryIndex | null {
  return _cachedIndex;
}

export function setCachedDiscoveryIndex(index: StoreDiscoveryIndex): void {
  _cachedIndex = index;
}

export function invalidateDiscoveryIndex(): void {
  _cachedIndex = null;
}

/**
 * Load the discovery index from disk (app_data/store/discovery-index.json).
 * Validates version against DISCOVERY_INDEX_VERSION — stale indices are discarded.
 * Idempotent: subsequent calls return the cached result.
 */
export async function loadDiscoveryIndexFromDisk(): Promise<StoreDiscoveryIndex | null> {
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    try {
      const { readStoreDiscoveryIndex } = await import("./tauri");
      const raw = await readStoreDiscoveryIndex();
      if (!raw) {
        console.log(`[STORE][DISCOVERY_INDEX_LOAD] found=false`);
        return null;
      }

      const data = raw as StoreDiscoveryIndex;
      if (!data.version || data.version !== DISCOVERY_INDEX_VERSION) {
        console.log(`[STORE][DISCOVERY_INDEX_LOAD] found=true version=${data.version} expected=${DISCOVERY_INDEX_VERSION} reason=stale-version discarded`);
        return null;
      }

      if (!data.scores || Object.keys(data.scores).length === 0) {
        console.log(`[STORE][DISCOVERY_INDEX_LOAD] found=true version=${data.version} reason=empty-scores discarded`);
        return null;
      }

      _cachedIndex = data;
      console.log(`[STORE][DISCOVERY_INDEX_LOAD] found=true version=${data.version} topPicks=${data.sections.topPicks.length} featured=${data.sections.featured.length} scoredApps=${Object.keys(data.scores).length}`);
      return data;
    } catch (err) {
      console.log(`[STORE][DISCOVERY_INDEX_LOAD] found=false reason=error err=${String(err)}`);
      return null;
    }
  })();

  return _loadPromise;
}

/**
 * Save the current discovery index to disk (app_data/store/discovery-index.json).
 * Coalesces concurrent saves — only the last call's data is written.
 * Logs path and stats on success.
 */
export async function saveDiscoveryIndexToDisk(index: StoreDiscoveryIndex): Promise<void> {
  // Coalesce: if a save is already in flight, remember the latest index
  if (_savePromise) {
    const prev = _savePromise;
    _savePromise = (async () => {
      await prev;
      try {
        const { writeStoreDiscoveryIndex } = await import("./tauri");
        await writeStoreDiscoveryIndex(index as unknown);
        console.log(
          `[STORE][DISCOVERY_INDEX_SAVE] path=store/discovery-index.json ` +
          `version=${index.version} ` +
          `topPicks=${index.sections.topPicks.length} ` +
          `featured=${index.sections.featured.length} ` +
          `genreSections=${Object.keys(index.sections.genres).length} ` +
          `scoredApps=${Object.keys(index.scores).length}`
        );
        console.log(`[STORE][DISCOVERY_INDEX_WRITE_OK] path=store/discovery-index.json`);
      } catch (err) {
        console.log(`[STORE][DISCOVERY_INDEX_WRITE_ERROR] error=${String(err)}`);
      }
    })();
    return _savePromise;
  }

  _savePromise = (async () => {
    try {
      const { writeStoreDiscoveryIndex } = await import("./tauri");
      await writeStoreDiscoveryIndex(index as unknown);
      console.log(
        `[STORE][DISCOVERY_INDEX_SAVE] path=store/discovery-index.json ` +
        `version=${index.version} ` +
        `topPicks=${index.sections.topPicks.length} ` +
        `featured=${index.sections.featured.length} ` +
        `genreSections=${Object.keys(index.sections.genres).length} ` +
        `scoredApps=${Object.keys(index.scores).length}`
      );
      console.log(`[STORE][DISCOVERY_INDEX_WRITE_OK] path=store/discovery-index.json`);
    } catch (err) {
      console.log(`[STORE][DISCOVERY_INDEX_WRITE_ERROR] error=${String(err)}`);
    } finally {
      _savePromise = null;
    }
  })();

  await _savePromise;
}

// ── Quality gate helpers ──

function hasImage(meta: SteamAppMetadata | undefined): boolean {
  return !!(meta?.header_image || meta?.capsule_image_v5 || meta?.capsule_image);
}

function hasGoodReview(review: SteamReviewSummary | undefined, minReviews: number, minScore: number, minPct: number): boolean {
  return review?.resolved === true &&
    (review?.total_reviews ?? 0) >= minReviews &&
    (review?.review_score ?? 0) >= minScore &&
    (review?.positive_percent ?? 0) >= minPct;
}

function parseReleaseDateTS(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(trimmed + "T00:00:00Z").getTime();
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return parsed;
  return 0;
}

// ── Scoring ──

function computeScore(
  meta: SteamAppMetadata | undefined,
  review: SteamReviewSummary | undefined,
  genreConfidence: Record<string, number> | undefined,
  interactionScore: number,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  // 1. Genre match score (0-3): based on genre confidence from user interactions
  let genreMatchScore = 0;
  const genreMatches: string[] = [];
  if (meta?.genres && genreConfidence) {
    for (const genre of meta.genres) {
      const confidence = genreConfidence[genre] ?? 0;
      if (confidence > 0) {
        genreMatchScore += Math.min(confidence, 1);
        genreMatches.push(genre);
      }
    }
    genreMatchScore = Math.min(genreMatchScore, 3);
  }
  if (genreMatchScore > 0) {
    reasons.push(`genre=${genreMatchScore.toFixed(1)}`);
  }

  // 2. Review quality score (0-5): normalized review_score * confidence
  let reviewQualityScore = 0;
  if (review?.resolved === true && (review?.total_reviews ?? 0) > 0) {
    const pct = review.positive_percent ?? 50;
    reviewQualityScore = (review.review_score / 9) * 5 * (pct / 100);
    reviewQualityScore = Math.min(reviewQualityScore, 5);
    reasons.push(`review=${reviewQualityScore.toFixed(1)}`);
  }

  // 3. Review count score (0-3): log10-based popularity proxy
  let reviewCountScore = 0;
  const total = review?.total_reviews ?? 0;
  if (total > 0) {
    reviewCountScore = Math.min(Math.log10(total) / 2, 3);
    reasons.push(`count=${reviewCountScore.toFixed(1)}`);
  }

  // 4. Metadata completeness (0-2): image + genres + developer
  let metaScore = 0;
  if (hasImage(meta)) { metaScore += 1; }
  if (meta?.genres && meta.genres.length > 0) { metaScore += 0.5; }
  if (meta?.developer) { metaScore += 0.5; }
  metaScore = Math.min(metaScore, 2);
  if (metaScore > 0) {
    reasons.push(`meta=${metaScore.toFixed(1)}`);
  }

  // 5. Release recency (0-2): bonus for games released within 90 days
  let recencyScore = 0;
  if (meta?.release_date) {
    const releaseTs = parseReleaseDateTS(meta.release_date);
    if (releaseTs > 0) {
      const ageDays = (Date.now() - releaseTs) / (1000 * 60 * 60 * 24);
      if (ageDays >= 0 && ageDays <= QG_NEW_RELEASE_DAYS) {
        recencyScore = 2 * (1 - ageDays / QG_NEW_RELEASE_DAYS);
        reasons.push(`new=${recencyScore.toFixed(1)}`);
      }
    }
  }

  // 6. Interaction score (0-1): user engagement bonus
  const interactionBonus = Math.min(interactionScore / 5, 1) * 0.5;
  if (interactionBonus > 0) {
    reasons.push(`interact=${interactionBonus.toFixed(1)}`);
  }

  const finalScore = genreMatchScore + reviewQualityScore + reviewCountScore + metaScore + recencyScore + interactionBonus;

  return { score: finalScore, reasons };
}

// ── Compile ──

const DEFAULT_MAX_CANDIDATES = 500;

/**
 * Compile a discovery index from currently available data.
 * Pure function — no async I/O, no network calls.
 * Uses whatever metadata + reviews are already cached in memory.
 *
 * @param pool — top discovery candidates from highQualityPool (sorted by score desc)
 * @param metadataByAppId — currently cached SteamAppMetadata records
 * @param reviewsByAppId — currently cached SteamReviewSummary records
 * @param genreConfidence — genre confidence scores from user interactions
 * @param interactionScoreByAppId — per-app user interaction scores
 * @param catalogSize — total catalog size for stats
 * @param maxCandidates — max candidates to include (default 500)
 */
export function compileDiscoveryIndex(
  pool: { appId: string; title: string; score: number }[],
  metadataByAppId: Record<number, SteamAppMetadata>,
  reviewsByAppId: Record<number, SteamReviewSummary>,
  genreConfidence: Record<string, number> | undefined,
  interactionScoreByAppId: Record<string, number> | undefined,
  catalogSize: number,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
): StoreDiscoveryIndex {
  const t0 = performance.now();

  const candidates = pool.slice(0, maxCandidates);
  const scores: Record<string, DiscoveryAppScore> = {};
  const entries: DiscoveryAppEntry[] = [];
  let enrichedApps = 0;
  let withGenres = 0;
  let withReviews = 0;
  let withImages = 0;
  let withReleaseDate = 0;

  for (const candidate of candidates) {
    const appIdNum = Number(candidate.appId);
    const meta = metadataByAppId[appIdNum];
    const review = reviewsByAppId[appIdNum];
    const interaction = interactionScoreByAppId?.[candidate.appId] ?? 0;

    const hasEnoughData = meta?.resolved === true || review?.resolved === true;
    if (hasEnoughData) enrichedApps++;

    const genres = meta?.genres ?? [];
    if (genres.length > 0) withGenres++;
    if (review?.resolved === true && (review.total_reviews ?? 0) > 0) withReviews++;
    if (hasImage(meta)) withImages++;
    if (meta?.release_date) withReleaseDate++;

    const { score, reasons } = computeScore(
      meta, review, genreConfidence, interaction,
    );

    const reviewScore = review?.resolved === true ? review.review_score : 0;
    const reviewCount = review?.total_reviews ?? 0;
    const positivePct = review?.positive_percent ?? null;
    const popularityProxy = reviewCount > 0
      ? Math.min(Math.log10(reviewCount) / 3, 1) * ((positivePct ?? 50) / 100)
      : 0;

    const metaCompletenessScore = (hasImage(meta) ? 0.5 : 0) +
      (genres.length > 0 ? 0.3 : 0) +
      (meta?.developer ? 0.2 : 0);

    scores[candidate.appId] = {
      final: score,
      reviewScore,
      reviewCount,
      positivePct,
      popularityProxy,
      metadataCompleteness: metaCompletenessScore,
      genreMatches: genres,
      reasons,
    };

    if (hasEnoughData) {
      entries.push({
        appid: candidate.appId,
        name: candidate.title,
        genres: genres.length > 0 ? genres : undefined,
        releaseDate: meta?.release_date || undefined,
        images: {
          header: meta?.header_image || undefined,
          capsule: meta?.capsule_image_v5 || meta?.capsule_image || undefined,
        },
        reviews: review?.resolved === true ? {
          resolved: true,
          total: reviewCount,
          score: reviewScore,
          label: review.review_score_desc,
          positivePct,
        } : undefined,
        updatedAt: Date.now(),
      });
    }
  }

  // ── Build quality-gated sections ──
  const topPicks: string[] = [];
  const featured: string[] = [];
  const genresIndex: Record<string, string[]> = {};

  for (const g of DISPLAY_GENRES) {
    genresIndex[g] = [];
  }

  // Sort candidates by final score for section building
  const sortedByScore = candidates
    .map((c) => ({ appId: c.appId, score: scores[c.appId]?.final ?? 0 }))
    .sort((a, b) => b.score - a.score);

  const topAppIds = sortedByScore.map((s) => s.appId);

  // Top Picks: quality-gated — require image + reviews + threshold
  const topPicksCandidates: string[] = [];
  for (const appId of topAppIds) {
    const appIdNum = Number(appId);
    const meta = metadataByAppId[appIdNum];
    const review = reviewsByAppId[appIdNum];
    if (!hasImage(meta)) continue;
    if (!hasGoodReview(review, QG_TOP_PICK_MIN_REVIEWS, QG_TOP_PICK_MIN_SCORE, QG_TOP_PICK_MIN_PCT)) continue;
    topPicksCandidates.push(appId);
    if (topPicksCandidates.length >= 20) break;
  }
  topPicks.push(...topPicksCandidates);

  // Featured: quality-gated — require image + review threshold (lower than Top Picks)
  const featuredCandidates: string[] = [];
  for (const appId of topAppIds) {
    const appIdNum = Number(appId);
    const meta = metadataByAppId[appIdNum];
    const review = reviewsByAppId[appIdNum];
    if (!hasImage(meta)) continue;
    if (!hasGoodReview(review, QG_FEATURED_MIN_REVIEWS, 0, QG_FEATURED_MIN_PCT)) continue;
    featuredCandidates.push(appId);
    if (featuredCandidates.length >= 20) break;
  }
  featured.push(...featuredCandidates);

  // Genre sections: quality-gated per genre
  for (const appId of topAppIds) {
    const appIdNum = Number(appId);
    const meta = metadataByAppId[appIdNum];
    const review = reviewsByAppId[appIdNum];
    if (!meta?.genres || meta.genres.length === 0) continue;
    if (!hasImage(meta)) continue;
    if (!hasGoodReview(review, QG_GENRE_MIN_REVIEWS, QG_GENRE_MIN_SCORE, QG_GENRE_MIN_PCT)) continue;

    for (const rawGenre of meta.genres) {
      const normalized = normalizeGenreName(rawGenre);
      if (!normalized || !genresIndex[normalized]) continue;
      const list = genresIndex[normalized];
      if (list.length < 20 && !list.includes(appId)) {
        list.push(appId);
      }
    }
  }

  // For You: genre-personalized, excludes installed games
  // (computed per-render with installed filter, index provides scores only)

  const compiled: StoreDiscoveryIndex = {
    version: DISCOVERY_INDEX_VERSION,
    builtAt: Date.now(),
    source: `steamdb.json + steam-appdetails + reviews (scoring v${DISCOVER_SCORING_VERSION})`,
    catalogSize,
    maxCandidates,
    stats: {
      enrichedApps,
      withGenres,
      withReviews,
      withImages,
      withReleaseDate,
    },
    sections: {
      topPicks,
      featured,
      forYou: [],
      genres: genresIndex,
    },
    scores,
  };

  const elapsedMs = (performance.now() - t0).toFixed(1);

  // Detect partial index: no reviews means we can't apply quality gates
  const isPartial = withReviews === 0;
  const reasons: string[] = [];
  if (withReviews === 0) reasons.push("waiting-for-reviews");
  if (withImages === 0) reasons.push("no-images");
  if (enrichedApps === 0) reasons.push("no-enriched-data");

  if (isPartial) {
    console.log(
      `[STORE][DISCOVERY_INDEX_BUILD] version=${DISCOVERY_INDEX_VERSION} ` +
      `candidates=${candidates.length} enriched=${enrichedApps} ` +
      `genres=${withGenres} reviews=${withReviews} images=${withImages} ` +
      `releaseDate=${withReleaseDate} topPicks=0 ` +
      `featured=0 genreSections=0 ` +
      `complete=false reason=${reasons.join(",")} ` +
      `elapsedMs=${elapsedMs}`
    );
    console.log(`[STORE][DISCOVERY_PARTIAL] reason=${reasons.join(",")}`);
  } else {
    console.log(
      `[STORE][DISCOVERY_INDEX_BUILD] version=${DISCOVERY_INDEX_VERSION} ` +
      `candidates=${candidates.length} enriched=${enrichedApps} ` +
      `genres=${withGenres} reviews=${withReviews} images=${withImages} ` +
      `releaseDate=${withReleaseDate} topPicks=${topPicks.length} ` +
      `featured=${featured.length} genreSections=${Object.values(genresIndex).filter((g) => g.length > 0).length} ` +
      `complete=true ` +
      `elapsedMs=${elapsedMs}`
    );
  }

  return compiled;
}

// ── Queries ──

/**
 * Query Top Picks from the discovery index.
 * Returns appIds that passed quality gates (image + reviews + score/threshold).
 */
export function queryIndexTopPicks(
  index: StoreDiscoveryIndex,
  limit = 20,
): string[] {
  return index.sections.topPicks.slice(0, limit);
}

/**
 * Query Featured section from the discovery index.
 * Returns appIds with image + moderate review thresholds.
 */
export function queryIndexFeatured(
  index: StoreDiscoveryIndex,
  limit = 20,
): string[] {
  return index.sections.featured.slice(0, limit);
}

/**
 * Query a genre rail from the discovery index.
 * Returns appIds matching the genre that passed quality gates.
 */
export function queryIndexGenre(
  index: StoreDiscoveryIndex,
  genre: string,
  limit = 20,
): string[] {
  const list = index.sections.genres[genre];
  if (!list) return [];
  return list.slice(0, limit);
}

/**
 * Query For You section — genre-personalized, excludes installed.
 * Index stores scores; caller provides installed filter + limit.
 */
export function queryIndexForYou(
  index: StoreDiscoveryIndex,
  preferredGenres: Set<string>,
  excludeAppIds: Set<string> | undefined,
  limit = 20,
): string[] {
  const scored: { appId: string; score: number }[] = [];
  for (const [appId, score] of Object.entries(index.scores)) {
    if (excludeAppIds?.has(appId)) continue;
    const genreMatch = score.genreMatches.filter((g) => preferredGenres.has(g)).length;
    const personalScore = score.final + genreMatch * 2;
    if (personalScore > 0) {
      scored.push({ appId, score: personalScore });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.appId);
}

/**
 * Check if an app qualifies for "Top Rated" badge.
 */
export function qualifiesTopRated(
  index: StoreDiscoveryIndex,
  appId: string,
): boolean {
  const score = index.scores[appId];
  if (!score) return false;
  return score.reviewCount >= QG_TOP_RATED_MIN_REVIEWS &&
    (score.reviewScore >= QG_TOP_RATED_MIN_SCORE || (score.positivePct ?? 0) >= QG_TOP_RATED_MIN_PCT);
}

/**
 * Check if an app qualifies for "New" badge based on release date.
 */
export function qualifiesNew(
  meta: SteamAppMetadata | undefined,
): boolean {
  if (!meta?.release_date) return false;
  const releaseTs = parseReleaseDateTS(meta.release_date);
  if (releaseTs <= 0) return false;
  const ageDays = (Date.now() - releaseTs) / (1000 * 60 * 60 * 24);
  return ageDays >= 0 && ageDays <= QG_NEW_RELEASE_DAYS;
}

/**
 * More Like This: find related games using index scores + metadata overlap.
 * Same developer = strong boost, same publisher = medium, shared genres = boost,
 * review quality/popularity = boost. No relation = excluded.
 */
export function queryIndexMoreLikeThis(
  index: StoreDiscoveryIndex,
  appId: string,
  metadataByAppId: Record<number, SteamAppMetadata>,
  reviewsByAppId: Record<number, SteamReviewSummary>,
  limit = 12,
): string[] {
  const meta = metadataByAppId[Number(appId)];
  if (!meta) return [];

  const selectedDeveloper = meta.developer?.toLowerCase() ?? "";
  const selectedPublishers = meta.publishers ?? [];
  const selectedGenres = meta.genres ?? [];

  // If no genres, can't find related games meaningfully
  if (selectedGenres.length === 0 && !selectedDeveloper) return [];

  const scored: { appId: string; score: number; reasons: string[] }[] = [];

  for (const [candidateId, appScore] of Object.entries(index.scores)) {
    if (candidateId === appId) continue;

    const candidateMeta = metadataByAppId[Number(candidateId)];
    const candidateReview = reviewsByAppId[Number(candidateId)];
    let score = 0;
    const reasons: string[] = [];

    // Same developer: strong boost
    if (selectedDeveloper && candidateMeta?.developer?.toLowerCase() === selectedDeveloper) {
      score += 4;
      reasons.push("same-dev");
    }

    // Same publisher: medium boost
    if (candidateMeta?.publishers) {
      for (const pub of candidateMeta.publishers) {
        if (selectedPublishers.some((sp) => sp.toLowerCase() === pub.toLowerCase())) {
          score += 2;
          reasons.push("same-pub");
          break;
        }
      }
    }

    // Shared genres: boost per shared genre
    if (candidateMeta?.genres) {
      const shared = candidateMeta.genres.filter((g) =>
        selectedGenres.some((sg) => sg.toLowerCase() === g.toLowerCase()),
      ).length;
      if (shared > 0) {
        score += shared;
        reasons.push(`genres=${shared}`);
      }
    }

    // No relation: exclude
    if (score === 0) continue;

    // Review quality/popularity bonus
    if (candidateReview?.resolved === true && (candidateReview.total_reviews ?? 0) > 0) {
      const reviewCountFactor = Math.min(1, (candidateReview.total_reviews ?? 0) / 50000);
      const positivePctFactor = (candidateReview.positive_percent ?? 50) / 100;
      score += (reviewCountFactor * 0.5 + positivePctFactor * 0.5) * 3;
      reasons.push("review");
    }

    // Index score bonus
    if (appScore.final > 0) {
      score += appScore.final * 0.5;
      reasons.push("score");
    }

    // Image bonus
    if (hasImage(candidateMeta)) {
      score += 0.5;
      reasons.push("image");
    }

    scored.push({ appId: candidateId, score, reasons });
  }

  if (scored.length === 0) return [];

  scored.sort((a, b) => b.score - a.score);

  const topCount = Math.min(scored.length, limit);
  const top = scored.slice(0, topCount);

  console.log(
    `[STORE][MORE_LIKE_INDEX] target=${appId} ` +
    `candidates=${scored.length} kept=${topCount} ` +
    `topScore=${top[0]?.score.toFixed(1)} ` +
    `appids=${JSON.stringify(top.map((s) => s.appId))}`
  );

  return top.map((s) => s.appId);
}

// ── Genre normalization ──

/**
 * Normalize a raw Steam genre string to a display genre.
 * Maps variations like "First-Person Shooter" → "Shooter".
 */
export function normalizeGenreName(raw: string): string | null {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9+\-_\s]/g, "")
    .replace(/[-/]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  const known = new Map<string, string>([
    ["action", "Action"],
    ["indie", "Indie"],
    ["racing", "Racing"],
    ["race", "Racing"],
    ["shooter", "Shooter"],
    ["fps", "Shooter"],
    ["first person", "Shooter"],
    ["first-person", "Shooter"],
    ["rpg", "RPG"],
    ["role playing", "RPG"],
    ["role-playing", "RPG"],
    ["adventure", "Adventure"],
    ["strategy", "Strategy"],
    ["sports", "Sports"],
    ["simulation", "Simulation"],
    ["sim", "Simulation"],
    ["casual", "Casual"],
    ["massively multiplayer", "Massively Multiplayer"],
    ["mmo", "Massively Multiplayer"],
    ["mmorpg", "Massively Multiplayer"],
    ["free to play", "Free to Play"],
    ["early access", "Early Access"],
    ["vr", "VR"],
    ["virtual reality", "VR"],
  ]);

  if (known.has(cleaned)) return known.get(cleaned)!;

  // Prefix match: "Action-Adventure" → "Action"
  for (const [key, label] of known) {
    if (cleaned.startsWith(key)) return label;
  }

  // Suffix match: "Side-Scrolling Shooter" → "Shooter"
  for (const [key, label] of known) {
    if (cleaned.endsWith(key)) return label;
  }

  // Fuzzy token match
  const tokens = cleaned.split(/\s+/);
  const matched = tokens.filter((t) => known.has(t));
  if (matched.length > 0) {
    return known.get(matched[0])!;
  }

  return null;
}

// ── Validation ──

/**
 * Log validation diagnostics for the discovery index.
 * Reports section sizes, enrichment stats, and quality gate coverage.
 */
export function logDiscoveryIndexValidation(index: StoreDiscoveryIndex): void {
  const genreSections = Object.entries(index.sections.genres)
    .filter(([, ids]) => ids.length > 0)
    .map(([g, ids]) => `${g}=${ids.length}`)
    .join(" ");

  console.log(
    `[STORE][DISCOVERY_INDEX_VALIDATE] ` +
    `version=${index.version} builtAt=${new Date(index.builtAt).toISOString()} ` +
    `catalogSize=${index.catalogSize} maxCandidates=${index.maxCandidates} ` +
    `enriched=${index.stats.enrichedApps} ` +
    `topPicks=${index.sections.topPicks.length} ` +
    `featured=${index.sections.featured.length} ` +
    `genreSections=[${genreSections}] ` +
    `scoredApps=${Object.keys(index.scores).length}`
  );

  // Log top 5 scores for diagnostics
  const topScores = Object.entries(index.scores)
    .sort(([, a], [, b]) => b.final - a.final)
    .slice(0, 5);
  for (const [appId, s] of topScores) {
    console.log(
      `[STORE][DISCOVERY_INDEX_SCORE] appid=${appId} ` +
      `final=${s.final.toFixed(2)} review=${s.reviewScore.toFixed(1)} ` +
      `count=${s.reviewCount} pct=${s.positivePct} ` +
      `meta=${s.metadataCompleteness.toFixed(2)} ` +
      `genres=${s.genreMatches.join(",")} ` +
      `reasons=${s.reasons.join(",")}`
    );
  }
}

/**
 * Log steamdb.json schema validation.
 */
export function logSteamDbSchema(data: unknown[]): void {
  if (data.length === 0) return;
  const sample = data[0] as Record<string, unknown>;
  const keys = Object.keys(sample);
  const hasOnlyAppIdAndName = keys.length === 2 && "appid" in sample && "name" in sample;
  console.log(
    `[STORE][STEAMDB_SCHEMA] entries=${data.length} keys=${JSON.stringify(keys)} ` +
    `expectedSchema={appid,name} match=${hasOnlyAppIdAndName} ` +
    `sample=${JSON.stringify(sample)}`
  );
}
