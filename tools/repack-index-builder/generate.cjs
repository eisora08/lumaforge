/**
 * Repack Index Generator (CJS) — standalone runner for the repack catalog builder.
 * Call: node generate.cjs [curated-json-path]
 *
 * If no path is given, looks for "curated-repacks.json" in the same directory.
 * The output artifact + manifest are written to ../../public/data/repacks/
 *
 * This mirrors the steam-catalog-builder's generate.cjs pattern.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ARTIFACT_DIR = path.resolve(__dirname, "../../public/data/repacks");
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, "repack-catalog-v1.json");
const MANIFEST_PATH = path.join(ARTIFACT_DIR, "repack-catalog-v1.manifest.json");

const REPACK_SCHEMA_VERSION = 1;

const KNOWN_REPACKERS = [
  "fitgirl", "dodi", "elamigos", "chovka", "kaos",
  "skidrow", "codex", "plaza", "gog", "razor1911",
  "hoodlum", "cpy", "steamrip", "tenoke",
];

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRepackerName(name) {
  const lower = name.toLowerCase().trim();
  for (const known of KNOWN_REPACKERS) {
    if (lower.includes(known)) return known;
  }
  return lower.replace(/[^a-z0-9]/g, "-");
}

function computeChecksum(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function buildCatalog(records) {
  const seen = new Map();

  for (const rec of records) {
    const key = `${normalizeTitle(rec.title)}:${rec.repacker}`;
    const existing = seen.get(key);
    if (!existing || rec.updatedAt > existing.updatedAt) {
      seen.set(key, rec);
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => normalizeTitle(a.title).localeCompare(normalizeTitle(b.title)));
}

function generateCatalog(curatedRecords) {
  console.log(`[REPACK_GEN] Starting with ${curatedRecords.length} curated records`);

  // Normalize repacker names
  for (const rec of curatedRecords) {
    rec.repacker = normalizeRepackerName(rec.repacker);
    rec.id = `${rec.repacker}-${rec.appId || rec.title.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
  }

  const records = buildCatalog(curatedRecords);
  console.log(`[REPACK_GEN] After dedup: ${records.length} records`);

  const artifact = {
    schemaVersion: REPACK_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    records,
  };

  const json = JSON.stringify(artifact, null, 2);
  const checksum = computeChecksum(json);

  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  }

  fs.writeFileSync(ARTIFACT_PATH, json, "utf-8");
  console.log(`[REPACK_GEN] Written artifact: ${ARTIFACT_PATH}`);

  const manifest = {
    schemaVersion: REPACK_SCHEMA_VERSION,
    generatedAt: artifact.generatedAt,
    recordCount: records.length,
    checksum,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`[REPACK_GEN] Written manifest: ${MANIFEST_PATH}`);

  return { recordCount: records.length, checksum };
}

// ── CLI ──
const curatedPath = process.argv[2] || path.resolve(__dirname, "curated-repacks.json");
console.log(`[REPACK_GEN] Curated data path: ${curatedPath}`);

if (!fs.existsSync(curatedPath)) {
  console.error(`[REPACK_GEN] ERROR: Curated data not found at ${curatedPath}`);
  console.error(`[REPACK_GEN] Create ${curatedPath} with an array of RepackCatalogRecord objects,`);
  console.error(`[REPACK_GEN] or pass an alternative path as the first argument.`);
  process.exit(1);
}

try {
  const curatedData = JSON.parse(fs.readFileSync(curatedPath, "utf-8"));
  const result = generateCatalog(curatedData);
  console.log(`[REPACK_GEN] Done — ${result.recordCount} records, checksum=${result.checksum.substring(0, 16)}...`);
} catch (err) {
  console.error("[REPACK_GEN] Failed:", err);
  process.exit(1);
}
