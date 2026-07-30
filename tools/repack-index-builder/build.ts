/**
 * Repack Index Builder — offline tool that generates the repack-catalog-v1.json
 * artifact from a curated manifest + optional Hydra API source.
 *
 * This mirrors the steam-catalog-builder pattern but for game repacks.
 * It does NOT scrape repack sites — it uses curated data + optional
 * Hydra/API data sources provided via JSON input files.
 */

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import {
  type RepackCatalogRecord,
  type RepackCatalogArtifact,
  type RepackCatalogManifest,
  REPACK_SCHEMA_VERSION,
} from "./repackSchema";

const ARTIFACT_DIR = path.resolve(__dirname, "../../public/data/repacks");
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, "repack-catalog-v1.json");
const MANIFEST_PATH = path.join(ARTIFACT_DIR, "repack-catalog-v1.manifest.json");

interface BuildOptions {
  /** Path to a curated JSON file with RepackCatalogRecord[] entries */
  curatedPath?: string;
  /** If true, only build from curated data — no API source */
  curatedOnly?: boolean;
}

/**
 * Build the repack catalog artifact from curated data sources.
 * Deduplicates by (title, repacker) — prefers most recent updatedAt.
 */
export function buildCatalog(records: RepackCatalogRecord[]): RepackCatalogRecord[] {
  const seen = new Map<string, RepackCatalogRecord>();

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

function normalizeTitle(title: string): string {
  return title.toLowerCase()
    .replaceAll(/[^a-z0-9\s]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function computeChecksum(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Run the full build pipeline:
 * 1. Load curated records from input file
 * 2. Build the catalog (dedup + sort)
 * 3. Write artifact + manifest
 */
export function runBuild(options: BuildOptions): { recordCount: number; checksum: string } {
  if (!options.curatedPath) {
    throw new Error("curatedPath is required");
  }

  if (!fs.existsSync(options.curatedPath)) {
    throw new Error(`Curated data file not found: ${options.curatedPath}`);
  }

  console.log(`[REPACK_BUILDER] Loading curated data from ${options.curatedPath}`);
  const raw: RepackCatalogRecord[] = JSON.parse(fs.readFileSync(options.curatedPath, "utf-8"));
  console.log(`[REPACK_BUILDER] Loaded ${raw.length} raw records`);

  const records = buildCatalog(raw);
  console.log(`[REPACK_BUILDER] After dedup: ${records.length} records`);

  const artifact: RepackCatalogArtifact = {
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
  console.log(`[REPACK_BUILDER] Written ${ARTIFACT_PATH}`);

  const manifest: RepackCatalogManifest = {
    schemaVersion: REPACK_SCHEMA_VERSION,
    generatedAt: artifact.generatedAt,
    recordCount: records.length,
    checksum,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`[REPACK_BUILDER] Written ${MANIFEST_PATH}`);

  return { recordCount: records.length, checksum };
}

// CLI entry point
if (require.main === module) {
  const curatedPath = process.argv[2] || path.resolve(__dirname, "curated-repacks.json");
  const curatedOnly = process.argv.includes("--curated-only");

  try {
    const result = runBuild({ curatedPath, curatedOnly });
    console.log(`[REPACK_BUILDER] Done — ${result.recordCount} records, checksum=${result.checksum.slice(0, 16)}...`);
  } catch (err) {
    console.error("[REPACK_BUILDER] Build failed:", err);
    process.exit(1);
  }
}
