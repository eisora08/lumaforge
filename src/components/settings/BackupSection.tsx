/**
 * Backup Section — Settings UI for local backup/export/restore.
 *
 * Shows backup presets, custom section selection, export action,
 * preview display, restore confirmation modal with progress,
 * post-restore runtime refresh, and restart detection.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Download,
  Upload,
  Shield,
  FileArchive,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Trash2,
  HardDrive,
  Info,
  Power,
} from "lucide-react";

import {
  BackupSection as BackupSectionType,
  ALL_BACKUP_SECTIONS,
  SECTION_DISPLAY_NAMES,
  SECTION_AUDIT_STATUS,
  SECTION_AUDIT_NOTES,
  SECTION_READY_COUNT,
  SECTION_PARTIAL_COUNT,
  SECTION_PLACEHOLDER_COUNT,
  BACKUP_PRESETS,
  collectBackupData,
  validateManifestIntegrity,
  SECTION_MERGE_POLICIES,
  BackupManifest,
  BackupPreviewResult,
  BackupWriteSet,
  SectionAuditStatus,
  isLegacyV1WithFullSettings,
  computeWriteSet,
  restoreSectionsSafe,
  createSafetySnapshot,
  RestoreProgressStage,
  detectRestartRequired,
  dispatchRestoreRefreshForSections,
} from "../../services/localBackupService";

import {
  writeBackupArchive,
  readBackupArchive,
  listBackupArchives,
  deleteBackupArchive,
} from "../../services/tauri";

import { restoreLuaFilesFromBackup } from "../../services/steamLuaBackupService";
import { restoreAchievementFilesFromBackup } from "../../services/steamAchievementBackupService";
import { scanInstalledLuaScripts } from "../../services/tauri";

import ConfirmModal from "../common/ConfirmModal";
import ExternalSteamDataPanel from "./ExternalSteamDataPanel";

const DEBUG_BACKUP_PREVIEW = false;
const DEBUG_BACKUP_RESTORE = false;

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortenBackupId(filename: string): string {
  const match = filename.match(/lf-backup-([a-z0-9]+-[a-z0-9]+)/);
  return match ? match[1] : filename.replace("lumaforge-backup-", "").replace(".json", "");
}

const AUDIT_STATUS_STYLES: Record<SectionAuditStatus, { badge: string; label: string }> = {
  implemented: { badge: "bg-emerald-500/15 text-emerald-400", label: "Ready" },
  partial: { badge: "bg-amber-500/15 text-amber-400", label: "Partial" },
  placeholder: { badge: "bg-zinc-500/15 text-zinc-500", label: "Planned" },
};

export default function BackupSection() {
  const [selectedPreset, setSelectedPreset] = useState<string>("essentials");
  const [customSections, setCustomSections] = useState<Set<BackupSectionType>>(
    new Set(["settings", "integrations", "favorites", "profile"])
  );
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{
    success: boolean;
    manifest?: BackupManifest;
    warnings: string[];
    duration: number;
    fileCount: number;
    totalSize: number;
  } | null>(null);
  const [previewResult, setPreviewResult] = useState<BackupPreviewResult | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [storedBackups, setStoredBackups] = useState<string[]>([]);
  const [auditExpanded, setAuditExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [previewLegacyData, setPreviewLegacyData] = useState<Record<string, unknown> | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [selectedRestoreSections, setSelectedRestoreSections] = useState<Set<string> | null>(null);
  const [restoreWriteSet, setRestoreWriteSet] = useState<BackupWriteSet | null>(null);
  const [restoreResult, setRestoreResult] = useState<{ success: boolean; message: string; details?: string } | null>(null);
  const previewPanelRef = useRef<HTMLDivElement>(null);
  const rawPreviewDataRef = useRef<string | null>(null);

  // ── Confirmation modal ──
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [restoreInFlight, setRestoreInFlight] = useState(false);
  const [isLegacyConfirm, setIsLegacyConfirm] = useState(false);

  // ── Progress tracking ──
  const [restoreStage, setRestoreStage] = useState<RestoreProgressStage | null>(null);
  const [stageDetail, setStageDetail] = useState<string>("");

  // ── Restart detection ──
  const [_needsRestart, setNeedsRestart] = useState(false);
  const [showRestartModal, setShowRestartModal] = useState(false);

  // ── Refresh failure tracking ──
  const [refreshFailed, setRefreshFailed] = useState(false);
  const refreshFailedRef = useRef(false);

  useEffect(() => {
    listBackupArchives().then(setStoredBackups).catch(() => {});
  }, []);

  useEffect(() => {
    if (showPreview && previewPanelRef.current) {
      previewPanelRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [showPreview]);

  const activeSections: BackupSectionType[] =
    selectedPreset === "custom"
      ? Array.from(customSections)
      : BACKUP_PRESETS.find((p) => p.id === selectedPreset)?.sections ?? [];

  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportResult(null);
    const start = performance.now();

    try {
      const { manifest, files } = await collectBackupData(activeSections);

      const exportData = JSON.stringify({
        manifest,
        data: Object.fromEntries(files.map((f) => [f.relativePath, f.data])),
      }, null, 2);

      const filename = `lumaforge-backup-${manifest.backupId}.json`;
      await writeBackupArchive(exportData, filename);

      const blob = new Blob([exportData], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const backups = await listBackupArchives().catch(() => []);
      setStoredBackups(backups);

      const duration = performance.now() - start;
      setExportResult({
        success: true,
        manifest,
        warnings: [],
        duration,
        fileCount: manifest.totalFiles,
        totalSize: manifest.totalSize,
      });
    } catch (err) {
      setExportResult({
        success: false,
        warnings: [`Export failed: ${err}`],
        duration: performance.now() - start,
        fileCount: 0,
        totalSize: 0,
      });
    } finally {
      setExporting(false);
    }
  }, [activeSections]);

  const handlePreview = useCallback(async (data: string) => {
    rawPreviewDataRef.current = data;
    try {
      const parsed = JSON.parse(data);

      // Legacy format detection: has `app` + `version` + `settings` but no `manifest`
      const isLegacy = parsed.app === "LumaForge" && typeof parsed.version === "number" && !parsed.manifest;

      if (isLegacy) {
        if (DEBUG_BACKUP_PREVIEW) console.log("[BACKUP][PREVIEW] legacy format detected", { keys: Object.keys(parsed) });

        setPreviewResult({
          valid: true,
          manifest: null,
          conflicts: [],
          warnings: ["Legacy backup: only theme and surface mode can be safely restored. Full settings restore is blocked to protect steamRoot and API keys."],
          unsupportedSections: [],
          error: undefined,
        });
        setPreviewLegacyData(parsed);
        setSelectedRestoreSections(null);
        setRestoreWriteSet(null);
        setShowPreview(true);
        return;
      }

      const manifest: BackupManifest = parsed.manifest;
      const validation = validateManifestIntegrity(manifest);
      const fileData: Record<string, string> = parsed.data ?? {};

      // Detect v1 legacy where Customization exported full settings
      const isV1Legacy = isLegacyV1WithFullSettings(manifest);

      // Determine which sections are restoreable
      const restoreableSections = new Set<string>();
      for (const file of manifest.files) {
        restoreableSections.add(file.section);
      }

      // Compute write-set for all restoreable sections
      const writeSet = computeWriteSet(manifest, fileData, restoreableSections);

      const warnings: string[] = [...validation.errors];
      if (isV1Legacy) {
        warnings.push(
          "Legacy v1 backup: the Customization preset previously exported ALL settings (including steamRoot and API keys). " +
          "Only theme, surface mode, and visual fields will be restored. Critical paths and keys are preserved."
        );
      }

      if (DEBUG_BACKUP_PREVIEW) {
        console.log("[BACKUP][PREVIEW] manifest validated", {
          valid: validation.valid,
          backupId: manifest?.backupId,
          files: manifest?.totalFiles,
          errors: validation.errors,
          writeSetEntries: writeSet.length,
          isV1Legacy,
        });
      }

      setPreviewResult({
        valid: validation.valid,
        manifest,
        conflicts: [],
        warnings,
        unsupportedSections: [],
        error: validation.valid ? undefined : validation.errors.join(", "),
        isLegacyV1: isV1Legacy,
        writeSet,
      });
      setSelectedRestoreSections(restoreableSections);
      setRestoreWriteSet(writeSet);
      setPreviewLegacyData(null);
      setRestoreResult(null);
      setShowPreview(true);
    } catch (err) {
      if (DEBUG_BACKUP_PREVIEW) console.log("[BACKUP][PREVIEW] parse error", { error: String(err) });
      setPreviewResult({
        valid: false,
        manifest: null,
        conflicts: [],
        warnings: [],
        unsupportedSections: [],
        error: `Invalid backup file: ${err}`,
      });
      setShowPreview(true);
    }
  }, []);

  const handleRestore = useCallback(async (data: string) => {
    setRestoreInFlight(true);
    setRestoreResult(null);
    setNeedsRestart(false);
    setRefreshFailed(false);
    refreshFailedRef.current = false;

    try {
      const parsed = JSON.parse(data);

      // Stage 0: Creating safety backup
      setRestoreStage("creating-safety-backup");
      setStageDetail("Creating safety backup before changes");

      // Legacy format: apply theme + surfaceMode only (never full settings)
      const isLegacy = parsed.app === "LumaForge" && typeof parsed.version === "number" && !parsed.manifest;

      if (isLegacy) {
        setRestoreStage("applying-changes");
        setStageDetail("Restoring theme and surface mode");

        // Safety snapshot before any writes
        const allKeys = ["lumaforge-settings", "lumaforge-theme", "lumaforge-surface-mode"];
        const snapshot = createSafetySnapshot(allKeys);

        try {
          if (parsed.theme) localStorage.setItem("lumaforge-theme", parsed.theme);
          if (parsed.surfaceMode) localStorage.setItem("lumaforge-surface-mode", parsed.surfaceMode);
          if (DEBUG_BACKUP_RESTORE) console.log("[BACKUP][RESTORE] legacy restore: theme + surface only");

          setRestoreStage("refreshing-runtime");
          setStageDetail("Applying theme changes");
          dispatchRestoreRefreshForSections(["uiPreferences"]);

          setRestoreStage("complete");
          setRestoreResult({ success: true, message: "Legacy theme and surface mode restored. Full settings were not overwritten." });
          setShowPreview(false);
        } catch (err) {
          for (const [key, value] of Object.entries(snapshot)) {
            if (value === null) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
          }
          setRestoreStage("failed");
          setRestoreResult({ success: false, message: `Legacy restore failed and was rolled back: ${err}` });
        }
        return;
      }

      const manifest: BackupManifest = parsed.manifest;
      const fileData: Record<string, string> = parsed.data ?? {};

      // Stage 1: Validate backup
      setRestoreStage("validating-backup");
      setStageDetail("Checking manifest integrity");
      const validation = validateManifestIntegrity(manifest);
      if (!validation.valid) {
        setRestoreStage("failed");
        setRestoreResult({ success: false, message: `Cannot restore: ${validation.errors.join(", ")}` });
        return;
      }

      // Stage 2: Prepare sections
      setRestoreStage("preparing-sections");
      const sectionsToRestore = selectedRestoreSections ?? new Set(manifest.files.map((f) => f.section));
      setStageDetail(`Preparing ${sectionsToRestore.size} section(s)`);

      // Stage 2.5: Restore external files (Lua scripts + achievement data) to disk via Rust
      // Lua files
      const luaPaths = manifest.files
        .filter((f) => sectionsToRestore.has(f.section) && f.relativePath.startsWith("steam/lua/"))
        .map((f) => f.relativePath);

      if (luaPaths.length > 0) {
        setStageDetail(`Restoring ${luaPaths.length} Lua file(s) to disk`);
        try {
          const luaResult = await restoreLuaFilesFromBackup(fileData, luaPaths);
          if (luaResult.failed > 0) {
            console.warn("[BACKUP][RESTORE] Lua file restore warnings:", luaResult.errors);
          }
          if (DEBUG_BACKUP_RESTORE) {
            console.log("[BACKUP][RESTORE] external Lua files", luaResult);
          }

          // Re-scan Lua directory after restore
          try {
            const settings = JSON.parse(localStorage.getItem("lumaforge-settings") || "{}");
            if (settings.luaPath) {
              await scanInstalledLuaScripts(settings.luaPath);
              if (DEBUG_BACKUP_RESTORE) console.log("[BACKUP][RESTORE] Lua re-scan complete");
            }
          } catch (reScanErr) {
            if (DEBUG_BACKUP_RESTORE) console.log("[BACKUP][RESTORE] Lua re-scan failed (non-fatal)", reScanErr);
          }
        } catch (extErr) {
          console.error("[BACKUP][RESTORE] Lua file restore failed:", extErr);
        }
      }

      // Achievement data files
      const achievementPaths = manifest.files
        .filter((f) => sectionsToRestore.has(f.section) && f.relativePath.startsWith("steam/achievements/"))
        .map((f) => f.relativePath);

      if (achievementPaths.length > 0) {
        setStageDetail(`Restoring ${achievementPaths.length} achievement file(s) to disk`);
        try {
          const achResult = await restoreAchievementFilesFromBackup(fileData, achievementPaths);
          if (achResult.failed > 0) {
            console.warn("[BACKUP][RESTORE] Achievement file restore warnings:", achResult.errors);
          }
          if (DEBUG_BACKUP_RESTORE) {
            console.log("[BACKUP][RESTORE] external achievement files", achResult);
          }
        } catch (achErr) {
          console.error("[BACKUP][RESTORE] Achievement file restore failed:", achErr);
        }
      }

      // Stage 3: Apply changes
      setRestoreStage("applying-changes");
      setStageDetail("Writing data to storage");
      const result = restoreSectionsSafe(manifest, fileData, sectionsToRestore);

      if (DEBUG_BACKUP_RESTORE) console.log("[BACKUP][RESTORE] result", result);

      if (!result.success) {
        setRestoreStage("failed");
        setRestoreResult({
          success: false,
          message: result.error ?? "Restore failed",
          details: result.conflicts.length > 0 ? result.conflicts.join(", ") : undefined,
        });
        return;
      }

      // Stage 4: Refresh runtime stores
      setRestoreStage("refreshing-runtime");
      setStageDetail("Refreshing affected sections");
      try {
        dispatchRestoreRefreshForSections(result.restoredSections);
      } catch (refreshErr) {
        if (DEBUG_BACKUP_RESTORE) console.log("[BACKUP][RESTORE] refresh failed", { error: String(refreshErr) });
        refreshFailedRef.current = true;
        setRefreshFailed(true);
      }

      // Stage 5: Detect restart requirement
      setRestoreStage("validating-state");
      setStageDetail("Checking if restart is needed");
      const requiresRestart = detectRestartRequired(manifest, fileData, sectionsToRestore);
      setNeedsRestart(requiresRestart);

      // Stage 6: Complete
      setRestoreStage("complete");
      const refreshIssue = refreshFailedRef.current;
      setRestoreResult({
        success: true,
        message: refreshIssue
          ? "Backup restored, but LumaForge could not refresh every selected section."
          : `Restore complete: ${result.restoredSections.length} section(s) restored.`,
      });
      setShowPreview(false);

      if (requiresRestart) {
        setShowRestartModal(true);
      }

      // Refresh backup list
      const backups = await listBackupArchives().catch(() => []);
      setStoredBackups(backups);
    } catch (err) {
      setRestoreStage("failed");
      setRestoreResult({ success: false, message: `Restore failed: ${err}` });
    } finally {
      setRestoreInFlight(false);
      // Clear progress after a delay so the user can see "complete"
      setTimeout(() => {
        setRestoreStage(null);
        setStageDetail("");
      }, 3000);
    }
  }, [selectedRestoreSections]);

  const handlePreviewFromDisk = useCallback(async (filename: string) => {
    if (DEBUG_BACKUP_PREVIEW) console.log("[BACKUP][PREVIEW] loading from disk", { filename });
    setPreviewing(filename);
    try {
      const raw = await readBackupArchive(filename);
      rawPreviewDataRef.current = raw;
      if (DEBUG_BACKUP_PREVIEW) console.log("[BACKUP][PREVIEW] read complete", { bytes: raw.length });
      await handlePreview(raw);
    } catch (err) {
      if (DEBUG_BACKUP_PREVIEW) console.log("[BACKUP][PREVIEW] read failed", { filename, error: String(err) });
      setPreviewResult({
        valid: false,
        manifest: null,
        conflicts: [],
        warnings: [],
        unsupportedSections: [],
        error: `Failed to read backup: ${err}`,
      });
      setShowPreview(true);
    } finally {
      setPreviewing(null);
    }
  }, [handlePreview]);

  const handleRestoreFromPreview = useCallback(async () => {
    setIsLegacyConfirm(false);
    setShowRestoreConfirm(true);
  }, []);

  const handleRetryRefresh = useCallback(async () => {
    if (!selectedRestoreSections) return;
    try {
      setRefreshFailed(false);
      refreshFailedRef.current = false;
      setRestoreStage("refreshing-runtime");
      setStageDetail("Retrying section refresh");
      dispatchRestoreRefreshForSections([...selectedRestoreSections]);
      setRestoreStage("complete");
      setRestoreResult({ success: true, message: "Runtime refresh completed successfully." });
    } catch {
      refreshFailedRef.current = true;
      setRefreshFailed(true);
      setRestoreStage("complete");
      setRestoreResult({ success: true, message: "Backup restored, but LumaForge could not refresh every selected section." });
    } finally {
      setTimeout(() => {
        setRestoreStage(null);
        setStageDetail("");
      }, 3000);
    }
  }, [selectedRestoreSections]);

  const handleDeleteBackup = useCallback(async (filename: string) => {
    try {
      await deleteBackupArchive(filename);
      const backups = await listBackupArchives().catch(() => []);
      setStoredBackups(backups);
      setConfirmDelete(null);
    } catch (err) {
      alert(`Delete failed: ${err}`);
    }
  }, []);

  const toggleCustomSection = useCallback((section: BackupSectionType) => {
    setCustomSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }, []);

  return (
    <div className="space-y-6">
      {/* ── Backup Overview ── */}
      <div className="lf-surface rounded-2xl border p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-(--color-accent)/15 text-(--color-accent)">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-(--color-text)">Backup Overview</h3>
            <p className="text-xs text-(--color-muted)">
              {SECTION_READY_COUNT} ready · {SECTION_PARTIAL_COUNT} partial · {SECTION_PLACEHOLDER_COUNT} planned
            </p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-center">
            <p className="text-lg font-bold text-(--color-text)">{storedBackups.length}</p>
            <p className="text-[10px] text-(--color-muted)">Stored</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-center">
            <p className="text-lg font-bold text-emerald-400">{SECTION_READY_COUNT}</p>
            <p className="text-[10px] text-(--color-muted)">Ready</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-center">
            <p className="text-lg font-bold text-amber-400">{SECTION_PARTIAL_COUNT}</p>
            <p className="text-[10px] text-(--color-muted)">Partial</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-center">
            <p className="text-lg font-bold text-zinc-500">{SECTION_PLACEHOLDER_COUNT}</p>
            <p className="text-[10px] text-(--color-muted)">Planned</p>
          </div>
        </div>
      </div>

      {/* ── Backup & Restore (presets + export) ── */}
      <div className="lf-surface rounded-2xl border p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-(--color-accent)/15 text-(--color-accent)">
            <FileArchive className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-(--color-text)">Backup & Restore</h3>
            <p className="text-xs text-(--color-muted)">Export and restore LumaForge-owned data</p>
          </div>
        </div>

        <div className="space-y-3">
          {BACKUP_PRESETS.filter((p) => p.id !== "custom").map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setSelectedPreset(preset.id)}
              className={`w-full text-left rounded-xl border px-4 py-3 transition ${
                selectedPreset === preset.id
                  ? "border-(--color-accent)/40 bg-(--color-accent)/10"
                  : "border-(--surface-active-border) bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-(--color-text)">{preset.name}</p>
                  <p className="text-xs text-(--color-muted) mt-0.5">{preset.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-(--color-muted)">{preset.sections.length} sections</span>
                  {selectedPreset === preset.id && (
                    <CheckCircle2 className="h-4 w-4 text-(--color-accent)" />
                  )}
                </div>
              </div>
            </button>
          ))}

          <button
            type="button"
            onClick={() => setSelectedPreset(selectedPreset === "custom" ? "essentials" : "custom")}
            className={`w-full text-left rounded-xl border px-4 py-3 transition ${
              selectedPreset === "custom"
                ? "border-(--color-accent)/40 bg-(--color-accent)/10"
                : "border-(--surface-active-border) bg-white/[0.02] hover:bg-white/[0.04]"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-(--color-text)">Custom</p>
                <p className="text-xs text-(--color-muted) mt-0.5">Select specific sections to include</p>
              </div>
              {selectedPreset === "custom" ? (
                <ChevronDown className="h-4 w-4 text-(--color-muted)" />
              ) : (
                <ChevronRight className="h-4 w-4 text-(--color-muted)" />
              )}
            </div>
          </button>

          {selectedPreset === "custom" && (
            <div className="grid grid-cols-2 gap-2 pl-4">
              {ALL_BACKUP_SECTIONS.map((section) => {
                const auditStatus = SECTION_AUDIT_STATUS[section];
                const isDisabled = auditStatus === "placeholder" || auditStatus === "partial";
                const statusStyle = AUDIT_STATUS_STYLES[auditStatus];
                return (
                  <button
                    key={section}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => toggleCustomSection(section)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${
                      customSections.has(section)
                        ? "border-(--color-accent)/30 bg-(--color-accent)/10 text-(--color-accent)"
                        : "border-(--surface-active-border) bg-white/5 text-(--color-muted)"
                    } ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {customSections.has(section) ? (
                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                    ) : (
                      <div className="h-3 w-3 shrink-0 rounded-full border border-(--surface-active-border)" />
                    )}
                    <span className="truncate flex-1">{SECTION_DISPLAY_NAMES[section]}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ${statusStyle.badge}`}>
                      {statusStyle.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Export + Import buttons ── */}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={exporting || activeSections.length === 0}
          onClick={handleExport}
          className="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2.5 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50"
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {exporting ? "Exporting..." : "Export Backup"}
        </button>

        <label className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm text-(--color-text) transition hover:bg-white/10 cursor-pointer">
          <Upload className="h-4 w-4" />
          Import & Preview
          <input
            type="file"
            accept=".json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              handlePreview(text);
            }}
          />
        </label>
      </div>

      {/* ── Export result ── */}
      {exportResult && (
        <div className={`lf-surface rounded-2xl border p-5 ${
          exportResult.success ? "border-emerald-500/30" : "border-red-500/30"
        }`}>
          <div className="flex items-center gap-3 mb-3">
            {exportResult.success ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-400" />
            )}
            <h3 className="text-sm font-bold text-(--color-text)">
              {exportResult.success ? "Export Complete" : "Export Failed"}
            </h3>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-lg font-bold text-(--color-text)">{exportResult.fileCount}</p>
              <p className="text-[10px] text-(--color-muted)">Files</p>
            </div>
            <div>
              <p className="text-lg font-bold text-(--color-text)">{formatBytes(exportResult.totalSize)}</p>
              <p className="text-[10px] text-(--color-muted)">Size</p>
            </div>
            <div>
              <p className="text-lg font-bold text-(--color-text)">{(exportResult.duration / 1000).toFixed(1)}s</p>
              <p className="text-[10px] text-(--color-muted)">Duration</p>
            </div>
          </div>
          {exportResult.manifest && (
            <p className="mt-3 text-[10px] text-(--color-muted) text-center">
              Schema v{exportResult.manifest.schemaVersion} · {exportResult.manifest.backupId}
            </p>
          )}
          {exportResult.warnings.length > 0 && (
            <div className="mt-3 space-y-1">
              {exportResult.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-400">{w}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Preview ── */}
      {showPreview && previewResult && (
        <div ref={previewPanelRef} className="lf-surface rounded-2xl border p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Eye className="h-5 w-5 text-(--color-accent)" />
            <h3 className="text-sm font-bold text-(--color-text)">Backup Preview</h3>
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className="ml-auto text-xs text-(--color-muted) hover:text-(--color-text)"
            >
              Close
            </button>
          </div>

          {previewResult.manifest && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-3">
                <p className="text-(--color-muted)">Schema Version</p>
                <p className="font-medium text-(--color-text)">v{previewResult.manifest.schemaVersion}</p>
              </div>
              <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-3">
                <p className="text-(--color-muted)">Created</p>
                <p className="font-medium text-(--color-text)">{new Date(previewResult.manifest.createdAt).toLocaleString()}</p>
              </div>
              <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-3">
                <p className="text-(--color-muted)">Files</p>
                <p className="font-medium text-(--color-text)">{previewResult.manifest.totalFiles}</p>
              </div>
              <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-3">
                <p className="text-(--color-muted)">Total Size</p>
                <p className="font-medium text-(--color-text)">{formatBytes(previewResult.manifest.totalSize)}</p>
              </div>
            </div>
          )}

          {previewResult.warnings.length > 0 && (
            <div className="space-y-1">
              {previewResult.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-400 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0" /> {w}
                </p>
              ))}
            </div>
          )}

          {/* Section selection for restore */}
          {previewResult.manifest && selectedRestoreSections && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-(--color-text)">Sections to restore:</p>
              <div className="grid grid-cols-2 gap-1.5">
                {[...new Set(previewResult.manifest.files.map((f) => f.section))].map((section) => {
                  const isSelected = selectedRestoreSections.has(section);
                  const display = SECTION_DISPLAY_NAMES[section as BackupSectionType] ?? section;
                  return (
                    <button
                      key={section}
                      type="button"
                      onClick={() => {
                        setSelectedRestoreSections((prev) => {
                          if (!prev) return prev;
                          const next = new Set(prev);
                          if (next.has(section)) next.delete(section);
                          else next.add(section);
                          return next;
                        });
                      }}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] transition ${
                        isSelected
                          ? "border-(--color-accent)/30 bg-(--color-accent)/10 text-(--color-accent)"
                          : "border-(--surface-active-border) bg-white/5 text-(--color-muted)"
                      }`}
                    >
                      {isSelected ? (
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                      ) : (
                        <div className="h-3 w-3 shrink-0 rounded-full border border-(--surface-active-border)" />
                      )}
                      <span className="truncate">{display}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Write-set display: exact keys/fields that will change */}
          {restoreWriteSet && restoreWriteSet.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-(--color-text)">Write set — what will change:</p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {restoreWriteSet.map((entry, i) => (
                  <div key={i} className="rounded-lg border border-(--surface-active-border) bg-white/[0.02] px-3 py-2 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-(--color-text) font-medium">{entry.label}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                        entry.action === "field-merge" ? "bg-emerald-500/15 text-emerald-400" :
                        entry.action === "merge" ? "bg-blue-500/15 text-blue-400" :
                        "bg-amber-500/15 text-amber-400"
                      }`}>
                        {entry.action}
                      </span>
                    </div>
                    <p className="text-[10px] text-(--color-muted) mt-0.5 font-mono">{entry.storageKey}</p>
                    {entry.fieldsChanged && entry.fieldsChanged.length > 0 && (
                      <p className="text-[10px] text-emerald-400/80 mt-1">
                        Changes: {entry.fieldsChanged.slice(0, 5).join(", ")}{entry.fieldsChanged.length > 5 ? ` +${entry.fieldsChanged.length - 5} more` : ""}
                      </p>
                    )}
                    {entry.fieldsPreserved && entry.fieldsPreserved.length > 0 && (
                      <p className="text-[10px] text-(--color-muted) mt-0.5">
                        Preserved: {entry.fieldsPreserved.length} unchanged field(s)
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Safety banner */}
          <div className="flex items-center gap-2 text-xs">
            <Shield className="h-4 w-4 text-(--color-accent)" />
            <span className={previewResult.valid ? "text-emerald-400" : "text-red-400"}>
              {previewResult.valid
                ? (previewLegacyData
                    ? "Legacy file — only theme and surface mode will be restored"
                    : previewResult.isLegacyV1
                      ? "Legacy v1 backup — visual fields only, critical paths and keys protected"
                      : "Backup validated — only selected sections will be restored")
                : "Backup validation failed — restore blocked"}
            </span>
          </div>

          {/* Credential protection notice */}
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-400">
            <Shield className="h-3.5 w-3.5 shrink-0" />
            <span>Credentials and API keys are protected and will not be changed.</span>
          </div>

          {/* Restore action + result */}
          {previewResult.manifest && !previewLegacyData && (
            <div className="space-y-2">
              {/* Progress stages */}
              {restoreStage && restoreStage !== "complete" && restoreStage !== "failed" && (
                <div className="rounded-xl border border-(--color-accent)/20 bg-(--color-accent)/5 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs text-(--color-accent)">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="font-medium">{stageDetail || "Processing..."}</span>
                  </div>
                  <div className="mt-2 flex gap-1">
                    {["creating-safety-backup", "validating-backup", "preparing-sections", "applying-changes", "refreshing-runtime", "validating-state", "complete"].map((s, i) => {
                      const stages = ["creating-safety-backup", "validating-backup", "preparing-sections", "applying-changes", "refreshing-runtime", "validating-state", "complete"];
                      const currentIdx = stages.indexOf(restoreStage);
                      const isDone = i < currentIdx;
                      const isCurrent = i === currentIdx;
                      return (
                        <div
                          key={s}
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            isDone ? "bg-emerald-400" : isCurrent ? "bg-(--color-accent)" : "bg-white/10"
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {restoreResult && (
                <div className={`rounded-xl border px-3 py-2 text-xs ${
                  restoreResult.success
                    ? refreshFailed
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-red-500/30 bg-red-500/10 text-red-400"
                }`}>
                  <p className="font-medium">{restoreResult.message}</p>
                  {restoreResult.details && <p className="mt-1 text-[10px] opacity-75">{restoreResult.details}</p>}
                  {restoreResult.success && refreshFailed && (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={handleRetryRefresh}
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 px-2.5 py-1 text-[10px] font-medium text-amber-400 hover:bg-amber-500/30 transition"
                      >
                        <RotateCcw className="h-2.5 w-2.5" /> Retry Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          import("../../services/tauri").then((m) => {
                            m.powerRestart().catch(() => {});
                          });
                        }}
                        className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[10px] font-medium text-(--color-text) hover:bg-white/15 transition"
                      >
                        <Power className="h-2.5 w-2.5" /> Restart LumaForge
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                disabled={restoreInFlight || !selectedRestoreSections || selectedRestoreSections.size === 0}
                onClick={() => handleRestoreFromPreview()}
                className="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2 text-xs font-bold text-black transition hover:opacity-90 disabled:opacity-50"
              >
                {restoreInFlight ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                {restoreInFlight
                  ? (stageDetail || "Restoring...")
                  : `Restore${selectedRestoreSections ? ` (${selectedRestoreSections.size} section${selectedRestoreSections.size !== 1 ? "s" : ""})` : ""}`}
              </button>
            </div>
          )}

          {previewLegacyData && (
            <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs text-amber-400">
                <Info className="h-3.5 w-3.5 shrink-0" />
                <span>This is a legacy settings export. Only theme and surface mode will be restored — full settings (including steamRoot and API keys) are never overwritten.</span>
              </div>
              <div className="text-[10px] text-(--color-muted) space-y-1">
                {previewLegacyData.theme != null && <p>• Theme: lumaforge-theme</p>}
                {previewLegacyData.surfaceMode != null && <p>• Surface mode: lumaforge-surface-mode</p>}
                {previewLegacyData.settings != null && <p className="text-amber-400/70">• Settings: NOT restored (protected)</p>}
                {typeof previewLegacyData.exportedAt === "string" && <p>• Exported: {new Date(previewLegacyData.exportedAt).toLocaleString()}</p>}
              </div>
              <button
                type="button"
                disabled={restoreInFlight}
                onClick={() => {
                  setIsLegacyConfirm(true);
                  setShowRestoreConfirm(true);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2 text-xs font-bold text-black transition hover:opacity-90 disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" />
                {restoreInFlight ? "Restoring..." : "Restore Theme & Surface Mode"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Stored Backups ── */}
      <div className="lf-surface rounded-2xl border p-5 space-y-3">
        <div className="flex items-center gap-3 mb-2">
          <HardDrive className="h-5 w-5 text-(--color-accent)" />
          <h3 className="text-sm font-bold text-(--color-text)">Stored Backups</h3>
          <span className="text-[10px] text-(--color-muted)">{storedBackups.length} file{storedBackups.length !== 1 ? "s" : ""}</span>
        </div>
        {storedBackups.length === 0 ? (
          <p className="text-xs text-(--color-muted)">No backups stored on disk yet.</p>
        ) : (
          <div className="space-y-1.5">
            {[...storedBackups].reverse().map((filename) => (
              <div key={filename} className="rounded-lg bg-white/[0.02] px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileArchive className="h-3.5 w-3.5 text-(--color-muted) shrink-0" />
                    <span className="text-xs text-(--color-text) font-mono truncate">
                      {shortenBackupId(filename)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handlePreviewFromDisk(filename)}
                      disabled={previewing !== null || restoreInFlight}
                      className="rounded-lg px-2 py-1 text-[10px] text-(--color-muted) hover:text-(--color-text) hover:bg-white/10 transition disabled:opacity-50"
                      title={previewing === filename ? "Loading preview..." : `Preview ${shortenBackupId(filename)}`}
                      aria-label={`Preview backup ${shortenBackupId(filename)}`}
                    >
                      {previewing === filename ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Eye className="h-3 w-3" />
                      )}
                    </button>
                    {confirmDelete === filename ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={restoreInFlight}
                          onClick={() => handleDeleteBackup(filename)}
                          className="rounded-lg px-2 py-1 text-[10px] text-red-400 bg-red-500/10 hover:bg-red-500/20 transition font-bold"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(null)}
                          className="rounded-lg px-2 py-1 text-[10px] text-(--color-muted) hover:bg-white/10 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(filename)}
                        className="rounded-lg px-2 py-1 text-[10px] text-red-400 hover:bg-red-500/10 transition"
                        title="Delete backup"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── External Steam Data (Lua, Achievements, Depot Cache) ── */}
      <ExternalSteamDataPanel />

      {/* ── Advanced Backup Details (collapsed by default) ── */}
      <div className="lf-surface rounded-2xl border overflow-hidden">
        <button
          type="button"
          onClick={() => setAuditExpanded(!auditExpanded)}
          className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/[0.02] transition"
        >
          <Info className="h-4 w-4 text-(--color-muted) shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-(--color-text)">Advanced Backup Details</h3>
            <p className="text-[10px] text-(--color-muted)">Per-section audit status, merge policies, and data notes</p>
          </div>
          {auditExpanded ? (
            <ChevronDown className="h-4 w-4 text-(--color-muted) shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-(--color-muted) shrink-0" />
          )}
        </button>
        {auditExpanded && (
          <div className="px-5 pb-5 space-y-2 border-t border-(--surface-active-border)">
            <div className="grid grid-cols-1 gap-1.5 pt-3">
              {ALL_BACKUP_SECTIONS.map((section) => {
                const auditStatus = SECTION_AUDIT_STATUS[section];
                const statusStyle = AUDIT_STATUS_STYLES[auditStatus];
                const policy = SECTION_MERGE_POLICIES[section];
                return (
                  <div key={section} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-(--color-text)">{SECTION_DISPLAY_NAMES[section]}</span>
                      <p className="text-[10px] text-(--color-muted) truncate">{SECTION_AUDIT_NOTES[section]}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${statusStyle.badge}`}>
                        {statusStyle.label}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                        policy === "merge" ? "bg-blue-500/15 text-blue-400" :
                        policy === "replace" ? "bg-red-500/15 text-red-400" :
                        policy === "union" ? "bg-emerald-500/15 text-emerald-400" :
                        policy === "dedup" ? "bg-amber-500/15 text-amber-400" :
                        "bg-violet-500/15 text-violet-400"
                      }`}>
                        {policy}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Restore Confirmation Modal ── */}
      <ConfirmModal
        open={showRestoreConfirm}
        title="Restore selected backup?"
        description={
          isLegacyConfirm
            ? "This will restore your theme and surface mode from a legacy backup. Full settings will not be overwritten. A safety backup will be created automatically."
            : (() => {
                const m = previewResult?.manifest;
                const sectionCount = selectedRestoreSections?.size ?? 0;
                const sectionNames = selectedRestoreSections
                  ? [...selectedRestoreSections].map((s) => SECTION_DISPLAY_NAMES[s as BackupSectionType] ?? s).join(", ")
                  : "";
                const hasSettingsSection = selectedRestoreSections?.has("settings") ?? false;
                const parts: string[] = [];
                if (m) {
                  parts.push(`Backup created ${new Date(m.createdAt).toLocaleString()} (schema v${m.schemaVersion}, ${m.totalFiles} file${m.totalFiles !== 1 ? "s" : ""}).`);
                }
                parts.push(`Restoring ${sectionCount} section${sectionCount !== 1 ? "s" : ""}: ${sectionNames}.`);
                parts.push("A safety backup will be created automatically before any changes.");
                parts.push("Credentials, API keys, and Steam path will remain unchanged.");
                if (!hasSettingsSection) {
                  parts.push("Steam path will remain unchanged.");
                }
                parts.push("Unselected sections will remain unchanged.");
                return parts.join(" ");
              })()
        }
        confirmLabel={restoreInFlight ? "Restoring..." : "Restore Backup"}
        cancelLabel="Cancel"
        variant="warning"
        icon={<RotateCcw className="h-5 w-5" />}
        onConfirm={() => {
          setShowRestoreConfirm(false);
          if (isLegacyConfirm) {
            // Legacy restore: theme + surface mode only
            if (!previewLegacyData) return;
            const themeStr = previewLegacyData.theme ? String(previewLegacyData.theme) : null;
            const surfaceStr = previewLegacyData.surfaceMode ? String(previewLegacyData.surfaceMode) : null;
            setRestoreInFlight(true);
            try {
              if (themeStr) localStorage.setItem("lumaforge-theme", themeStr);
              if (surfaceStr) localStorage.setItem("lumaforge-surface-mode", surfaceStr);
              dispatchRestoreRefreshForSections(["uiPreferences"]);
              setRestoreResult({ success: true, message: "Legacy theme and surface mode restored." });
              setShowPreview(false);
              setPreviewLegacyData(null);
            } catch (err) {
              setRestoreResult({ success: false, message: `Restore failed: ${err}` });
            } finally {
              setRestoreInFlight(false);
            }
          } else {
            const raw = rawPreviewDataRef.current;
            if (raw) handleRestore(raw);
          }
        }}
        onCancel={() => {
          setShowRestoreConfirm(false);
          setIsLegacyConfirm(false);
        }}
      />

      {/* ── Restart Required Modal ── */}
      <ConfirmModal
        open={showRestartModal}
        title="Restart Required"
        description="Some restored settings require LumaForge to restart to take effect (paths, launch options, or startup configuration). You can restart now or continue and restart later."
        confirmLabel="Restart Now"
        cancelLabel="Later"
        variant="info"
        icon={<Power className="h-5 w-5" />}
        onConfirm={() => {
          setShowRestartModal(false);
          // Trigger Tauri app restart via power restart (closest available)
          import("../../services/tauri").then((m) => {
            m.powerRestart().catch(() => {});
          });
        }}
        onCancel={() => setShowRestartModal(false)}
      />
    </div>
  );
}
