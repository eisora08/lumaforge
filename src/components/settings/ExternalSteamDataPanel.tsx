/**
 * ExternalSteamDataPanel — Settings UI for auditing, reviewing, and exporting
 * Steam Lua scripts, LumaForge achievement data, and depotcache status.
 *
 * Placed in Cloud & Backup below Stored Backups, above Advanced Backup Details.
 *
 *   - Steam Lua Scripts:  audit → review → export → Stored Backups
 *   - LumaForge Achievement Data: audit → review → export → Stored Backups
 *   - Depot Cache: informational only, no actions
 *
 * Restore is NOT provided here — it goes through the existing
 * Stored Backups → Preview → ConfirmModal → restore pipeline.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Code,
  Trophy,
  HardDrive,
  ChevronDown,
  ChevronRight,
  Loader2,
  FileArchive,
  FolderOpen,
  Info,
  FileCode,
  Eye,
  ShieldCheck,
  Database,
} from "lucide-react";

import {
  writeBackupArchive,
  resolveAchievementsRootDir,
} from "../../services/tauri";

import {
  auditLuaScripts,
  readLuaFilesContent,
  LUA_MAX_FILE_SIZE,
  LUA_MAX_FILES,
  type LuaAuditEntry,
  type LuaAuditResult,
} from "../../services/steamLuaAuditor";

import {
  LUA_BACKUP_PREFIX,
} from "../../services/steamLuaBackupService";

import {
  auditAchievementData,
  readAchievementFilesContent,
  ACHIEVEMENT_MAX_FILE_SIZE,
  ACHIEVEMENT_MAX_FILES,
  type AchievementAuditEntry,
  type AchievementAuditResult,
} from "../../services/steamAchievementAuditor";

import {
  ACHIEVEMENT_BACKUP_PREFIX,
} from "../../services/steamAchievementBackupService";

import {
  isPathSafe,
  isExecutablePath,
  isBlockedPath,
  sha256,
  buildBackupManifest,
} from "../../services/localBackupService";

import { loadSettings } from "../../context/SettingsContext";

import {
  auditSteamAchievementSources,
  buildGameSummaries,
  checkSteamRunning,
  clearAchSourceCache,
  exportSteamAchievementSourcesToArchive,
  type VerifiedSourcesManifest,
  type AchSourceGameSummary,
} from "../../services/steamAchievementSources";

// ── Helpers ──

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Types ──

type LuaRootStatus = "available" | "missing" | "unconfigured" | "loading" | "error";
type AchRootStatus = "available" | "missing" | "loading" | "error";

interface LuaReviewState {
  open: boolean;
  entries: LuaAuditEntry[];
  selected: Set<string>;
  allSafePaths: string[];
}

interface AchReviewState {
  open: boolean;
  gameSummaries: AchGameSummary[];
  selected: Set<string>;
}

interface AchGameSummary {
  appId: string;
  files: AchievementAuditEntry[];
  totalSize: number;
  types: Set<string>;
}

// ── Component ──

export default function ExternalSteamDataPanel() {
  // ── Lua state ──
  const [luaRootStatus, setLuaRootStatus] = useState<LuaRootStatus>("loading");
  const [luaRoot, setLuaRoot] = useState<string>("");
  const [luaAuditing, setLuaAuditing] = useState(false);
  const [luaResult, setLuaResult] = useState<LuaAuditResult | null>(null);
  const [luaLastAudit, setLuaLastAudit] = useState<string>("");
  const [luaExporting, setLuaExporting] = useState(false);
  const [luaExportResult, setLuaExportResult] = useState<{ success: boolean; fileCount: number; totalSize: number } | null>(null);
  const [luaReview, setLuaReview] = useState<LuaReviewState>({
    open: false,
    entries: [],
    selected: new Set(),
    allSafePaths: [],
  });

  // ── Achievement state ──
  const [achRootStatus, setAchRootStatus] = useState<AchRootStatus>("loading");
  const [achRoot, setAchRoot] = useState<string>("");
  const [achAuditing, setAchAuditing] = useState(false);
  const [achResult, setAchResult] = useState<AchievementAuditResult | null>(null);
  const [achLastAudit, setAchLastAudit] = useState<string>("");
  const [achExporting, setAchExporting] = useState(false);
  const [achExportResult, setAchExportResult] = useState<{ success: boolean; gameCount: number; fileCount: number; totalSize: number } | null>(null);
  const [achReview, setAchReview] = useState<AchReviewState>({
    open: false,
    gameSummaries: [],
    selected: new Set(),
  });

  // ── Depotcache state (informational) ──
  const [depotcacheExpanded, setDepotcacheExpanded] = useState(false);

  // ── Verified Steam Achievement Sources state ──
  const [achSourceManifest, setAchSourceManifest] = useState<VerifiedSourcesManifest | null>(null);
  const [achSourceAuditing, setAchSourceAuditing] = useState(false);
  const [achSourceAuditTime, setAchSourceAuditTime] = useState("");
  const [achSourceReviewOpen, setAchSourceReviewOpen] = useState(false);
  const [achSourceGameSummaries, setAchSourceGameSummaries] = useState<AchSourceGameSummary[]>([]);
  const [achSourceSelected, setAchSourceSelected] = useState<Set<string>>(new Set());
  const [achSourceExporting, setAchSourceExporting] = useState(false);
  const [achSourceExportResult, setAchSourceExportResult] = useState<{
    success: boolean;
    gameCount: number;
    fileCount: number;
    totalSize: number;
  } | null>(null);
  const [achSourceSteamRunning, setAchSourceSteamRunning] = useState<boolean | null>(null);

  // ── Boot: resolve roots ──
  const bootRan = useRef(false);
  useEffect(() => {
    if (bootRan.current) return;
    bootRan.current = true;

    (async () => {
      // Lua root
      try {
        const settings = loadSettings();
        const luaPath = typeof settings.luaPath === "string" ? settings.luaPath : "";
        if (!luaPath) {
          setLuaRootStatus("unconfigured");
        } else {
          setLuaRoot(luaPath);
          setLuaRootStatus("available");
        }
      } catch {
        setLuaRootStatus("error");
      }

      // Achievement root
      try {
        const root = await resolveAchievementsRootDir("steam");
        if (root) {
          setAchRoot(root);
          setAchRootStatus("available");
        } else {
          setAchRootStatus("missing");
        }
      } catch {
        setAchRootStatus("error");
      }
    })();
  }, []);

  // ── Lua handlers ──

  const handleLuaAudit = useCallback(async () => {
    if (luaRootStatus !== "available" || !luaRoot) return;
    setLuaAuditing(true);
    setLuaResult(null);
    try {
      const result = await auditLuaScripts(luaRoot);
      setLuaResult(result);
      setLuaLastAudit(new Date().toLocaleString());
    } catch (err) {
      setLuaResult({
        luaFiles: [],
        providerStatusFiles: [],
        totalLuaFiles: 0,
        totalProviderStatusFiles: 0,
        totalSize: 0,
        entries: [],
        errors: [`Audit failed: ${err}`],
        warnings: [],
      });
      setLuaLastAudit(new Date().toLocaleString());
    } finally {
      setLuaAuditing(false);
    }
  }, [luaRoot, luaRootStatus]);

  const handleLuaReviewOpen = useCallback(() => {
    if (!luaResult) return;
    const safe = luaResult.entries.filter((e) => e.safe);
    setLuaReview({
      open: !luaReview.open,
      entries: luaResult.entries,
      selected: new Set(safe.map((e) => e.relativePath)),
      allSafePaths: safe.map((e) => e.relativePath),
    });
  }, [luaResult, luaReview.open]);

  const handleLuaSelectAll = useCallback(() => {
    setLuaReview((prev) => ({
      ...prev,
      selected: new Set(prev.allSafePaths),
    }));
  }, []);

  const handleLuaClearSelection = useCallback(() => {
    setLuaReview((prev) => ({
      ...prev,
      selected: new Set(),
    }));
  }, []);

  const handleLuaToggleFile = useCallback((path: string) => {
    setLuaReview((prev) => {
      const next = new Set(prev.selected);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { ...prev, selected: next };
    });
  }, []);

  const handleLuaExport = useCallback(async () => {
    if (luaReview.selected.size === 0 || !luaRoot) return;
    setLuaExporting(true);
    setLuaExportResult(null);
    try {
      const selectedPaths = Array.from(luaReview.selected);
      const contentMap = await readLuaFilesContent(luaRoot, selectedPaths);
      if (!contentMap || Object.keys(contentMap).length === 0) {
        setLuaExportResult({ success: false, fileCount: 0, totalSize: 0 });
        return;
      }

      const fileEntries: Array<{ relativePath: string; section: string; size: number; checksum: string }> = [];
      const allFiles: Array<{ relativePath: string; section: string; data: string }> = [];
      let totalSize = 0;

      for (const [relPath, data] of Object.entries(contentMap)) {
        const archivePath = `${LUA_BACKUP_PREFIX}${relPath}`;
        if (!isPathSafe(archivePath) || isExecutablePath(archivePath) || isBlockedPath(archivePath)) continue;

        const dataBytes = new TextEncoder().encode(data);
        const size = dataBytes.length;
        const checksum = await sha256(data);

        allFiles.push({ relativePath: archivePath, section: "steamLua", data });
        fileEntries.push({ relativePath: archivePath, section: "steamLua", size, checksum });
        totalSize += size;
      }

      if (allFiles.length === 0) {
        setLuaExportResult({ success: false, fileCount: 0, totalSize: 0 });
        return;
      }

      const manifest = await buildBackupManifest(
        ["steamLua"],
        fileEntries,
      );

      const exportData = JSON.stringify({ manifest, data: Object.fromEntries(allFiles.map((f) => [f.relativePath, f.data])) }, null, 2);
      const filename = `lumaforge-backup-${manifest.backupId}.json`;
      await writeBackupArchive(exportData, filename);

      setLuaExportResult({ success: true, fileCount: allFiles.length, totalSize });

      // Clear review after export
      setLuaReview({ open: false, entries: [], selected: new Set(), allSafePaths: [] });
    } catch (err) {
      console.error("[EXTERNAL_DATA][LUA_EXPORT] failed:", err);
      setLuaExportResult({ success: false, fileCount: 0, totalSize: 0 });
    } finally {
      setLuaExporting(false);
    }
  }, [luaReview.selected, luaRoot]);

  // ── Achievement handlers ──

  const handleAchAudit = useCallback(async () => {
    if (achRootStatus !== "available" || !achRoot) return;
    setAchAuditing(true);
    setAchResult(null);
    try {
      const result = await auditAchievementData(achRoot);
      setAchResult(result);
      setAchLastAudit(new Date().toLocaleString());
    } catch (err) {
      setAchResult({
        files: [],
        totalFiles: 0,
        totalSize: 0,
        entries: [],
        appIds: [],
        errors: [`Audit failed: ${err}`],
        warnings: [],
      });
      setAchLastAudit(new Date().toLocaleString());
    } finally {
      setAchAuditing(false);
    }
  }, [achRoot, achRootStatus]);

  const buildAchGameSummaries = useCallback((result: AchievementAuditResult): AchGameSummary[] => {
    const byApp = new Map<string, AchievementAuditEntry[]>();
    for (const entry of result.entries) {
      if (!entry.safe) continue;
      const existing = byApp.get(entry.appId) || [];
      existing.push(entry);
      byApp.set(entry.appId, existing);
    }

    const summaries: AchGameSummary[] = [];
    for (const [appId, files] of byApp) {
      const types = new Set(files.map((f) => f.category));
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      summaries.push({ appId, files, totalSize, types });
    }
    return summaries.sort((a, b) => a.appId.localeCompare(b.appId));
  }, []);

  const handleAchReviewOpen = useCallback(() => {
    if (!achResult) return;
    const summaries = buildAchGameSummaries(achResult);
    setAchReview({
      open: !achReview.open,
      gameSummaries: summaries,
      selected: new Set(summaries.map((s) => s.appId)),
    });
  }, [achResult, achReview.open, buildAchGameSummaries]);

  const handleAchSelectAll = useCallback(() => {
    setAchReview((prev) => ({
      ...prev,
      selected: new Set(prev.gameSummaries.map((s) => s.appId)),
    }));
  }, []);

  const handleAchClearSelection = useCallback(() => {
    setAchReview((prev) => ({
      ...prev,
      selected: new Set(),
    }));
  }, []);

  const handleAchToggleGame = useCallback((appId: string) => {
    setAchReview((prev) => {
      const next = new Set(prev.selected);
      if (next.has(appId)) next.delete(appId);
      else next.add(appId);
      return { ...prev, selected: next };
    });
  }, []);

  const handleAchExport = useCallback(async () => {
    if (achReview.selected.size === 0 || !achRoot) return;
    setAchExporting(true);
    setAchExportResult(null);
    try {
      const selectedAppIds = Array.from(achReview.selected);
      const allSafePaths: string[] = [];

      for (const summary of achReview.gameSummaries.filter((s) => selectedAppIds.includes(s.appId))) {
        for (const entry of summary.files) {
          allSafePaths.push(entry.relativePath);
        }
      }

      if (allSafePaths.length === 0) {
        setAchExportResult({ success: false, gameCount: 0, fileCount: 0, totalSize: 0 });
        return;
      }

      const contentMap = await readAchievementFilesContent(achRoot, allSafePaths);
      if (!contentMap || Object.keys(contentMap).length === 0) {
        setAchExportResult({ success: false, gameCount: 0, fileCount: 0, totalSize: 0 });
        return;
      }

      const fileEntries: Array<{ relativePath: string; section: string; size: number; checksum: string }> = [];
      const allFiles: Array<{ relativePath: string; section: string; data: string }> = [];
      let totalSize = 0;

      for (const [relPath, data] of Object.entries(contentMap)) {
        const archivePath = `${ACHIEVEMENT_BACKUP_PREFIX}${relPath}`;
        if (!isPathSafe(archivePath) || isExecutablePath(archivePath) || isBlockedPath(archivePath)) continue;

        const dataBytes = new TextEncoder().encode(data);
        const size = dataBytes.length;
        const checksum = await sha256(data);

        allFiles.push({ relativePath: archivePath, section: "steamAchievementInputs", data });
        fileEntries.push({ relativePath: archivePath, section: "steamAchievementInputs", size, checksum });
        totalSize += size;
      }

      if (allFiles.length === 0) {
        setAchExportResult({ success: false, gameCount: 0, fileCount: 0, totalSize: 0 });
        return;
      }

      const manifest = await buildBackupManifest(
        ["steamAchievementInputs"],
        fileEntries,
      );

      const exportData = JSON.stringify({ manifest, data: Object.fromEntries(allFiles.map((f) => [f.relativePath, f.data])) }, null, 2);
      const filename = `lumaforge-backup-${manifest.backupId}.json`;
      await writeBackupArchive(exportData, filename);

      setAchExportResult({ success: true, gameCount: selectedAppIds.length, fileCount: allFiles.length, totalSize });

      setAchReview({ open: false, gameSummaries: [], selected: new Set() });
    } catch (err) {
      console.error("[EXTERNAL_DATA][ACH_EXPORT] failed:", err);
      setAchExportResult({ success: false, gameCount: 0, fileCount: 0, totalSize: 0 });
    } finally {
      setAchExporting(false);
    }
  }, [achReview.selected, achRoot, achReview.gameSummaries]);

  // ── Verified Steam Achievement Sources handlers ──

  const handleAchSourceAudit = useCallback(async () => {
    setAchSourceAuditing(true);
    setAchSourceManifest(null);
    try {
      const settings = loadSettings();
      const manifest = await auditSteamAchievementSources(
        settings.steamRoot || undefined,
        settings.steamAccountId || undefined,
      );
      setAchSourceManifest(manifest);
      const summaries = buildGameSummaries(manifest);
      setAchSourceGameSummaries(summaries);
      setAchSourceSelected(new Set());
      setAchSourceAuditTime(new Date().toLocaleString());

      // Check Steam process status
      try {
        const steamCheck = await checkSteamRunning();
        setAchSourceSteamRunning(steamCheck.running);
      } catch {
        setAchSourceSteamRunning(null);
      }
    } catch (err) {
      setAchSourceManifest(null);
      setAchSourceGameSummaries([]);
      setAchSourceAuditTime(new Date().toLocaleString());
      setAchSourceSteamRunning(null);
    } finally {
      setAchSourceAuditing(false);
    }
  }, []);

  const handleAchSourceToggleGame = useCallback((appId: string) => {
    setAchSourceSelected((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) next.delete(appId);
      else next.add(appId);
      return next;
    });
  }, []);

  const handleAchSourceSelectAll = useCallback(() => {
    setAchSourceSelected(new Set(achSourceGameSummaries.map((s) => s.appId)));
  }, [achSourceGameSummaries]);

  const handleAchSourceClearSelection = useCallback(() => {
    setAchSourceSelected(new Set());
  }, []);

  const handleAchSourceExport = useCallback(async () => {
    if (achSourceSelected.size === 0) return;
    setAchSourceExporting(true);
    setAchSourceExportResult(null);
    try {
      const settings = loadSettings();
      const result = await exportSteamAchievementSourcesToArchive(
        Array.from(achSourceSelected),
        settings.steamRoot || undefined,
        settings.steamAccountId || undefined,
      );
      setAchSourceExportResult(result);
      if (result.success) {
        setAchSourceReviewOpen(false);
        clearAchSourceCache();
      }
    } catch (err) {
      console.error("[ACH_SOURCE][EXPORT] failed:", err);
      setAchSourceExportResult({ success: false, gameCount: 0, fileCount: 0, totalSize: 0 });
    } finally {
      setAchSourceExporting(false);
    }
  }, [achSourceSelected]);

  const handleAchSourceRefresh = useCallback(async () => {
    clearAchSourceCache();
    setAchSourceManifest(null);
    setAchSourceGameSummaries([]);
    setAchSourceSelected(new Set());
    setAchSourceExportResult(null);
    await handleAchSourceAudit();
  }, [handleAchSourceAudit]);

  // ── Computed values ──

  const luaAllowed = luaResult?.entries.filter((e) => e.safe) ?? [];
  const luaRejected = luaResult?.entries.filter((e) => !e.safe) ?? [];
  const rejectionReasons = [...new Set(luaRejected.map((e) => e.reason || "Unknown").slice(0, 5))];

  const achEntries = achResult?.entries ?? [];
  const achSafe = achEntries.filter((e) => e.safe);
  const achRejected = achEntries.filter((e) => !e.safe);
  const achAchievementsCount = achSafe.filter((e) => e.category === "achievements").length;
  const achPercentagesCount = achSafe.filter((e) => e.category === "percentages").length;
  const achImageSourcesCount = achSafe.filter((e) => e.category === "image-sources").length;

  // ── Render ──

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-1">
        <FolderOpen className="h-4 w-4 text-(--color-accent)" />
        <div>
          <h3 className="text-sm font-bold text-(--color-text)">External Steam Data</h3>
          <p className="text-[10px] text-(--color-muted)">
            Audit, review, and export Steam Lua scripts and LumaForge achievement data.
            Restore is available through Stored Backups.
          </p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          CARD 1 — Steam Lua Scripts
          ═══════════════════════════════════════════ */}
      <div className="lf-surface rounded-2xl border p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/15 text-violet-400">
            <Code className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-(--color-text)">Steam Lua Scripts</h4>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Partial</span>
            </div>
            <p className="text-[10px] text-(--color-muted)">
              Lua scripts and provider-status files from the configured Steam Lua directory.
            </p>
          </div>
        </div>

        {/* Root status */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <p className="text-(--color-muted)">Lua Root</p>
            <p className={`font-medium ${
              luaRootStatus === "available" ? "text-emerald-400" :
              luaRootStatus === "unconfigured" ? "text-amber-400" :
              luaRootStatus === "missing" ? "text-red-400" :
              luaRootStatus === "loading" ? "text-(--color-muted)" :
              "text-red-400"
            }`}>
              {luaRootStatus === "available" ? "Available" :
               luaRootStatus === "unconfigured" ? "Not configured" :
               luaRootStatus === "missing" ? "Missing" :
               luaRootStatus === "loading" ? "Checking..." : "Error"}
            </p>
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <p className="text-(--color-muted)">Last Audit</p>
            <p className="font-medium text-(--color-text)">{luaLastAudit || "—"}</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <p className="text-(--color-muted)">Allowed Files</p>
            <p className="font-medium text-emerald-400">{luaResult ? luaAllowed.length : "—"}</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <p className="text-(--color-muted)">Rejected Files</p>
            <p className={`font-medium ${luaRejected.length > 0 ? "text-red-400" : "text-(--color-text)"}`}>
              {luaResult ? luaRejected.length : "—"}
            </p>
          </div>
        </div>

        {/* Detailed audit info */}
        {luaResult && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">Discovered</p>
              <p className="font-medium text-(--color-text)">{luaResult.totalLuaFiles}</p>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">Total Allowed Size</p>
              <p className="font-medium text-(--color-text)">{formatBytes(luaResult.totalSize)}</p>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">Export Status</p>
              <p className="font-medium text-(--color-muted)">
                {luaExportResult
                  ? (luaExportResult.success ? "✓ Exported" : "Failed")
                  : "—"}
              </p>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">Restore Status</p>
              <p className="font-medium text-(--color-muted)">Via Stored Backups</p>
            </div>
          </div>
        )}

        {/* Rejection reasons */}
        {luaResult && rejectionReasons.length > 0 && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
            <p className="text-[10px] font-medium text-red-400 mb-1">Rejection Reasons</p>
            {rejectionReasons.map((reason, i) => (
              <p key={i} className="text-[10px] text-red-400/80">• {reason}</p>
            ))}
          </div>
        )}

        {/* Errors */}
        {luaResult && luaResult.errors.length > 0 && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
            {luaResult.errors.map((err, i) => (
              <p key={i} className="text-[10px] text-red-400">{err}</p>
            ))}
          </div>
        )}

        {/* Lua review panel */}
        {luaReview.open && (
          <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-(--color-text)">
                File Review ({luaReview.selected.size} selected of {luaReview.allSafePaths.length} safe)
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleLuaSelectAll}
                  className="text-[10px] text-(--color-accent) hover:underline"
                >
                  Select All Safe
                </button>
                <button
                  type="button"
                  onClick={handleLuaClearSelection}
                  className="text-[10px] text-(--color-muted) hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-1">
              {luaResult?.entries.map((entry) => {
                const isRejected = !entry.safe;
                return (
                  <label
                    key={entry.relativePath}
                    className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] ${
                      isRejected ? "opacity-40 cursor-not-allowed" : "hover:bg-white/[0.03] cursor-pointer"
                    }`}
                  >
                    {!isRejected ? (
                      <input
                        type="checkbox"
                        checked={luaReview.selected.has(entry.relativePath)}
                        onChange={() => handleLuaToggleFile(entry.relativePath)}
                        className="rounded border-(--surface-active-border)"
                      />
                    ) : (
                      <div className="h-3.5 w-3.5 rounded border border-red-500/30 bg-red-500/10" />
                    )}
                    <span className={`font-mono flex-1 truncate ${isRejected ? "text-red-400/60" : "text-(--color-text)"}`}>
                      {entry.relativePath}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ${
                      entry.category === "lua-script" ? "bg-emerald-500/15 text-emerald-400" :
                      entry.category === "lua-disabled" ? "bg-amber-500/15 text-amber-400" :
                      "bg-zinc-500/15 text-zinc-500"
                    }`}>
                      {entry.category}
                    </span>
                    <span className="text-[10px] text-(--color-muted) w-16 text-right shrink-0">
                      {formatBytes(entry.size)}
                    </span>
                  </label>
                );
              })}
            </div>

            {luaReview.allSafePaths.length > 0 && (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={luaExporting || luaReview.selected.size === 0}
                  onClick={handleLuaExport}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-violet-500/20 px-3 py-1.5 text-[11px] font-bold text-violet-400 transition hover:bg-violet-500/30 disabled:opacity-50"
                >
                  {luaExporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileArchive className="h-3 w-3" />}
                  {luaExporting ? "Exporting..." : `Export Selected (${luaReview.selected.size})`}
                </button>
                <button
                  type="button"
                  onClick={handleLuaReviewOpen}
                  className="text-[10px] text-(--color-muted) hover:text-(--color-text) transition"
                >
                  Close Review
                </button>
              </div>
            )}
          </div>
        )}

        {/* Export result */}
        {luaExportResult && (
          <div className={`rounded-lg border px-3 py-2 text-[11px] ${
            luaExportResult.success
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}>
            {luaExportResult.success
              ? `Exported ${luaExportResult.fileCount} file(s) (${formatBytes(luaExportResult.totalSize)}) — added to Stored Backups`
              : "Export failed — no files were exported"}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={luaAuditing || luaRootStatus !== "available"}
            onClick={handleLuaAudit}
            className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-[11px] font-medium text-violet-400 transition hover:bg-violet-500/20 disabled:opacity-50"
          >
            {luaAuditing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileCode className="h-3 w-3" />}
            {luaAuditing ? "Auditing..." : "Audit Files"}
          </button>
          <button
            type="button"
            disabled={!luaResult || luaResult.entries.length === 0}
            onClick={handleLuaReviewOpen}
            className="inline-flex items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-[11px] font-medium text-(--color-text) transition hover:bg-white/10 disabled:opacity-50"
          >
            <Eye className="h-3 w-3" />
            Review Allowed Files
          </button>
          <button
            type="button"
            disabled={luaReview.selected.size === 0 || luaExporting}
            onClick={handleLuaExport}
            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-500/20 px-3 py-1.5 text-[11px] font-bold text-violet-400 transition hover:bg-violet-500/30 disabled:opacity-50"
          >
            {luaExporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileArchive className="h-3 w-3" />}
            Export Selected Files
          </button>
        </div>

        {/* Limits */}
        <p className="text-[9px] text-(--color-muted)">
          Limits: {LUA_MAX_FILE_SIZE / 1024} KB per file, {LUA_MAX_FILES} max files.
          Extensions: .lua, .lua.disabled only. Paths are relative — personal paths are not exposed.
        </p>
      </div>

      {/* ═══════════════════════════════════════════
          CARD 2 — LumaForge Achievement Data
          ═══════════════════════════════════════════ */}
      <div className="lf-surface rounded-2xl border p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
            <Trophy className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-(--color-text)">LumaForge Achievement Data</h4>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Partial</span>
            </div>
            <p className="text-[10px] text-(--color-muted)">
              Backs up achievement records maintained by LumaForge. Steam-owned appcache, userdata, librarycache, login data, and achievement icons are not included.
            </p>
          </div>
        </div>

        {/* Root status */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <p className="text-(--color-muted)">Root Status</p>
            <p className={`font-medium ${
              achRootStatus === "available" ? "text-emerald-400" :
              achRootStatus === "missing" ? "text-red-400" :
              "text-(--color-muted)"
            }`}>
              {achRootStatus === "available" ? "Available" :
               achRootStatus === "missing" ? "Missing" :
               achRootStatus === "loading" ? "Checking..." : "Error"}
            </p>
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <p className="text-(--color-muted)">Last Audit</p>
            <p className="font-medium text-(--color-text)">{achLastAudit || "—"}</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <p className="text-(--color-muted)">Game Directories</p>
            <p className="font-medium text-emerald-400">{achResult ? achResult.appIds.length : "—"}</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <p className="text-(--color-muted)">Rejected Files</p>
            <p className={`font-medium ${achRejected.length > 0 ? "text-red-400" : "text-(--color-text)"}`}>
              {achResult ? achRejected.length : "—"}
            </p>
          </div>
        </div>

        {/* Detailed audit info */}
        {achResult && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">achievements.json</p>
              <p className="font-medium text-(--color-text)">{achAchievementsCount}</p>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">achievementpercentages.json</p>
              <p className="font-medium text-(--color-text)">{achPercentagesCount}</p>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">image_sources.json</p>
              <p className="font-medium text-(--color-text)">{achImageSourcesCount}</p>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">Total Verified Size</p>
              <p className="font-medium text-(--color-text)">{achResult ? formatBytes(achResult.totalSize) : "—"}</p>
            </div>
          </div>
        )}

        {achResult && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">Total Files</p>
              <p className="font-medium text-(--color-text)">{achResult.totalFiles}</p>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">Export Status</p>
              <p className="font-medium text-(--color-muted)">
                {achExportResult
                  ? (achExportResult.success ? "✓ Exported" : "Failed")
                  : "—"}
              </p>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">Restore Status</p>
              <p className="font-medium text-(--color-muted)">Via Stored Backups</p>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">Rollback Status</p>
              <p className="font-medium text-(--color-muted)">Via Stored Backups</p>
            </div>
          </div>
        )}

        {/* Errors */}
        {achResult && achResult.errors.length > 0 && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
            {achResult.errors.map((err, i) => (
              <p key={i} className="text-[10px] text-red-400">{err}</p>
            ))}
          </div>
        )}

        {/* Achievement review panel */}
        {achReview.open && (
          <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-(--color-text)">
                Game Review ({achReview.selected.size} selected of {achReview.gameSummaries.length} valid)
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAchSelectAll}
                  className="text-[10px] text-(--color-accent) hover:underline"
                >
                  Select All Valid Games
                </button>
                <button
                  type="button"
                  onClick={handleAchClearSelection}
                  className="text-[10px] text-(--color-muted) hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-1">
              {achReview.gameSummaries.map((summary) => (
                <label
                  key={summary.appId}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] hover:bg-white/[0.03] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={achReview.selected.has(summary.appId)}
                    onChange={() => handleAchToggleGame(summary.appId)}
                    className="rounded border-(--surface-active-border)"
                  />
                  <span className="font-mono text-(--color-text) w-20 shrink-0">{summary.appId}</span>
                  <span className="text-[9px] text-(--color-muted) flex-1 truncate">
                    {[...summary.types].join(", ")}
                  </span>
                  <span className="text-[10px] text-(--color-muted) w-12 text-right shrink-0">
                    {summary.files.length} file{summary.files.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-[10px] text-(--color-muted) w-16 text-right shrink-0">
                    {formatBytes(summary.totalSize)}
                  </span>
                </label>
              ))}
            </div>

            {achReview.gameSummaries.length > 0 && (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={achExporting || achReview.selected.size === 0}
                  onClick={handleAchExport}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/20 px-3 py-1.5 text-[11px] font-bold text-amber-400 transition hover:bg-amber-500/30 disabled:opacity-50"
                >
                  {achExporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileArchive className="h-3 w-3" />}
                  {achExporting ? "Exporting..." : `Export Selected (${achReview.selected.size})`}
                </button>
                <button
                  type="button"
                  onClick={handleAchReviewOpen}
                  className="text-[10px] text-(--color-muted) hover:text-(--color-text) transition"
                >
                  Close Review
                </button>
              </div>
            )}
          </div>
        )}

        {/* Export result */}
        {achExportResult && (
          <div className={`rounded-lg border px-3 py-2 text-[11px] ${
            achExportResult.success
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}>
            {achExportResult.success
              ? `Exported ${achExportResult.gameCount} game(s), ${achExportResult.fileCount} file(s) (${formatBytes(achExportResult.totalSize)}) — added to Stored Backups`
              : "Export failed — no data was exported"}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={achAuditing || achRootStatus !== "available"}
            onClick={handleAchAudit}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-medium text-amber-400 transition hover:bg-amber-500/20 disabled:opacity-50"
          >
            {achAuditing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trophy className="h-3 w-3" />}
            {achAuditing ? "Auditing..." : "Audit Data"}
          </button>
          <button
            type="button"
            disabled={!achResult || achResult.appIds.length === 0}
            onClick={handleAchReviewOpen}
            className="inline-flex items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-[11px] font-medium text-(--color-text) transition hover:bg-white/10 disabled:opacity-50"
          >
            <Eye className="h-3 w-3" />
            Review Records
          </button>
          <button
            type="button"
            disabled={achReview.selected.size === 0 || achExporting}
            onClick={handleAchExport}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/20 px-3 py-1.5 text-[11px] font-bold text-amber-400 transition hover:bg-amber-500/30 disabled:opacity-50"
          >
            {achExporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileArchive className="h-3 w-3" />}
            Export Selected Data
          </button>
        </div>

        {/* Limits */}
        <p className="text-[9px] text-(--color-muted)">
          Limits: {ACHIEVEMENT_MAX_FILE_SIZE / (1024 * 1024)} MB per file, {ACHIEVEMENT_MAX_FILES} max files.
          Only LumaForge-owned JSON files (achievements.json, percentages.json, image_sources.json). Icons, Steam userdata, and account IDs are excluded.
        </p>
      </div>

      {/* ═══════════════════════════════════════════
          CARD 2.5 — Verified Steam Achievement Sources
          ═══════════════════════════════════════════ */}
      <div className="lf-surface rounded-2xl border p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-400">
            <Database className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-(--color-text)">Verified Steam Achievement Sources</h4>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400">Partial</span>
            </div>
            <p className="text-[10px] text-(--color-muted)">
              Steam-owned achievement source files (appcache stats, library cache). Only the three verified file types that LumaForge reads are included. Account ID and Steam userdata are never exposed.
            </p>
          </div>
        </div>

        {/* Status row — split source counts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <p className="text-(--color-muted)">Games Found</p>
            <p className="font-medium text-emerald-400">{achSourceManifest ? achSourceManifest.totalGames : "—"}</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <p className="text-(--color-muted)">Total Files</p>
            <p className="font-medium text-(--color-text)">{achSourceManifest ? achSourceManifest.totalFiles : "—"}</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <p className="text-(--color-muted)">Total Size</p>
            <p className="font-medium text-(--color-text)">{achSourceManifest ? formatBytes(achSourceManifest.totalSize) : "—"}</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <p className="text-(--color-muted)">Steam Running</p>
            <p className={`font-medium ${
              achSourceSteamRunning === true ? "text-amber-400" :
              achSourceSteamRunning === false ? "text-emerald-400" :
              "text-(--color-muted)"
            }`}>
              {achSourceSteamRunning === true ? "Yes (close to restore)" :
               achSourceSteamRunning === false ? "No (safe)" :
               "—"}
            </p>
          </div>
        </div>

        {/* Per-source counts */}
        {achSourceManifest && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">UserGameStats</p>
              <p className="font-medium text-cyan-400">{achSourceManifest.statsCount}</p>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">Stats Schema</p>
              <p className="font-medium text-violet-400">{achSourceManifest.schemaCount}</p>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">Library Cache</p>
              <p className="font-medium text-amber-400">{achSourceManifest.librarycacheCount}</p>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">Rejected Files</p>
              <p className={`font-medium ${achSourceManifest.rejected.length > 0 ? "text-red-400" : "text-emerald-400"}`}>
                {achSourceManifest.rejected.length}
              </p>
            </div>
          </div>
        )}

        {/* Audit time */}
        {achSourceAuditTime && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">Last Audit</p>
              <p className="font-medium text-(--color-text)">{achSourceAuditTime}</p>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">Account Scope</p>
              <p className="font-medium text-(--color-text)">{achSourceManifest?.accountScope || "—"}</p>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">Export Status</p>
              <p className="font-medium text-(--color-muted)">
                {achSourceExportResult
                  ? (achSourceExportResult.success ? "✓ Exported" : "Failed")
                  : "—"}
              </p>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-(--color-muted)">Restore Status</p>
              <p className="font-medium text-(--color-muted)">Via Stored Backups</p>
            </div>
          </div>
        )}

        {/* Steam safety warning */}
        {achSourceSteamRunning === true && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <p className="text-[10px] font-medium text-amber-400">⚠ Steam is running</p>
            <p className="text-[10px] text-amber-400/80">
              Achievement source files may be locked. Close Steam before restoring from a backup.
              Export is safe while Steam is running.
            </p>
          </div>
        )}

        {/* Rejected files summary */}
        {achSourceManifest && achSourceManifest.rejected.length > 0 && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
            <p className="text-[10px] font-medium text-red-400">
              {achSourceManifest.rejected.length} file(s) rejected
            </p>
            <p className="text-[10px] text-red-400/80">
              {achSourceManifest.rejected.slice(0, 5).map((r) => r.fileName).join(", ")}
              {achSourceManifest.rejected.length > 5 && ` +${achSourceManifest.rejected.length - 5} more`}
              {" — "}reasons: {[...new Set(achSourceManifest.rejected.map((r) => r.reason))].join(", ")}
            </p>
          </div>
        )}

        {/* Export result */}
        {achSourceExportResult && (
          <div className={`rounded-lg border px-3 py-2 text-[11px] ${
            achSourceExportResult.success
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}>
            {achSourceExportResult.success
              ? `Exported ${achSourceExportResult.gameCount} game(s), ${achSourceExportResult.fileCount} file(s) (${formatBytes(achSourceExportResult.totalSize)}) — added to Stored Backups`
              : "Export failed — no files were exported"}
          </div>
        )}

        {/* Review panel */}
        {achSourceReviewOpen && achSourceGameSummaries.length > 0 && (
          <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-(--color-text)">
                Game Review ({achSourceSelected.size} selected of {achSourceGameSummaries.length} verified)
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAchSourceSelectAll}
                  className="text-[10px] text-(--color-accent) hover:underline"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={handleAchSourceClearSelection}
                  className="text-[10px] text-(--color-muted) hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-1">
              {achSourceGameSummaries.map((summary) => (
                <label
                  key={summary.appId}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] hover:bg-white/[0.03] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={achSourceSelected.has(summary.appId)}
                    onChange={() => handleAchSourceToggleGame(summary.appId)}
                    className="rounded border-(--surface-active-border)"
                  />
                  <span className="font-mono text-(--color-text) w-20 shrink-0">{summary.appId}</span>
                  <span className="flex items-center gap-1 text-[9px] shrink-0">
                    {summary.hasStats && <span className="px-1 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400">Stats</span>}
                    {summary.hasSchema && <span className="px-1 py-0.5 rounded-full bg-violet-500/15 text-violet-400">Schema</span>}
                    {summary.hasLibraryCache && <span className="px-1 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Cache</span>}
                  </span>
                  <span className="text-[10px] text-(--color-muted) w-12 text-right shrink-0">
                    {summary.files.length} file{summary.files.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-[10px] text-(--color-muted) w-16 text-right shrink-0">
                    {formatBytes(summary.totalSize)}
                  </span>
                </label>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={achSourceExporting || achSourceSelected.size === 0}
                onClick={handleAchSourceExport}
                className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500/20 px-3 py-1.5 text-[11px] font-bold text-cyan-400 transition hover:bg-cyan-500/30 disabled:opacity-50"
              >
                {achSourceExporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileArchive className="h-3 w-3" />}
                {achSourceExporting ? "Exporting..." : `Export Selected (${achSourceSelected.size})`}
              </button>
              <button
                type="button"
                onClick={() => setAchSourceReviewOpen(false)}
                className="text-[10px] text-(--color-muted) hover:text-(--color-text) transition"
              >
                Close Review
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={achSourceAuditing}
            onClick={handleAchSourceAudit}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-medium text-cyan-400 transition hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {achSourceAuditing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />}
            {achSourceAuditing ? "Auditing..." : "Audit Sources"}
          </button>
          <button
            type="button"
            disabled={!achSourceManifest || achSourceGameSummaries.length === 0}
            onClick={() => setAchSourceReviewOpen(!achSourceReviewOpen)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-[11px] font-medium text-(--color-text) transition hover:bg-white/10 disabled:opacity-50"
          >
            <Eye className="h-3 w-3" />
            Review Games
          </button>
          <button
            type="button"
            disabled={achSourceExporting || achSourceSelected.size === 0}
            onClick={handleAchSourceExport}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500/20 px-3 py-1.5 text-[11px] font-bold text-cyan-400 transition hover:bg-cyan-500/30 disabled:opacity-50"
          >
            {achSourceExporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileArchive className="h-3 w-3" />}
            Export Selected Sources
          </button>
          <button
            type="button"
            disabled={!achSourceManifest}
            onClick={handleAchSourceRefresh}
            className="inline-flex items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-[11px] font-medium text-(--color-text) transition hover:bg-white/10 disabled:opacity-50"
          >
            <Loader2 className="h-3 w-3" />
            Refresh
          </button>
        </div>

        {/* Info */}
        <div className="flex items-start gap-2 text-[10px] text-(--color-muted)">
          <ShieldCheck className="h-3 w-3 shrink-0 mt-0.5" />
          <span>
            Only three verified file types are included: UserGameStats .bin, UserGameStatsSchema .bin, and librarycache .json.
            Account IDs are never exposed in logs or exports. Steam must be closed before restoring.
          </span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          CARD 3 — Depot Cache (informational)
          ═══════════════════════════════════════════ */}
      <div className="lf-surface rounded-2xl border p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-500/15 text-zinc-500">
            <HardDrive className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-(--color-text)">Depot Cache</h4>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-500/15 text-zinc-500">Not Backed Up</span>
            </div>
            <p className="text-[10px] text-(--color-muted)">
              Steam can regenerate depot cache data. LumaForge does not export or restore the complete depotcache directory because stale manifests may be unsafe across installations.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setDepotcacheExpanded(!depotcacheExpanded)}
          className="flex items-center gap-2 text-[10px] text-(--color-muted) hover:text-(--color-text) transition"
        >
          {depotcacheExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {depotcacheExpanded ? "Hide details" : "Why is this not backed up?"}
        </button>

        {depotcacheExpanded && (
          <div className="rounded-lg border border-(--surface-active-border) bg-white/[0.02] px-3 py-2 space-y-1">
            <p className="text-[10px] text-(--color-muted)">
              The depotcache contains Steam download manifests and partial game files. These are managed by Steam
              and can be regenerated by re-downloading the game. Stale manifests from a different installation
              may reference incorrect depot keys or file paths, making them unsafe to restore.
            </p>
            <p className="text-[10px] text-(--color-muted)">
              The depotcache path setting is protected and will never be overwritten during backup restore.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 text-[10px] text-(--color-muted)">
          <Info className="h-3 w-3 shrink-0" />
          <span>No audit, export, or restore actions available. Depotcache is excluded from all backup presets.</span>
        </div>
      </div>
    </div>
  );
}
