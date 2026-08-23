#!/usr/bin/env node
/**
 * Offline Steam Catalog Builder
 *
 * Reads steamdb.json → fetches lightweight Store details → generates
 * versioned catalog artifact with checkpoint/resume support.
 *
 * Usage:
 *   npx tsx build.ts [--resume] [--concurrency=5] [--delay=250] [--limit=5000]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { normalizeGenreName, type CanonicalGenre } from "./taxonomy";
import type {
  SteamCatalogRecord,
  SteamCatalogArtifact,
  SteamCatalogManifest,
  BuilderCheckpoint,
} from "./catalogSchema";
import { CATALOG_SCHEMA_VERSION, CATALOG_VERSION } from "./catalogSchema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..", "..");

// ── CLI Args ──
const args = process.argv.slice(2);
const RESUME = args.includes("--resume");
const concurrency = Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] || 5);
const delayMs = Number(args.find((a) => a.startsWith("--delay="))?.split("=")[1] || 250);
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || 5000);
const inputArg = args.find((a) => a.startsWith("--input="))?.split("=")[1];
const outputArg = args.find((a) => a.startsWith("--output="))?.split("=")[1];
const checkpointArg = args.find((a) => a.startsWith("--checkpoint="))?.split("=")[1];

const CHECKPOINT_PATH = checkpointArg || join(__dirname, "checkpoint.json");
const OUTPUT_DIR = outputArg || join(__dirname, "output");
const ARTIFACT_PATH = join(OUTPUT_DIR, `steam-catalog-v${CATALOG_VERSION}.json`);
const COMPRESSED_PATH = join(OUTPUT_DIR, `steam-catalog-v${CATALOG_VERSION}.json.gz`);
const MANIFEST_PATH = join(OUTPUT_DIR, `steam-catalog-v${CATALOG_VERSION}.manifest.json`);

// ── Types ──

interface SteamDbEntry {
  appid: number;
  name: string;
}

interface SteamAppDetailsResponse {
  success: boolean;
  data?: {
    type?: string;
    name?: string;
    genres?: Array<{ id: string; description: string }>;
    categories?: Array<{ id: number; description: string }>;
    release_date?: { coming_soon: boolean; date: string };
    is_free?: boolean;
    short_description?: string;
    header_image?: string;
    capsule_image?: string;
    developers?: string[];
    publishers?: string[];
    recommendations?: { total: number };
    reviews?: Array<{ total: number; positive: number }>;
  };
}

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function parseReviewScore(resp: SteamAppDetailsResponse): {
  reviewPercent: number;
  reviewCount: number;
} {
  if (!resp.data) return { reviewPercent: 0, reviewCount: 0 };

  // Steam appdetails returns `recommendations.total` for total reviews
  const total = resp.data.recommendations?.total ?? 0;
  if (total === 0) return { reviewPercent: 0, reviewCount: 0 };

  // Reviews array has positive/negative breakdown
  const reviews = resp.data.reviews;
  if (reviews && reviews.length > 0) {
    const positive = reviews[0].positive ?? 0;
    const totalReviews = reviews[0].total ?? total;
    const percent = totalReviews > 0 ? Math.round((positive / totalReviews) * 100) : 0;
    return { reviewPercent: percent, reviewCount: totalReviews };
  }

  return { reviewPercent: 0, reviewCount: total };
}

function parseDate(dateStr: string | undefined | null): number {
  if (!dateStr || dateStr === "" || dateStr.toLowerCase() === "coming soon" || dateStr.toLowerCase() === "tbd") {
    return 0;
  }
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? 0 : Math.floor(d.getTime() / 1000);
  } catch {
    return 0;
  }
}

function mapType(rawType: string | undefined): SteamCatalogRecord["type"] {
  switch (rawType?.toLowerCase()) {
    case "game": return "game";
    case "dlc": return "dlc";
    case "demo": return "demo";
    case "application": return "application";
    default: return "unknown";
  }
}

// ── Steam API fetch ──

let _fetchCount = 0;

async function fetchSteamAppDetails(appId: number): Promise<SteamAppDetailsResponse> {
  _fetchCount++;
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=english`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (resp.status === 429) {
      // Rate limited — wait and retry once
      await sleep(5000);
      const retry = await fetch(url);
      return retry.json() as Promise<SteamAppDetailsResponse>;
    }

    return resp.json() as Promise<SteamAppDetailsResponse>;
  } catch (err) {
    return { success: false };
  }
}

// ── Record builder ──

function buildRecord(entry: SteamDbEntry, details: SteamAppDetailsResponse): SteamCatalogRecord | null {
  if (!details.success || !details.data) return null;

  const d = details.data;

  // Filter: only games and demos get full records; DLC/apps get minimal
  const type = mapType(d.type);
  if (type === "unknown") return null;

  // Normalize genres
  const rawGenres = (d.genres ?? []).map((g) => g.description);
  const canonical: CanonicalGenre[] = [];
  const originalGenres: string[] = [];
  const seen = new Set<CanonicalGenre>();

  for (const raw of rawGenres) {
    const c = normalizeGenreName(raw);
    if (c && !seen.has(c)) {
      seen.add(c);
      canonical.push(c);
    }
    if (raw.trim() && !originalGenres.includes(raw.trim())) {
      originalGenres.push(raw.trim());
    }
  }

  // Categories
  const categories = (d.categories ?? []).map((c) => c.description);
  const categoryIds = (d.categories ?? []).map((c) => c.id);

  // Release date
  const releaseDate = d.release_date;
  const releaseTimestamp = parseDate(releaseDate?.date);
  const comingSoon = releaseDate?.coming_soon ?? false;

  // Reviews
  const { reviewPercent, reviewCount } = parseReviewScore(details);

  // Images
  const headerImage = d.header_image ?? "";
  const capsuleImage = d.capsule_image ?? "";

  // Developers / publishers
  const developers = d.developers ?? [];
  const publishers = d.publishers ?? [];

  return {
    appId: entry.appid,
    name: entry.name || d.name || "",
    type,
    genres: canonical,
    originalGenres,
    categories,
    categoryIds,
    releaseTimestamp,
    comingSoon,
    isFree: d.is_free ?? false,
    reviewPercent,
    reviewCount,
    headerImage,
    capsuleImage,
    developers,
    publishers,
    lastEnrichedAt: Math.floor(Date.now() / 1000),
  };
}

// ── Checkpoint ──

function saveCheckpoint(checkpoint: BuilderCheckpoint): void {
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint), "utf-8");
}

function loadCheckpoint(): BuilderCheckpoint | null {
  if (!existsSync(CHECKPOINT_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CHECKPOINT_PATH, "utf-8")) as BuilderCheckpoint;
  } catch {
    return null;
  }
}

function clearCheckpoint(): void {
  if (existsSync(CHECKPOINT_PATH)) {
    // Rename to backup
    const backupPath = CHECKPOINT_PATH + `.bak.${Date.now()}`;
    renameSync(CHECKPOINT_PATH, backupPath);
  }
}

// ── Main builder ──

async function build(): Promise<void> {
  const startTime = Date.now();
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║     Steam Catalog Builder v${CATALOG_VERSION}                    ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);

  // 1. Load steamdb.json
  const steamdbPath = inputArg || join(ROOT, "public", "data", "steamdb.json");
  if (!existsSync(steamdbPath)) {
    console.error(`ERROR: ${steamdbPath} not found`);
    process.exit(1);
  }

  console.log(`Loading steamdb.json...`);
  const allEntries: SteamDbEntry[] = JSON.parse(readFileSync(steamdbPath, "utf-8"));
  console.log(`  ${allEntries.length.toLocaleString()} entries loaded`);

  // Filter to games only (skip tools, servers, etc.)
  // We'll filter by type after fetching, but pre-filter by name heuristic
  const entries = allEntries.slice(0, limit);
  console.log(`  Processing ${entries.length.toLocaleString()} entries (limit: ${limit})`);

  // 2. Load or create checkpoint
  let checkpoint: BuilderCheckpoint;
  if (RESUME) {
    const existing = loadCheckpoint();
    if (existing) {
      checkpoint = existing;
      console.log(`\nResuming from checkpoint (${checkpoint.processedAppIds.length.toLocaleString()} processed, ${checkpoint.retryableFailures.length} retries)`);
    } else {
      console.log(`No checkpoint found — starting fresh`);
      checkpoint = createFreshCheckpoint(entries.length);
    }
  } else {
    checkpoint = createFreshCheckpoint(entries.length);
  }

  // Build processed set for O(1) lookup
  const processedSet = new Set(checkpoint.processedAppIds);
  const failedSet = new Set(checkpoint.retryableFailures);
  const unsupportedSet = new Set(checkpoint.unsupportedRecords);
  const pending = entries.filter(
    (e) => !processedSet.has(e.appid) && !unsupportedSet.has(e.appid),
  );

  console.log(`\nPending: ${pending.length.toLocaleString()} entries`);
  console.log(`Concurrency: ${concurrency}, Delay: ${delayMs}ms\n`);

  // 3. Process in batches
  let batchNum = 0;
  let checkpointSaved = 0;

  for (let i = 0; i < pending.length; i += concurrency) {
    batchNum++;
    const batch = pending.slice(i, i + concurrency);

    const promises = batch.map(async (entry) => {
      try {
        const details = await fetchSteamAppDetails(entry.appid);

        if (!details.success) {
          // Could be rate-limited, unsupported, or genuinely missing
          // Steam returns success:false for apps without store pages
          if (!_fetchCount || _fetchCount < 10) {
            // Early errors might be transient
            checkpoint.retryableFailures.push(entry.appid);
          }
          checkpoint.processedAppIds.push(entry.appid);
          checkpoint.validEmptyCount++;
          return;
        }

        const record = buildRecord(entry, details);
        if (record) {
          checkpoint.successfulRecords.push(record);
          checkpoint.processedAppIds.push(entry.appid);
        } else {
          // Unsupported record type or unparseable
          checkpoint.unsupportedRecords.push(entry.appid);
          checkpoint.processedAppIds.push(entry.appid);
        }
      } catch (err) {
        checkpoint.retryableFailures.push(entry.appid);
        checkpoint.processedAppIds.push(entry.appid);
      }
    });

    await Promise.all(promises);

    // Progress logging every 100 batches
    const totalProcessed = checkpoint.processedAppIds.length;
    if (batchNum % 100 === 0 || i + concurrency >= pending.length) {
      const pct = ((totalProcessed / entries.length) * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = totalProcessed / (Date.now() - startTime) * 1000;
      console.log(
        `  [${elapsed}s] ${totalProcessed.toLocaleString()}/${entries.length.toLocaleString()} (${pct}%) ` +
        `games=${checkpoint.successfulRecords.length.toLocaleString()} ` +
        `empty=${checkpoint.validEmptyCount} ` +
        `unsupported=${checkpoint.unsupportedRecords.length} ` +
        `retries=${checkpoint.retryableFailures.length} ` +
        `rate=${rate.toFixed(1)}/s`,
      );
    }

    // Save checkpoint every 50 batches
    if (batchNum % 50 === 0) {
      checkpoint.lastCheckpointTime = new Date().toISOString();
      checkpoint.requestCount = _fetchCount;
      saveCheckpoint(checkpoint);
      checkpointSaved++;
    }

    // Delay between batches
    if (i + concurrency < pending.length) {
      await sleep(delayMs);
    }
  }

  // 4. Retry failures once
  if (checkpoint.retryableFailures.length > 0) {
    console.log(`\nRetrying ${checkpoint.retryableFailures.length} failed entries...`);
    const retryIds = [...checkpoint.retryableFailures];
    checkpoint.retryableFailures = [];
    const retryEntries = retryIds.map((id) => entries.find((e) => e.appid === id)).filter(Boolean) as SteamDbEntry[];

    for (let i = 0; i < retryEntries.length; i += concurrency) {
      const batch = retryEntries.slice(i, i + concurrency);
      const promises = batch.map(async (entry) => {
        try {
          const details = await fetchSteamAppDetails(entry.appid);
          if (details.success) {
            const record = buildRecord(entry, details);
            if (record) {
              checkpoint.successfulRecords.push(record);
            } else {
              checkpoint.unsupportedRecords.push(entry.appid);
            }
          } else {
            checkpoint.retryableFailures.push(entry.appid);
          }
        } catch {
          checkpoint.retryableFailures.push(entry.appid);
        }
      });
      await Promise.all(promises);
      await sleep(delayMs * 2);
    }

    console.log(`  Retries: ${checkpoint.retryableFailures.length} still failed`);
  }

  // 5. Generate artifact
  console.log(`\nGenerating catalog artifact...`);

  const records = checkpoint.successfulRecords;

  // Compute stats
  const gameCount = records.filter((r) => r.type === "game").length;
  const genreCount = records.filter((r) => r.genres.length > 0).length;
  const imageCount = records.filter((r) => r.headerImage !== "" || r.capsuleImage !== "").length;
  const releaseCount = records.filter((r) => r.releaseTimestamp > 0).length;
  const reviewCount = records.filter((r) => r.reviewCount > 0).length;
  const allGenres = [...new Set(records.flatMap((r) => r.genres))].sort();

  const artifact: SteamCatalogArtifact = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    catalogVersion: CATALOG_VERSION,
    generatedAt: new Date().toISOString(),
    records,
  };

  // Write artifact
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  // Write to temp first, then rename
  const tmpPath = ARTIFACT_PATH + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(artifact), "utf-8");
  renameSync(tmpPath, ARTIFACT_PATH);

  const artifactJson = readFileSync(ARTIFACT_PATH, "utf-8");
  const checksum = sha256(artifactJson);
  const uncompressedSize = Buffer.byteLength(artifactJson);

  // Write compressed if possible (using built-in zlib)
  let compressedSize = 0;
  try {
    const { gzipSync } = await import("node:zlib");
    const compressed = gzipSync(Buffer.from(artifactJson));
    compressedSize = compressed.length;
    const tmpCompressed = COMPRESSED_PATH + ".tmp";
    writeFileSync(tmpCompressed, compressed);
    renameSync(tmpCompressed, COMPRESSED_PATH);
  } catch {
    // No gzip — not critical
  }

  // 6. Write manifest
  const manifest: SteamCatalogManifest = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    catalogVersion: CATALOG_VERSION,
    generatedAt: new Date().toISOString(),
    recordCount: records.length,
    sourceRecordCount: entries.length,
    gameCount,
    genreCoverageCount: genreCount,
    imageCoverageCount: imageCount,
    releaseDateCoverageCount: releaseCount,
    reviewCoverageCount: reviewCount,
    genres: allGenres,
    checksum,
    artifactFile: `steam-catalog-v${CATALOG_VERSION}.json`,
    compressedFile: compressedSize > 0 ? `steam-catalog-v${CATALOG_VERSION}.json.gz` : undefined,
  };

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");

  // 7. Report
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║                  BUILD COMPLETE                 ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);
  console.log(`  Time:               ${elapsed}s`);
  console.log(`  Total records:      ${records.length.toLocaleString()}`);
  console.log(`  Game records:       ${gameCount.toLocaleString()}`);
  console.log(`  Genre coverage:     ${((genreCount / records.length) * 100).toFixed(1)}% (${genreCount.toLocaleString()})`);
  console.log(`  Image coverage:     ${((imageCount / records.length) * 100).toFixed(1)}% (${imageCount.toLocaleString()})`);
  console.log(`  Release coverage:   ${((releaseCount / records.length) * 100).toFixed(1)}% (${releaseCount.toLocaleString()})`);
  console.log(`  Review coverage:    ${((reviewCount / records.length) * 100).toFixed(1)}% (${reviewCount.toLocaleString()})`);
  console.log(`  Unsupported:        ${checkpoint.unsupportedRecords.length}`);
  console.log(`  Retry failures:     ${checkpoint.retryableFailures.length}`);
  console.log(`  Uncompressed size:  ${(uncompressedSize / 1024 / 1024).toFixed(2)} MB`);
  if (compressedSize > 0) {
    console.log(`  Compressed size:    ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
  }
  console.log(`  Checksum:           ${checksum.substring(0, 16)}...`);
  console.log(`  Genres:             ${allGenres.join(", ")}`);
  console.log(`  Artifact:           ${ARTIFACT_PATH}`);
  console.log(`  Manifest:           ${MANIFEST_PATH}`);
  console.log(`\n  Checkpoint saved ${checkpointSaved} times during build.`);

  // 8. Clear checkpoint on success
  clearCheckpoint();
  console.log(`  Checkpoint cleared.\n`);
}

function createFreshCheckpoint(sourceCount: number): BuilderCheckpoint {
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    catalogVersion: CATALOG_VERSION,
    sourceAppCount: sourceCount,
    processedAppIds: [],
    pendingAppIds: [],
    successfulRecords: [],
    validEmptyCount: 0,
    retryableFailures: [],
    unsupportedRecords: [],
    requestCount: 0,
    retryCount: 0,
    lastCheckpointTime: new Date().toISOString(),
  };
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
