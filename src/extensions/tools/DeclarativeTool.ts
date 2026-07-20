/**
 * Declarative Tool — Generic Tool driven by manifest toolConfig metadata.
 *
 * Given an ExtensionManifestV1 with `metadata.toolConfig`, this class implements
 * the Tool interface for all tool types using toolConfig to determine behavior:
 *
 * - copy-files (default):  copy files from extension dir to game dir
 * - proxy mode:            rename originals with backupSuffix, then copy proxy DLLs
 * - executable mode:       run an executable (e.g. Steamless) on the game's EXE
 * - index mode:            fetch a remote index, download game-specific files
 *
 * Every operation creates a log file in the game dir for diagnostics.
 */

import type { ExtensionManifestV1 } from "../types";
import type {
  Tool,
  ToolConfig,
  ToolManagedFile,
  ToolDetectionResult,
  ToolApplyResult,
} from "./types";
import {
  extensionCopyFile,
  extensionRenameFile,
  extensionFileExists,
  extensionRemoveFile,
  extensionCreateDir,
  extensionDownloadFile,
  extensionExtractZipAll,
  extensionRunProcess,
  extensionFetchUrlAsText,
  extensionFindLargestExe,
  extensionWriteTextFile,
} from "../services/extensionTauri";

// =============================================================================
// Helpers
// =============================================================================

/** Extract ToolConfig from manifest metadata, or null. */
export function extractToolConfig(manifest: ExtensionManifestV1): ToolConfig | null {
  const meta = manifest.metadata as Record<string, unknown> | undefined;
  const tc = meta?.toolConfig as Record<string, unknown> | undefined;
  if (!tc || typeof tc !== "object") return null;

  const parseFiles = (arr: unknown): ToolManagedFile[] | undefined =>
    Array.isArray(arr)
      ? (arr as Record<string, unknown>[]).map((f) => ({
          source: String(f.source ?? ""),
          target: String(f.target ?? ""),
          originalName: typeof f.originalName === "string" ? f.originalName : undefined,
          required: typeof f.required === "boolean" ? f.required : true,
          backupSuffix: typeof f.backupSuffix === "string" ? f.backupSuffix : undefined,
        }))
      : undefined;

  const rawType = tc.type as string | undefined;
  const type = rawType === "rename-proxy" || rawType === "custom" ? rawType : "copy-files";

  return {
    type,
    target: (tc.target as string) === "steam-root" ? "steam-root" : "game-folder",
    description: typeof tc.description === "string" ? tc.description : undefined,
    icon: typeof tc.icon === "string" ? tc.icon : undefined,
    files: parseFiles(tc.files),
    configFiles: parseFiles(tc.configFiles),
    category: typeof tc.category === "string" ? tc.category : undefined,
    customHandler: typeof tc.customHandler === "string" ? tc.customHandler : undefined,
    priority: typeof tc.priority === "number" ? tc.priority : undefined,
    backup: typeof tc.backup === "boolean" ? tc.backup : undefined,
    backupSuffix: typeof tc.backupSuffix === "string" ? tc.backupSuffix : undefined,
    mode: (tc.mode as string) === "proxy" ? "proxy" : undefined,
    executable: typeof tc.executable === "string" ? tc.executable : undefined,
    args: Array.isArray(tc.args) ? (tc.args as string[]).map(String) : undefined,
    usesIndex: typeof tc.usesIndex === "boolean" ? tc.usesIndex : undefined,
    indexUrl: typeof tc.indexUrl === "string" ? tc.indexUrl : undefined,
  };
}

function toolLog(msg: string) {
  if (typeof window !== "undefined" && (window as any).__DEBUG_TOOLS) {
    console.log(`[TOOL] ${msg}`);
  }
}

// =============================================================================
// DeclarativeTool
// =============================================================================

export class DeclarativeTool implements Tool {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly extensionId: string;
  readonly category?: string;
  readonly icon?: string;
  readonly priority?: number;

  private config: ToolConfig;
  private allFiles: ToolManagedFile[];

  constructor(manifest: ExtensionManifestV1, config: ToolConfig) {
    this.id = manifest.id;
    this.displayName = manifest.displayName;
    this.description = config.description ?? manifest.description;
    this.extensionId = manifest.id;
    this.category = config.category;
    this.icon = config.icon ?? manifest.icon;
    this.priority = config.priority;
    this.config = config;
    this.allFiles = [...(config.files ?? []), ...(config.configFiles ?? [])];
  }

  // -------------------------------------------------------------------------
  // detect — checks all managed files in the game dir
  // -------------------------------------------------------------------------

  async detect(gameInstallDir: string): Promise<ToolDetectionResult> {
    const fileStatus: Record<string, boolean> = {};

    for (const mf of this.allFiles) {
      const targetPath = `${gameInstallDir}\\${mf.target}`;
      fileStatus[mf.target] = await extensionFileExists(targetPath);
    }

    const total = this.allFiles.length;
    const present = Object.values(fileStatus).filter(Boolean).length;

    const hasExecutable = !!this.config.executable;
    const exePresent = hasExecutable
      ? await extensionFileExists(`${gameInstallDir}\\${this.config.executable!}`)
      : true;

    let applied: boolean;
    if (total === 0 && hasExecutable) {
      // executable-only tool: applied if exe present (or if output file exists)
      applied = exePresent;
    } else {
      const required = this.allFiles.filter((f) => f.required !== false);
      applied = required.length > 0 && required.every((f) => fileStatus[f.target]);
    }

    return {
      applied,
      fileStatus,
      message: applied
        ? `${present}/${total} files present`
        : `${present}/${total} files present (not applied)`,
    };
  }

  // -------------------------------------------------------------------------
  // apply — branches on toolConfig
  // -------------------------------------------------------------------------

  async apply(
    gameInstallDir: string,
    extensionInstallDir: string,
  ): Promise<ToolApplyResult> {
    const appIdMatch = gameInstallDir.match(/\\(\d+)$/);
    const appId = appIdMatch?.[1] ?? "unknown";

    try {
      // 1. Executable mode (Steamless)
      if (this.config.executable && !this.config.usesIndex) {
        toolLog(`applyWithExecutable appId=${appId}`);
        return await this.applyWithExecutable(gameInstallDir, extensionInstallDir);
      }

      // 2. Index mode (Online-Fix)
      if (this.config.usesIndex) {
        toolLog(`applyFromIndex appId=${appId}`);
        return await this.applyFromIndex(appId, gameInstallDir, extensionInstallDir);
      }

      // 3. Default: copy-files / proxy (Goldberg, SmokeAPI)
      toolLog(`applyCopyFiles appId=${appId}`);
      return await this.applyCopyFiles(gameInstallDir, extensionInstallDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolLog(`apply failed: ${message}`);
      await this.writeLog(gameInstallDir, appId, `FAILED: ${message}`);
      return {
        success: false,
        error: message,
        affectedFiles: [],
        rolledBack: false,
      };
    }
  }

  // -------------------------------------------------------------------------
  // revert — restores backups and removes tool files
  // -------------------------------------------------------------------------

  async revert(gameInstallDir: string): Promise<ToolApplyResult> {
    const affectedFiles: string[] = [];

    try {
      const isProxy = this.config.mode === "proxy";

      for (const mf of this.allFiles) {
        const targetPath = `${gameInstallDir}\\${mf.target}`;

        // Proxy mode: restore original from backup (defaults originalName to target)
        if (isProxy) {
          const originalName = mf.originalName ?? mf.target;
          const originalPath = `${gameInstallDir}\\${originalName}`;
          const suffix = mf.backupSuffix ?? this.config.backupSuffix ?? "_o";
          const backupPath = `${originalPath}${suffix}`;

          if (await extensionFileExists(backupPath)) {
            if (await extensionFileExists(targetPath)) {
              await extensionRemoveFile(targetPath);
            }
            await extensionRenameFile(backupPath, originalPath);
            affectedFiles.push(originalName);
            continue;
          }
        }

        // Default backup suffix (e.g. .bak)
        if (this.config.backup) {
          const suffix = mf.backupSuffix ?? this.config.backupSuffix ?? ".bak";
          const backupPath = `${targetPath}${suffix}`;
          if (await extensionFileExists(backupPath)) {
            // Restore by removing the active file and renaming backup
            if (await extensionFileExists(targetPath)) {
              await extensionRemoveFile(targetPath);
            }
            await extensionRenameFile(backupPath, targetPath);
            affectedFiles.push(mf.target);
            continue;
          }
        }

        // Plain copy: just remove the file
        if (await extensionFileExists(targetPath)) {
          await extensionRemoveFile(targetPath);
          affectedFiles.push(mf.target);
        }
      }

      // Clean up: remove log file
      const logPath = `${gameInstallDir}\\luatools-fix-log-${gameInstallDir.match(/\\(\d+)$/)?.[1] ?? "unknown"}.log`;
      if (await extensionFileExists(logPath)) {
        await extensionRemoveFile(logPath);
      }

      return { success: true, affectedFiles };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        affectedFiles,
        rolledBack: false,
      };
    }
  }

  // -------------------------------------------------------------------------
  // applyCopyFiles — default file-copy with optional backup (Goldberg, SmokeAPI)
  // -------------------------------------------------------------------------

  private async applyCopyFiles(
    gameInstallDir: string,
    extensionInstallDir: string,
  ): Promise<ToolApplyResult> {
    const affectedFiles: string[] = [];
    const isProxy = this.config.mode === "proxy";

    // 1. Copy primary files
    for (const file of this.config.files ?? []) {
      const sourcePath = `${extensionInstallDir}\\${file.source}`;
      const targetPath = `${gameInstallDir}\\${file.target}`;

      if (!(await extensionFileExists(sourcePath))) {
        if (file.required !== false) {
          return { success: false, error: `Required source file not found: ${file.source}`, affectedFiles };
        }
        continue;
      }

      // Proxy mode: rename original with suffix (defaults originalName to target)
      if (isProxy) {
        const originalName = file.originalName ?? file.target;
        const originalPath = `${gameInstallDir}\\${originalName}`;
        const suffix = file.backupSuffix ?? this.config.backupSuffix ?? "_o";
        const backupPath = `${originalPath}${suffix}`;

        if (await extensionFileExists(originalPath) && !(await extensionFileExists(backupPath))) {
          await extensionRenameFile(originalPath, backupPath);
          affectedFiles.push(`${originalName}${suffix}`);
        }
      }

      // Plain backup mode: backup target before overwrite
      if (!isProxy && this.config.backup) {
        const suffix = file.backupSuffix ?? this.config.backupSuffix ?? ".bak";
        const backupPath = `${targetPath}${suffix}`;
        if (await extensionFileExists(targetPath) && !(await extensionFileExists(backupPath))) {
          await extensionRenameFile(targetPath, backupPath);
          affectedFiles.push(`${file.target}${suffix}`);
        }
      }

      await extensionCopyFile(sourcePath, targetPath);
      affectedFiles.push(file.target);
    }

    // 2. Copy config files (always, no rename/backup needed)
    for (const file of this.config.configFiles ?? []) {
      const sourcePath = `${extensionInstallDir}\\${file.source}`;
      const targetPath = `${gameInstallDir}\\${file.target}`;

      if (!(await extensionFileExists(sourcePath))) {
        continue;
      }

      await extensionCopyFile(sourcePath, targetPath);
      affectedFiles.push(file.target);
    }

    const appId = gameInstallDir.match(/\\(\d+)$/)?.[1] ?? "unknown";
    await this.writeLog(gameInstallDir, appId,
      `Applied ${this.config.files?.length ?? 0} files, ${this.config.configFiles?.length ?? 0} config files`);

    return { success: true, affectedFiles };
  }

  // -------------------------------------------------------------------------
  // applyWithExecutable — run an executable on the game's main EXE (Steamless)
  // -------------------------------------------------------------------------

  private async applyWithExecutable(
    gameInstallDir: string,
    extensionInstallDir: string,
  ): Promise<ToolApplyResult> {
    const affectedFiles: string[] = [];
    const exeName = this.config.executable!;
    const exeSource = `${extensionInstallDir}\\${exeName}`;
    const exeTarget = `${gameInstallDir}\\${exeName}`;

    // 1. Copy the executable to the game dir
    if (!(await extensionFileExists(exeSource))) {
      return { success: false, error: `Required executable not found: ${exeName}`, affectedFiles };
    }

    await extensionCopyFile(exeSource, exeTarget);
    affectedFiles.push(exeName);

    // 2. Find the main game executable (exclude the tool's own exe and backups)
    const gameExe = await extensionFindLargestExe(gameInstallDir, [exeName]);
    if (!gameExe) {
      return { success: false, error: "No .exe found in game directory", affectedFiles };
    }

    toolLog(`executable mode: running ${exeName} on ${gameExe}`);

    // 3. Run the executable with args (replace {gameExe} placeholder)
    const args = (this.config.args ?? []).map(a => a.replace(/\{gameExe\}/g, gameExe));

    const result = await extensionRunProcess(exeTarget, args);

    if (!result.success) {
      const msg = result.stderr?.trim()
        ? `Process error: ${result.stderr.slice(0, 200)}`
        : `Process exited with code ${result.exitCode}`;
      return { success: false, error: msg, affectedFiles };
    }

    // 4. Handle Steamless output: rename game.exe → game.exe.bak,
    //    then rename game.exe.unpacked.exe → game.exe
    const gameExePath = `${gameInstallDir}\\${gameExe}`;
    const unpackedPath = `${gameInstallDir}\\${gameExe}.unpacked.exe`;
    const steamlessOutput = `${gameInstallDir}\\${gameExe}.Steamless`; // some versions use this

    if (await extensionFileExists(unpackedPath)) {
      const suffix = this.config.backupSuffix ?? ".bak";
      const bakPath = `${gameExePath}${suffix}`;

      // If backup already exists, just replace
      if (await extensionFileExists(bakPath)) {
        await extensionRemoveFile(gameExePath);
      } else {
        await extensionRenameFile(gameExePath, bakPath);
        affectedFiles.push(`${gameExe}${suffix}`);
      }

      await extensionRenameFile(unpackedPath, gameExePath);
      affectedFiles.push(gameExe);
      toolLog(`steamless: unpacked ${gameExe} -> ${gameExe}.bak, replaced with unpacked`);
    } else if (await extensionFileExists(steamlessOutput)) {
      // Alternative output format
      const suffix = this.config.backupSuffix ?? ".bak";
      const bakPath = `${gameExePath}${suffix}`;

      if (await extensionFileExists(bakPath)) {
        await extensionRemoveFile(gameExePath);
      } else {
        await extensionRenameFile(gameExePath, bakPath);
        affectedFiles.push(`${gameExe}${suffix}`);
      }

      await extensionRenameFile(steamlessOutput, gameExePath);
      affectedFiles.push(gameExe);
    }

    const appId = gameInstallDir.match(/\\(\d+)$/)?.[1] ?? "unknown";
    await this.writeLog(gameInstallDir, appId,
      `Applied ${exeName} on ${gameExe}, exit=${result.exitCode}`);

    return { success: true, affectedFiles };
  }

  // -------------------------------------------------------------------------
  // applyFromIndex — fetch remote index, download game-specific fix (Online-Fix)
  // -------------------------------------------------------------------------

  private async applyFromIndex(
    appId: string,
    gameInstallDir: string,
    extensionInstallDir: string,
  ): Promise<ToolApplyResult> {
    const affectedFiles: string[] = [];
    const indexUrl = this.config.indexUrl;

    if (!indexUrl) {
      return { success: false, error: "No index URL configured", affectedFiles };
    }

    toolLog(`index mode: fetching ${indexUrl}`);

    // 1. Fetch the index JSON
    let indexText: string;
    try {
      indexText = await extensionFetchUrlAsText(indexUrl);
    } catch (err) {
      return { success: false, error: `Failed to fetch index: ${err}`, affectedFiles };
    }

    let index: any[];
    try {
      index = JSON.parse(indexText);
    } catch {
      return { success: false, error: "Invalid JSON from index", affectedFiles };
    }

    if (!Array.isArray(index) || index.length === 0) {
      return { success: false, error: "Empty or invalid index", affectedFiles };
    }

    // 2. Find matching entry by appId
    const entry = index.find(
      (e: any) =>
        String(e.steamAppId) === appId ||
        String(e.appId) === appId ||
        String(e.id) === appId,
    );

    if (!entry) {
      return { success: false, error: `No entry found for appId ${appId} in index`, affectedFiles };
    }

    // 3. Determine download URL from the entry
    const downloadUrl = entry.downloadUrl || entry.url || entry.download_url;
    if (!downloadUrl) {
      return { success: false, error: "No download URL in index entry", affectedFiles };
    }

    toolLog(`index mode: found entry, downloading ${downloadUrl}`);

    // 4. Backup existing files
    if (this.config.backup) {
      for (const file of this.config.files ?? []) {
        const targetPath = `${gameInstallDir}\\${file.target}`;
        if (await extensionFileExists(targetPath)) {
          const suffix = file.backupSuffix ?? this.config.backupSuffix ?? ".bak";
          const backupPath = `${targetPath}${suffix}`;
          if (!(await extensionFileExists(backupPath))) {
            await extensionRenameFile(targetPath, backupPath);
            affectedFiles.push(`${file.target}${suffix}`);
          }
        }
      }
    }

    // 5. Download the fix to a temp location, then extract
    const tempDir = `${gameInstallDir}\\.lumaforge-temp`;
    await extensionCreateDir(tempDir);

    const isArchive = downloadUrl.match(/\.(zip|rar|7z)$/i);

    if (isArchive) {
      const zipPath = `${tempDir}\\onlinefix.zip`;
      try {
        await extensionDownloadFile(downloadUrl, zipPath);
        const extracted = await extensionExtractZipAll(zipPath, gameInstallDir);
        affectedFiles.push(...extracted);
        toolLog(`index mode: extracted ${extracted.length} files`);
      } catch (err) {
        // Clean up temp dir
        await extensionRemoveFile(tempDir);
        return { success: false, error: `Failed to download/extract fix: ${err}`, affectedFiles };
      }
    } else {
      // Single file download
      const fileName = downloadUrl.split("/").pop() || "onlinefix.dll";
      const targetPath = `${gameInstallDir}\\${fileName}`;
      try {
        await extensionDownloadFile(downloadUrl, targetPath);
        affectedFiles.push(fileName);
      } catch (err) {
        return { success: false, error: `Failed to download fix file: ${err}`, affectedFiles };
      }
    }

    // 6. Clean up temp dir
    await extensionRemoveFile(tempDir);

    await this.writeLog(gameInstallDir, appId,
      `Applied from index (${affectedFiles.length} files)`);

    return { success: true, affectedFiles };
  }

  // -------------------------------------------------------------------------
  // writeLog — write a diagnostic log file to the game directory
  // -------------------------------------------------------------------------

  private async writeLog(
    gameInstallDir: string,
    appId: string,
    message: string,
  ): Promise<void> {
    try {
      const logPath = `${gameInstallDir}\\luatools-fix-log-${appId}.log`;
      const timestamp = new Date().toISOString();
      const logContent = `[${timestamp}] Tool: ${this.displayName} (${this.id})\n[${timestamp}] ${message}\n`;
      await extensionWriteTextFile(logPath, logContent);
    } catch {
      // Log write failure is non-essential
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Attempt to create a DeclarativeTool for a manifest.
 *
 * Returns a Tool when manifest has metadata.toolConfig.
 * Supports all toolConfig types: copy-files, rename-proxy, executable, index.
 */
export function tryCreateDeclarativeTool(
  manifest: ExtensionManifestV1,
): DeclarativeTool | undefined {
  const config = extractToolConfig(manifest);
  if (!config) return undefined;

  return new DeclarativeTool(manifest, config);
}
