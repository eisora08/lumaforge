#!/usr/bin/env node
/**
 * Standalone Node script to generate a catalog artifact.
 * Uses plain JS — no TypeScript dependencies.
 * Reads steamdb.json, fetches Steam API, writes artifact JSON.
 *
 * Rate-limit strategy: sequential fetches with global cooldown on 429.
 */

const { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } = require("fs");
const { join } = require("path");
const { createHash } = require("crypto");

const ROOT = join(__dirname, "..", "..");
const OUTPUT_DIR = join(__dirname, "output");
const ARTIFACT_PATH = join(OUTPUT_DIR, "steam-catalog-v1.json");
const COMPRESSED_PATH = join(OUTPUT_DIR, "steam-catalog-v1.json.gz");
const MANIFEST_PATH = join(OUTPUT_DIR, "steam-catalog-v1.manifest.json");

const args = process.argv.slice(2);
function getArg(name, def) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : def;
}
const INPUT = getArg("input", join(ROOT, "public", "data", "steamdb.json"));
const LIMIT = parseInt(getArg("limit", "162376"), 10);
const DELAY_MS = parseInt(getArg("delay", "300"), 10);

const GENRE_ALIASES = {
  "action": "Action", "adventure": "Adventure", "action-adventure": "Action",
  "rpg": "RPG", "role-playing": "RPG", "role playing": "RPG", "roleplaying": "RPG",
  "strategy": "Strategy", "simulation": "Simulation", "sports": "Sports",
  "racing": "Racing", "race": "Racing", "indie": "Indie", "casual": "Casual",
  "massively multiplayer": "Massively Multiplayer", "mmo": "Massively Multiplayer",
  "mmorpg": "Massively Multiplayer",
};

function normalizeGenre(raw) {
  const c = raw.trim().toLowerCase();
  if (GENRE_ALIASES[c]) return GENRE_ALIASES[c];
  for (const [alias, canon] of Object.entries(GENRE_ALIASES)) {
    if (c.startsWith(alias + " ") || c.startsWith(alias + "-") || c.endsWith(" " + alias) || c.includes(" " + alias + " ")) return canon;
  }
  const tokens = c.split(/\s+/);
  for (const t of tokens) { if (GENRE_ALIASES[t]) return GENRE_ALIASES[t]; }
  return null;
}

function sha256(data) { return createHash("sha256").update(data).digest("hex"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function parseDate(s) {
  if (!s || s === "" || s.toLowerCase() === "coming soon" || s.toLowerCase() === "tbd") return 0;
  try { const d = new Date(s); return isNaN(d.getTime()) ? 0 : Math.floor(d.getTime() / 1000); } catch { return 0; }
}
function mapType(t) {
  const l = (t || "").toLowerCase();
  if (l === "game") return "game"; if (l === "dlc") return "dlc";
  if (l === "demo") return "demo"; if (l === "application") return "application";
  return "unknown";
}

async function fetchAppDetails(appId) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=english`;
  try {
    const r = await fetch(url);
    if (r.status === 429) return { _rateLimited: true };
    if (!r.ok) return { _error: true, status: r.status };
    const json = await r.json();
    const key = String(appId);
    if (json[key] === null || json[key] === undefined) return { _rateLimited: true };
    return json[key] || { success: false };
  } catch (e) {
    return { _error: true, message: e.message };
  }
}

function buildRecord(entry, wrapped) {
  if (!wrapped || !wrapped.success || !wrapped.data) return null;
  const d = wrapped.data;
  const type = mapType(d.type);
  if (type === "unknown") return null;

  const seen = new Set();
  const genres = [];
  const originalGenres = [];
  for (const g of (d.genres || [])) {
    const c = normalizeGenre(g.description);
    if (c && !seen.has(c)) { seen.add(c); genres.push(c); }
    if (g.description?.trim()) originalGenres.push(g.description.trim());
  }

  const categories = (d.categories || []).map(c => c.description);
  const categoryIds = (d.categories || []).map(c => c.id);
  const releaseTimestamp = parseDate(d.release_date?.date);
  const comingSoon = d.release_date?.coming_soon ?? false;
  const total = d.recommendations?.total ?? 0;
  const reviews = d.reviews;
  let reviewPercent = 0, reviewCount = total;
  if (reviews?.length > 0) {
    const pos = reviews[0].positive || 0;
    const tot = reviews[0].total || total;
    reviewPercent = tot > 0 ? Math.round((pos / tot) * 100) : 0;
    reviewCount = tot;
  }

  return {
    appId: entry.appid, name: entry.name || d.name || "", type, genres, originalGenres,
    categories, categoryIds, releaseTimestamp, comingSoon,
    isFree: d.is_free ?? false, reviewPercent, reviewCount,
    headerImage: d.header_image || "", capsuleImage: d.capsule_image || "",
    developers: d.developers || [], publishers: d.publishers || [],
    lastEnrichedAt: Math.floor(Date.now() / 1000),
  };
}

async function main() {
  const startTime = Date.now();
  console.log(`\nSteam Catalog Builder v1 (sequential)\n`);
  console.log(`Input:    ${INPUT}`);
  console.log(`Output:   ${OUTPUT_DIR}`);
  console.log(`Limit:    ${LIMIT}`);
  console.log(`Delay:    ${DELAY_MS}ms\n`);

  const allEntries = JSON.parse(readFileSync(INPUT, "utf-8"));
  console.log(`Loaded ${allEntries.length.toLocaleString()} entries`);
  const entries = allEntries.slice(0, LIMIT);
  console.log(`Processing ${entries.length.toLocaleString()}\n`);

  const records = [];
  const unsupported = [];
  const rateLimitedIds = [];
  const failedIds = [];
  let globalCooldownUntil = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Global cooldown: if we recently hit a 429, wait until cooldown expires
    if (globalCooldownUntil > Date.now()) {
      const waitMs = globalCooldownUntil - Date.now();
      process.stdout.write(`  [cooldown] waiting ${(waitMs / 1000).toFixed(0)}s...\n`);
      await sleep(waitMs);
    }

    const result = await fetchAppDetails(entry.appid);

    if (result._rateLimited) {
      // Global cooldown: 20s first time, 40s second, 60s max
      const cooldownCount = rateLimitedIds.length;
      const cooldownMs = Math.min(20000 + cooldownCount * 10000, 60000);
      globalCooldownUntil = Date.now() + cooldownMs;
      rateLimitedIds.push(entry.appid);
      // Re-process this entry after cooldown
      i--;
      continue;
    }

    if (result._error) {
      failedIds.push(entry.appid);
      continue;
    }

    const record = buildRecord(entry, result);
    if (record) {
      records.push(record);
    } else {
      unsupported.push(entry.appid);
    }

    // Progress
    const processed = i + 1;
    if (processed % 50 === 0 || processed >= entries.length) {
      const pct = ((processed / entries.length) * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = processed / (Date.now() - startTime) * 1000;
      process.stdout.write(`  [${elapsed}s] ${processed}/${entries.length} (${pct}%) games=${records.length} unsupported=${unsupported.length} rate=${rate.toFixed(1)}/s\n`);
    }

    if (i + 1 < entries.length) await sleep(DELAY_MS);
  }

  // Stats
  const gameCount = records.filter(r => r.type === "game").length;
  const genreCount = records.filter(r => r.genres.length > 0).length;
  const imageCount = records.filter(r => r.headerImage !== "" || r.capsuleImage !== "").length;
  const releaseCount = records.filter(r => r.releaseTimestamp > 0).length;
  const reviewCount = records.filter(r => r.reviewCount > 0).length;
  const allGenres = [...new Set(records.flatMap(r => r.genres))].sort();

  // Write artifact
  const artifact = { schemaVersion: 1, catalogVersion: 1, generatedAt: new Date().toISOString(), records };
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  const tmpPath = ARTIFACT_PATH + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(artifact), "utf-8");
  renameSync(tmpPath, ARTIFACT_PATH);

  const artifactJson = readFileSync(ARTIFACT_PATH, "utf-8");
  const checksum = sha256(artifactJson);
  const uncompressedSize = Buffer.byteLength(artifactJson);

  let compressedSize = 0;
  try {
    const { gzipSync } = require("zlib");
    const compressed = gzipSync(Buffer.from(artifactJson));
    compressedSize = compressed.length;
    writeFileSync(COMPRESSED_PATH, compressed);
  } catch {}

  const manifest = {
    schemaVersion: 1, catalogVersion: 1, generatedAt: new Date().toISOString(),
    recordCount: records.length, sourceRecordCount: entries.length, gameCount,
    genreCoverageCount: genreCount, imageCoverageCount: imageCount,
    releaseDateCoverageCount: releaseCount, reviewCoverageCount: reviewCount,
    genres: allGenres, checksum, artifactFile: "steam-catalog-v1.json",
    compressedFile: compressedSize > 0 ? "steam-catalog-v1.json.gz" : undefined,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== BUILD COMPLETE ===`);
  console.log(`  Time:               ${elapsed}s`);
  console.log(`  Total records:      ${records.length.toLocaleString()}`);
  console.log(`  Game records:       ${gameCount.toLocaleString()}`);
  console.log(`  Genre coverage:     ${records.length > 0 ? ((genreCount / records.length) * 100).toFixed(1) : 0}%`);
  console.log(`  Image coverage:     ${records.length > 0 ? ((imageCount / records.length) * 100).toFixed(1) : 0}%`);
  console.log(`  Release coverage:   ${records.length > 0 ? ((releaseCount / records.length) * 100).toFixed(1) : 0}%`);
  console.log(`  Review coverage:    ${records.length > 0 ? ((reviewCount / records.length) * 100).toFixed(1) : 0}%`);
  console.log(`  Unsupported:        ${unsupported.length}`);
  console.log(`  Rate-limited:       ${rateLimitedIds.length}`);
  console.log(`  Failed:             ${failedIds.length}`);
  console.log(`  Uncompressed size:  ${(uncompressedSize / 1024 / 1024).toFixed(2)} MB`);
  if (compressedSize > 0) console.log(`  Compressed size:    ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Checksum:           ${checksum.substring(0, 16)}...`);
  console.log(`  Genres:             ${allGenres.join(", ")}`);
  console.log(`  Artifact:           ${ARTIFACT_PATH}`);
}

main().catch(e => { console.error("Build failed:", e); process.exit(1); });
