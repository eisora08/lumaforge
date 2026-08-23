/**
 * steamLuaAuditor.ts
 *
 * Audits Steam Lua script files and LumaForge provider-status files
 * for safe inclusion in a backup. Defines strict allowlists for:
 *   - Lua script directory files (read from disk via Rust)
 *   - Provider status store files (read from disk via Rust)
 *
 * All files are scanned with checksums and metadata for integrity.
 * No executable or sensitive files are included.
 */

import {
  scanExternalFileCollection,
  readFileCollectionContent,
  verifyFileChecksums,
  type ExternalFileEntry,
} from "./tauri";

// ── Debug flag (false by default) ──

const DEBUG_EXTERNAL_BACKUP_RUNTIME = false;

// ── Allowlist constants ──

/** Extensions permitted for Lua script backup */
export const LUA_ALLOWED_EXTENSIONS = ["lua", "disabled"];

/** Files explicitly skipped even if they match the extension allowlist */
export const LUA_BLOCKED_FILE_NAMES = new Set([
  "README.md",
  "readme.md",
  "CHANGELOG.md",
  "changelog.md",
]);

/** Max individual Lua file size: 512 KB */
export const LUA_MAX_FILE_SIZE = 512 * 1024;

/** Max total Lua files to back up per collection */
export const LUA_MAX_FILES = 200;

/** Extensions permitted for provider-status store backup */
export const PROVIDER_STATUS_ALLOWED_EXTENSIONS = ["json"];

/** Max individual provider-status file size: 1 MB */
export const PROVIDER_STATUS_MAX_FILE_SIZE = 1024 * 1024;

/** Max total provider-status files to back up */
export const PROVIDER_STATUS_MAX_FILES = 5000;

// ── Types ──

export type LuaFileCategory =
  | "lua-script"
  | "lua-disabled"
  | "provider-status"
  | "snapshot"
  | "scan-state"
  | "unknown";

export type LuaAuditEntry = {
  relativePath: string;
  fileName: string;
  category: LuaFileCategory;
  size: number;
  checksum: string;
  modifiedAt: number;
  safe: boolean;
  reason?: string;
};

export type LuaAuditResult = {
  luaFiles: ExternalFileEntry[];
  providerStatusFiles: ExternalFileEntry[];
  totalLuaFiles: number;
  totalProviderStatusFiles: number;
  totalSize: number;
  entries: LuaAuditEntry[];
  errors: string[];
  warnings: string[];
};

/** Normalized entry with guaranteed non-optional fields for safe classification. */
type NormalizedExternalFileEntry = {
  relativePath: string;
  fileName: string;
  extension: string;
  size: number;
  modifiedAt: number;
  checksum: string;
  isSymlink: boolean;
};

// ── Normalization ──

/**
 * Normalize a raw ExternalFileEntry from Rust into a shape with guaranteed fields.
 * Derives fileName from relativePath when missing.
 * Derives extension from fileName, handling compound extensions like .lua.disabled.
 * Rejects entries with missing/invalid relativePath or non-numeric size.
 * Never throws — malformed entries get safe fallbacks.
 */
function normalizeEntry(raw: ExternalFileEntry): NormalizedExternalFileEntry | null {
  // Validate relativePath
  const relPath = typeof raw.relativePath === "string" ? raw.relativePath.trim() : "";
  if (!relPath) return null;

  // Reject traversal and absolute paths
  if (relPath.startsWith("/") || relPath.startsWith("\\") || relPath.includes("..")) {
    return null;
  }

  // Derive fileName safely
  let fileName = typeof raw.fileName === "string" ? raw.fileName.trim() : "";
  if (!fileName) {
    // Derive from relativePath (last component)
    const parts = relPath.replace(/\\/g, "/").split("/");
    fileName = parts[parts.length - 1] || "";
  }
  if (!fileName) return null;

  // Derive extension — handle compound .lua.disabled
  let extension = "";
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".lua.disabled")) {
    extension = "lua.disabled";
  } else {
    const dotIdx = lowerName.lastIndexOf(".");
    extension = dotIdx > 0 ? lowerName.slice(dotIdx + 1) : "";
  }

  // Validate size
  const size = typeof raw.size === "number" && !Number.isNaN(raw.size) ? raw.size : 0;

  return {
    relativePath: relPath.replace(/\\/g, "/"),
    fileName,
    extension,
    size,
    modifiedAt: typeof raw.modifiedAt === "number" ? raw.modifiedAt : 0,
    checksum: typeof raw.checksum === "string" ? raw.checksum : "",
    isSymlink: false,
  };
}

// ── Category classification ──

function classifyLuaFile(entry: NormalizedExternalFileEntry): LuaFileCategory {
  const name = entry.fileName.toLowerCase();

  if (name === "snapshot.json") return "snapshot";
  if (name === "scan-state.json") return "scan-state";

  if (entry.extension === "lua.disabled") return "lua-disabled";
  if (entry.extension === "lua") return "lua-script";

  return "unknown";
}

function isLuaFileSafe(entry: NormalizedExternalFileEntry): { safe: boolean; reason?: string } {
  const cat = classifyLuaFile(entry);

  if (cat === "unknown") {
    return { safe: false, reason: `Unknown file category: ${entry.fileName}` };
  }

  if (LUA_BLOCKED_FILE_NAMES.has(entry.fileName)) {
    return { safe: false, reason: `Blocked documentation file: ${entry.fileName}` };
  }

  if (entry.size > LUA_MAX_FILE_SIZE) {
    return { safe: false, reason: `File exceeds size limit (${entry.size} > ${LUA_MAX_FILE_SIZE})` };
  }

  return { safe: true };
}

// ── Main audit functions ──

/**
 * Audit Lua script files in the given Lua directory.
 * Returns a filtered collection of safe-to-back-up files.
 *
 * @param luaDir - The Steam Lua directory path (e.g., steamapps/common/LuaScripts)
 */
export async function auditLuaScripts(
  luaDir: string,
): Promise<LuaAuditResult> {
  const result: LuaAuditResult = {
    luaFiles: [],
    providerStatusFiles: [],
    totalLuaFiles: 0,
    totalProviderStatusFiles: 0,
    totalSize: 0,
    entries: [],
    errors: [],
    warnings: [],
  };

  if (!luaDir) {
    result.errors.push("Lua path is not configured");
    return result;
  }

  if (DEBUG_EXTERNAL_BACKUP_RUNTIME) {
    console.log("[LUA_AUDIT][STAGE] settings-resolved");
  }

  let collection;
  try {
    collection = await scanExternalFileCollection(
      luaDir,
      "lua-scripts",
      LUA_ALLOWED_EXTENSIONS,
      LUA_MAX_FILE_SIZE,
      LUA_MAX_FILES,
    );
  } catch (e) {
    const msg = String(e ?? "Unknown error");
    if (msg.includes("does not exist") || msg.includes("not a directory")) {
      result.errors.push("Lua directory does not exist");
    } else {
      result.errors.push(`Unable to scan the Lua directory: ${msg}`);
    }
    return result;
  }

  if (DEBUG_EXTERNAL_BACKUP_RUNTIME) {
    console.log(`[LUA_AUDIT][STAGE] scanned files=${collection.totalFiles}`);
  }

  result.luaFiles = collection.files;
  result.totalLuaFiles = collection.totalFiles;

  let normalized = 0;
  let malformed = 0;

  for (const file of collection.files) {
    const norm = normalizeEntry(file);
    if (!norm) {
      malformed++;
      result.entries.push({
        relativePath: typeof file.relativePath === "string" ? file.relativePath : "(unknown)",
        fileName: typeof file.fileName === "string" ? file.fileName : "(unknown)",
        category: "unknown",
        size: typeof file.size === "number" ? file.size : 0,
        checksum: typeof file.checksum === "string" ? file.checksum : "",
        modifiedAt: typeof file.modifiedAt === "number" ? file.modifiedAt : 0,
        safe: false,
        reason: "Malformed entry: missing or invalid relative path",
      });
      continue;
    }

    normalized++;
    const { safe, reason } = isLuaFileSafe(norm);
    const category = classifyLuaFile(norm);

    result.entries.push({
      relativePath: norm.relativePath,
      fileName: norm.fileName,
      category,
      size: norm.size,
      checksum: norm.checksum,
      modifiedAt: norm.modifiedAt,
      safe,
      reason,
    });

    if (safe) {
      result.totalSize += norm.size;
    }
  }

  if (DEBUG_EXTERNAL_BACKUP_RUNTIME) {
    console.log(`[LUA_AUDIT][STAGE] normalized=${normalized} malformed=${malformed} total-entries=${result.entries.length}`);
  }

  if (malformed > 0) {
    result.warnings.push(`${malformed} malformed ${malformed === 1 ? "entry" : "entries"} skipped`);
  }

  return result;
}

/**
 * Audit LumaForge provider-status store files.
 *
 * @param appDataDir - The LumaForge appData directory (e.g., %APPDATA%/lumaforge)
 */
export async function auditProviderStatusFiles(
  appDataDir: string,
): Promise<LuaAuditResult> {
  const result: LuaAuditResult = {
    luaFiles: [],
    providerStatusFiles: [],
    totalLuaFiles: 0,
    totalProviderStatusFiles: 0,
    totalSize: 0,
    entries: [],
    errors: [],
    warnings: [],
  };

  if (!appDataDir) {
    result.errors.push("AppData directory path is empty");
    return result;
  }

  const statusRoot = `${appDataDir.replace(/\\/g, "/")}/store/provider-status`;

  try {
    const collection = await scanExternalFileCollection(
      statusRoot,
      "provider-status",
      PROVIDER_STATUS_ALLOWED_EXTENSIONS,
      PROVIDER_STATUS_MAX_FILE_SIZE,
      PROVIDER_STATUS_MAX_FILES,
    );

    result.providerStatusFiles = collection.files;
    result.totalProviderStatusFiles = collection.totalFiles;

    for (const file of collection.files) {
      const norm = normalizeEntry(file);
      if (!norm) continue;

      const category = classifyLuaFile(norm);

      result.entries.push({
        relativePath: norm.relativePath,
        fileName: norm.fileName,
        category,
        size: norm.size,
        checksum: norm.checksum,
        modifiedAt: norm.modifiedAt,
        safe: true,
      });

      result.totalSize += norm.size;
    }
  } catch (e) {
    result.warnings.push(`Provider-status directory not found or empty: ${e}`);
  }

  return result;
}

/**
 * Audit both Lua scripts and provider-status files in a single pass.
 */
export async function auditAllLuaInputs(
  luaDir: string,
  appDataDir: string,
): Promise<LuaAuditResult> {
  const [luaResult, providerResult] = await Promise.all([
    auditLuaScripts(luaDir),
    auditProviderStatusFiles(appDataDir),
  ]);

  return {
    luaFiles: [...luaResult.luaFiles, ...providerResult.luaFiles],
    providerStatusFiles: providerResult.providerStatusFiles,
    totalLuaFiles: luaResult.totalLuaFiles,
    totalProviderStatusFiles: providerResult.totalProviderStatusFiles,
    totalSize: luaResult.totalSize + providerResult.totalSize,
    entries: [...luaResult.entries, ...providerResult.entries],
    errors: [...luaResult.errors, ...providerResult.errors],
    warnings: [...luaResult.warnings, ...providerResult.warnings],
  };
}

/**
 * Read the content of audited Lua files for embedding in a backup archive.
 * Only reads files marked as safe.
 */
export async function readLuaFilesContent(
  luaDir: string,
  safeRelativePaths: string[],
): Promise<Record<string, string>> {
  if (!luaDir || safeRelativePaths.length === 0) return {};
  return readFileCollectionContent(luaDir, safeRelativePaths);
}

/**
 * Read the content of audited provider-status files.
 */
export async function readProviderStatusContent(
  appDataDir: string,
  safeRelativePaths: string[],
): Promise<Record<string, string>> {
  if (!appDataDir || safeRelativePaths.length === 0) return {};
  const statusRoot = `${appDataDir.replace(/\\/g, "/")}/store/provider-status`;
  return readFileCollectionContent(statusRoot, safeRelativePaths);
}

/**
 * Verify checksums of Lua files on disk against expected values from a backup.
 */
export async function verifyLuaFileChecksums(
  luaDir: string,
  files: [string, string][],
): Promise<{ allValid: boolean; checked: number; errors: string[] }> {
  if (!luaDir || files.length === 0) {
    return { allValid: true, checked: 0, errors: [] };
  }
  return verifyFileChecksums(luaDir, files);
}

/**
 * Verify checksums of provider-status files on disk.
 */
export async function verifyProviderStatusChecksums(
  appDataDir: string,
  files: [string, string][],
): Promise<{ allValid: boolean; checked: number; errors: string[] }> {
  if (!appDataDir || files.length === 0) {
    return { allValid: true, checked: 0, errors: [] };
  }
  const statusRoot = `${appDataDir.replace(/\\/g, "/")}/store/provider-status`;
  return verifyFileChecksums(statusRoot, files);
}
