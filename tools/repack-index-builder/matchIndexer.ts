/**
 * Repack Title Matcher — parses steamrip.json + fitgirl.json scrapper output,
 * extracts base game names, matches against steam-catalog-v1.json, and
 * outputs repack-catalog-v1.json with appIds resolved.
 *
 * Usage: npx tsx matchIndexer.ts [--dry-run]
 */

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import type {
  RepackCatalogRecord,
  RepackCatalogArtifact,
  RepackCatalogManifest,
} from "./repackSchema";

const ARTIFACT_DIR = path.resolve(__dirname, "../../public/data/repacks");
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, "repack-catalog-v1.json");
const MANIFEST_PATH = path.join(ARTIFACT_DIR, "repack-catalog-v1.manifest.json");
const CATALOG_PATH = path.resolve(__dirname, "../../public/data/catalog/steam-catalog-v1.json");
const STEAMDB_PATH = path.resolve(__dirname, "../../public/data/steamdb.json");

const REPACK_SCHEMA_VERSION = 1;

// ── Raw JSON shapes from scrapper ──

interface ScrapperDownload {
  title: string;
  uploadDate: string;
  fileSize: string;
  uris: string[];
}

interface ScrapperFile {
  name: string;
  downloads: ScrapperDownload[];
}

interface SteamCatalogRecord {
  appId: number;
  name: string;
  type?: string;
  genres?: string[];
  categories?: string[];
}

interface SteamCatalog {
  schemaVersion: number;
  records: SteamCatalogRecord[];
}

// ── Title parsing ──

function parseSteamripTitle(title: string): { baseName: string; version?: string } {
  let t = title.trim();

  const versionMatch = t.match(/^(.*?)\s*\((v?[\d.]+[^)]*)\)\s*$/i);
  if (versionMatch) {
    return { baseName: versionMatch[1].trim(), version: versionMatch[2].trim() };
  }

  const buildMatch = t.match(/^(.*?)\s*\(Build\s+([^)]+)\)\s*$/i);
  if (buildMatch) {
    return { baseName: buildMatch[1].trim(), version: buildMatch[2].trim() };
  }

  t = t.replace(/\s+Free Download\s*$/i, "").trim();

  return { baseName: t };
}

function parseFitgirlTitle(title: string): { baseName: string; version?: string } {
  let t = title.trim();

  t = t.replace(/\s*•\s*$/, "").trim();

  const dashVersionMatch = t.match(/^(.*?)\s*[–—]\s*v?([\d].*)$/i);
  if (dashVersionMatch) {
    return { baseName: dashVersionMatch[1].trim(), version: dashVersionMatch[2].trim() };
  }

  const dashBuildMatch = t.match(/^(.*?)\s*[–—]\s*Build\s+([^,]+)/i);
  if (dashBuildMatch) {
    return { baseName: dashBuildMatch[1].trim(), version: dashBuildMatch[2].trim() };
  }

  const commaVMatch = t.match(/^(.*?),\s*v?([\d].*)$/i);
  if (commaVMatch) {
    return { baseName: commaVMatch[1].trim(), version: commaVMatch[2].trim() };
  }

  return { baseName: t };
}

function parseTitle(title: string, repacker: string): { baseName: string; version?: string } {
  if (repacker === "steamrip") return parseSteamripTitle(title);
  if (repacker === "fitgirl") return parseFitgirlTitle(title);
  return { baseName: title.trim() };
}

// ── Name normalization for matching ──

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bthe\b/g, "")
    .replace(/\ba\b/g, "")
    .replace(/\ban\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripEditionSuffixes(name: string): string {
  const suffixes = [
    /[-–—]\s*(?:enhanced|definitive|deluxe|ultimate|premium|gold|game of the year|goty|legendary|collector'?s?|digital deluxe|complete|masterpiece|anniversary|special|standard|limited|remastered|remake|rebirth)\s*(?:edition)?\s*(?:\+.*)?$/i,
    /\s*(?:enhanced|definitive|deluxe|ultimate|premium|gold|game of the year|goty|legendary|collector'?s?|digital deluxe|complete|masterpiece|anniversary|special|standard|limited|remastered|remake|rebirth)\s*(?:edition)?\s*(?:\+.*)?$/i,
    /\s*\([^)]*\)\s*$/,
    /\s*\+.*$/
  ];
  let result = name.trim();
  for (const suffix of suffixes) {
    const prev = result;
    result = result.replace(suffix, "").trim();
    if (result !== prev) break;
  }
  return result.trim();
}

// ── File size parsing ──

function parseFileSize(sizeStr: string): number {
  const s = sizeStr.trim().replace(/\n/g, "").replace(/\s*\/\s*\d+(?:\.\d+)?\s*(GB|MB)\s*/i, "").trim();
  const match = s.match(/^([\d.]+)\s*(TB|GB|MB|KB)$/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === "TB") return Math.round(val * 1_000_000_000_000);
  if (unit === "GB") return Math.round(val * 1_000_000_000);
  if (unit === "MB") return Math.round(val * 1_000_000);
  if (unit === "KB") return Math.round(val * 1_000);
  return 0;
}

// ── Steam catalog loading ──

interface SteamDbEntry {
  appid: number;
  name: string;
}

function loadFullSteamDb(): Map<string, SteamDbEntry[]> {
  const raw = JSON.parse(fs.readFileSync(STEAMDB_PATH, "utf-8")) as SteamDbEntry[];
  const map = new Map<string, SteamDbEntry[]>();
  for (const entry of raw) {
    const norm = normalizeName(entry.name);
    const compact = norm.replace(/[^a-z0-9]/g, "");
    const addToKey = (key: string) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    };
    addToKey(norm);
    if (compact && compact !== norm) addToKey(compact);
  }
  return map;
}

function loadCatalogMeta(): Map<number, SteamCatalogRecord> {
  const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf-8")) as SteamCatalog;
  const map = new Map<number, SteamCatalogRecord>();
  for (const rec of raw.records) {
    map.set(rec.appId, rec);
  }
  return map;
}

// ── Matching ──

interface MatchResult {
  appId: number;
  name: string;
  confidence: "exact" | "alias" | "fuzzy";
}

function findBestMatch(
  baseName: string,
  steamdb: Map<string, SteamDbEntry[]>,
): MatchResult | null {
  const norm = normalizeName(baseName);
  const stripped = stripEditionSuffixes(baseName);
  const normStripped = normalizeName(stripped);

  const candidates = steamdb.get(norm);
  if (candidates && candidates.length === 1) {
    return { appId: candidates[0].appid, name: candidates[0].name, confidence: "exact" };
  }

  if (normStripped !== norm) {
    const strippedCandidates = steamdb.get(normStripped);
    if (strippedCandidates && strippedCandidates.length === 1) {
      return { appId: strippedCandidates[0].appid, name: strippedCandidates[0].name, confidence: "exact" };
    }
  }

  const normCompact = norm.replace(/[^a-z0-9]/g, "");
  const compactCandidates = steamdb.get(normCompact);
  if (compactCandidates && compactCandidates.length === 1) {
    return { appId: compactCandidates[0].appid, name: compactCandidates[0].name, confidence: "alias" };
  }

  const normStrippedCompact = normStripped.replace(/[^a-z0-9]/g, "");
  if (normStrippedCompact !== normCompact) {
    const scCandidates = steamdb.get(normStrippedCompact);
    if (scCandidates && scCandidates.length === 1) {
      return { appId: scCandidates[0].appid, name: scCandidates[0].name, confidence: "alias" };
    }
  }

  if (normCompact.length > 6) {
    for (const [, entries] of steamdb) {
      for (const entry of entries) {
        const entryNorm = normalizeName(entry.name).replace(/[^a-z0-9]/g, "");
        if (entryNorm.includes(normCompact) || entryNorm.includes(normStrippedCompact)) {
          return { appId: entry.appid, name: entry.name, confidence: "fuzzy" };
        }
      }
    }
  }

  return null;
}

// ── Genre inference ──

function getTagsFromGenres(genres?: string[]): string[] {
  const tags: string[] = ["repack"];
  if (!genres) return tags;
  for (const g of genres) {
    const tag = g.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (tag) tags.push(tag);
  }
  return tags;
}

function getRepackerTag(repacker: string): string {
  if (repacker === "steamrip") return "steamrip";
  if (repacker === "fitgirl") return "fitgirl";
  return repacker;
}

function buildId(repacker: string, appId: number, index: number): string {
  if (appId > 0) return `${repacker}-${appId}`;
  return `${repacker}-unmatched-${index}`;
}

// ── Main indexing pipeline ──

function buildCatalogFromScrappers(): RepackCatalogRecord[] {
  const toolsDir = path.resolve(__dirname);
  const steamripPath = path.join(toolsDir, "steamrip.json");
  const fitgirlPath = path.join(toolsDir, "fitgirl.json");

  const steamdb = loadFullSteamDb();
  const catalogMeta = loadCatalogMeta();

  const seen = new Map<string, RepackCatalogRecord>();
  let unmatchedCount = 0;

  function processEntry(
    entry: ScrapperDownload,
    repacker: string,
  ): void {
    const { baseName, version: _version } = parseTitle(entry.title, repacker);
    if (!baseName) return;

    const match = findBestMatch(baseName, steamdb);

    let appId = 0;
    let title = baseName;
    let genres: string[] | undefined;
    let tags: string[] = ["repack", getRepackerTag(repacker)];

    if (match) {
      appId = match.appId;
      title = match.name;
      const meta = catalogMeta.get(match.appId);
      genres = meta?.genres;
      tags = [...getTagsFromGenres(genres), getRepackerTag(repacker)];
      if (match.confidence === "fuzzy") {
        tags.push("low-confidence-match");
      }
    }

    const record: RepackCatalogRecord = {
      id: buildId(repacker, appId, unmatchedCount),
      title,
      appId,
      repacker,
      installerType: "unknown",
      fileSize: parseFileSize(entry.fileSize),
      downloadUris: entry.uris || [],
      source: "scrapper-indexed",
      updatedAt: entry.uploadDate,
      tags,
    };

    const dedupKey = appId > 0 ? `${appId}:${repacker}` : `unmatched:${repacker}:${normalizeName(baseName)}`;
    const existing = seen.get(dedupKey);
    if (!existing || record.updatedAt > existing.updatedAt) {
      seen.set(dedupKey, record);
    }
  }

  const steamripRaw = JSON.parse(fs.readFileSync(steamripPath, "utf-8")) as ScrapperFile;
  for (const entry of steamripRaw.downloads) {
    processEntry(entry, "steamrip");
  }

  const fitgirlRaw = JSON.parse(fs.readFileSync(fitgirlPath, "utf-8")) as ScrapperFile;
  for (const entry of fitgirlRaw.downloads) {
    processEntry(entry, "fitgirl");
  }

  return Array.from(seen.values()).sort((a, b) => {
    if (a.appId !== b.appId) return (a.appId || 0) - (b.appId || 0);
    return a.repacker.localeCompare(b.repacker);
  });
}

// ── Main ──

function main(): void {
  const dryRun = process.argv.includes("--dry-run");

  console.log("[MATCHER] Building repack catalog from scrapper data...");
  const records = buildCatalogFromScrappers();

  const matched = records.filter((r) => r.appId > 0);
  const unmatched = records.filter((r) => r.appId === 0);

  console.log(`[MATCHER] Total records: ${records.length}`);
  console.log(`[MATCHER] Matched (with appId): ${matched.length}`);
  console.log(`[MATCHER] Unmatched (no appId): ${unmatched.length}`);

  if (matched.length > 0) {
    const byRepacker = new Map<string, number>();
    for (const r of matched) {
      byRepacker.set(r.repacker, (byRepacker.get(r.repacker) || 0) + 1);
    }
    for (const [repacker, count] of byRepacker) {
      console.log(`[MATCHER]   ${repacker}: ${count} matched`);
    }
  }

  if (unmatched.length > 0 && unmatched.length <= 50) {
    console.log("[MATCHER] Unmatched entries:");
    for (const r of unmatched) {
      console.log(`[MATCHER]   ${r.repacker}: "${r.title}" (${r.tags.join(", ")})`);
    }
  } else if (unmatched.length > 0) {
    console.log(`[MATCHER] ${unmatched.length} unmatched entries (too many to list)`);
  }

  const matchedWithFuzzy = matched.filter((r) => r.tags.includes("low-confidence-match"));
  if (matchedWithFuzzy.length > 0 && matchedWithFuzzy.length <= 20) {
    console.log("[MATCHER] Low-confidence matches:");
    for (const r of matchedWithFuzzy) {
      console.log(`[MATCHER]   ${r.repacker}: "${r.title}" appId=${r.appId}`);
    }
  } else if (matchedWithFuzzy.length > 0) {
    console.log(`[MATCHER] ${matchedWithFuzzy.length} low-confidence matches (too many to list)`);
  }

  if (dryRun) {
    console.log("[MATCHER] Dry run — not writing files.");
    return;
  }

  const artifact: RepackCatalogArtifact = {
    schemaVersion: REPACK_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    records,
  };

  const json = JSON.stringify(artifact, null, 2);
  const checksum = createHash("sha256").update(json).digest("hex");

  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  }

  fs.writeFileSync(ARTIFACT_PATH, json, "utf-8");
  console.log(`[MATCHER] Written ${ARTIFACT_PATH}`);

  const manifest: RepackCatalogManifest = {
    schemaVersion: REPACK_SCHEMA_VERSION,
    generatedAt: artifact.generatedAt,
    recordCount: records.length,
    checksum,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`[MATCHER] Written ${MANIFEST_PATH}`);
  console.log(`[MATCHER] Done — ${records.length} records, checksum=${checksum.slice(0, 16)}...`);
}

main();
