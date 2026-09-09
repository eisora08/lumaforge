/**
 * ImportRomModal
 *
 * Modal for importing ROM files into the emulator library.
 *   - Scan folder / Browse files
 *   - Emulator + Profile dropdowns
 *   - Override platform
 *   - Checkboxes: scan subfolders, scan archives, merge files, relative paths
 *   - List of detected ROMs with per-ROM platform override
 *   - Import button
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Gamepad2, FolderOpen, FileCode, Check, X, Trash2, EyeOff,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { pickFolder } from "../../services/tauri";
import {
  saveEmulatorGames,
  getAllEmulatorGames,
  isRomFile,
  guessPlatformFromFilename,
  guessRegionFromFilename,
} from "../../services/emulatorGameStore";
import { emulatorPlatforms } from "../../data/emulatorDefinitions/platforms";
import { getAllEmulatorConfigs } from "../../services/emulatorConfigStore";
import { scanForRoms, createEmulatorGameEntries } from "../../services/emulatorScanner";
import { showError, showSuccess } from "../toast/GameToast";
import SourceDropdown from "../common/SourceDropdown";

type ImportRomModalProps = {
  open: boolean;
  onClose: () => void;
  defaultEmulatorConfigId?: string;
};

type RomFile = {
  name: string;
  path: string;
  platform: string | null;
  region: string | null;
  size: number;
};

export function ImportRomModal({ open, onClose, defaultEmulatorConfigId }: ImportRomModalProps) {
  const { t } = useTranslation();
  const [romFiles, setRomFiles] = useState<RomFile[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string>(defaultEmulatorConfigId ?? "");
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [overridePlatformId, setOverridePlatformId] = useState<string>("");
  const [scanSubfolders, setScanSubfolders] = useState(true);
  const [scanInsideArchives, setScanInsideArchives] = useState(true);
  const [mergeRelatedFiles, setMergeRelatedFiles] = useState(true);
  const [importWithRelativePaths, setImportWithRelativePaths] = useState(true);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(0);
  const [hideImported, setHideImported] = useState(false);

  const configs = getAllEmulatorConfigs();
  const selectedConfig = configs.find((c) => c.id === selectedConfigId);

  // Build set of already-imported ROM paths
  const importedRomPaths = useMemo(() => {
    const set = new Set<string>();
    for (const g of getAllEmulatorGames()) {
      set.add(g.romPath.toLowerCase());
    }
    return set;
  }, [open]);

  // Filter displayed ROMs
  const displayedRoms = useMemo(() => {
    if (!hideImported || importedRomPaths.size === 0) return romFiles;
    return romFiles.filter((r) => !importedRomPaths.has(r.path.toLowerCase()));
  }, [romFiles, hideImported, importedRomPaths]);

  // SourceDropdown options
  const configOptions = useMemo(() => [
    { value: "", label: t("rom.none", "None") },
    ...configs.map((c) => ({ value: c.id, label: c.name })),
  ], [configs, t]);

  const profileOptions = useMemo(() => [
    { value: "", label: t("rom.none", "None") },
    ...(selectedConfig?.profiles.map((p) => ({ value: p.id, label: p.name })) ?? []),
  ], [selectedConfig, t]);

  const platformOptions = useMemo(() => [
    { value: "", label: t("rom.auto_detect", "Auto-detect") },
    ...emulatorPlatforms.map((p) => ({ value: p.id, label: `${p.name} (${p.shortName})` })),
  ], [t]);

  const romPlatformOptions = useMemo(() => [
    { value: "", label: t("rom.auto", "Auto") },
    ...emulatorPlatforms.map((p) => ({ value: p.id, label: p.shortName })),
  ], [t]);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setRomFiles([]);
    setImported(0);
    setSelectedConfigId(defaultEmulatorConfigId ?? "");
    setSelectedProfileId("");
    setOverridePlatformId("");
    setScanSubfolders(true);
    setScanInsideArchives(true);
    setMergeRelatedFiles(true);
    setImportWithRelativePaths(true);
    setHideImported(false);
  }, [open, defaultEmulatorConfigId]);

  // Reset profile when config changes
  useEffect(() => {
    if (selectedConfig && selectedConfig.profiles.length > 0) {
      setSelectedProfileId(selectedConfig.profiles[0].id);
    } else {
      setSelectedProfileId("");
    }
  }, [selectedConfig]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // ─── File Selection ────────────────────────────────────────────

  const handleBrowseFiles = useCallback(async () => {
    // Build extension filter from selected profile, fallback to full list
    const profile = selectedConfig?.profiles.find((p) => p.id === selectedProfileId);
    const profileExts = profile?.supportedFileTypes ?? [];
    const extensions = profileExts.length > 0
      ? profileExts.map((e) => e.replace(/^\./, "").toLowerCase())
      : [
          "nes", "sfc", "smc", "n64", "z64", "v64", "gcm", "iso", "wbfs", "rvz",
          "gba", "gb", "gbc", "nds", "3ds", "cia", "3dsx",
          "gen", "md", "smd", "sms", "gg", "bin", "cue", "cdi", "gdi",
          "pbp", "chd", "cso", "vpk", "zip", "7z", "pce", "ngp", "wsc",
          "nsp", "xci",
        ];

    const selected = await openDialog({
      title: t("rom.select_files", "Select ROM Files"),
      multiple: true,
      filters: [
        {
          name: profileExts.length > 0 ? profile!.name : "ROM Files",
          extensions,
        },
      ],
    });

    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];

    const roms: RomFile[] = paths
      .filter((p) => isRomFile(p))
      .map((p) => {
        const name = p.split(/[\\/]/).pop() ?? p;
        return {
          name,
          path: p,
          platform: guessPlatformFromFilename(name),
          region: guessRegionFromFilename(name),
          size: 0,
        };
      });

    setRomFiles((prev) => [...prev, ...roms]);
  }, [selectedConfig, selectedProfileId, t]);

  const handleScanFolder = useCallback(async () => {
    const folder = await pickFolder(
      t("rom.select_rom_folder", "Select ROM Folder")
    );
    if (!folder) return;

    setImporting(true);
    try {
      const scanned = await scanForRoms(folder, {
        emulatorConfigId: selectedConfigId || undefined,
        emulatorProfileId: selectedProfileId || undefined,
        scanSubfolders,
      });

      const roms: RomFile[] = scanned.map((r) => ({
        name: r.fileName,
        path: r.romPath,
        platform: r.platformId,
        region: r.region,
        size: r.fileSize,
      }));

      setRomFiles((prev) => [...prev, ...roms]);
      showSuccess(t("rom.scan_complete", "Scan complete: {{count}} ROMs found", { count: roms.length }));
    } catch {
      showError(t("rom.scan_error", "Failed to scan folder"));
    } finally {
      setImporting(false);
    }
  }, [selectedConfig, selectedProfileId, scanSubfolders, t]);

  // ─── Import ────────────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    setImporting(true);
    try {
      const entries = createEmulatorGameEntries(
        romFiles.map((r) => ({
          romPath: r.path,
          fileName: r.name,
          fileSize: r.size,
          platformId: r.platform,
          region: r.region,
        })),
        {
          emulatorConfigId: selectedConfigId || undefined,
          emulatorProfileId: selectedProfileId || undefined,
          defaultPlatform: overridePlatformId || undefined,
        }
      );

      saveEmulatorGames(entries);
      setImported(entries.length);
      showSuccess(t("rom.imported", "Imported {{count}} ROMs", { count: entries.length }));

      setTimeout(() => {
        onClose();
        setRomFiles([]);
        setImported(0);
      }, 1500);
    } catch {
      showError(t("rom.import_error", "Failed to import ROMs"));
    } finally {
      setImporting(false);
    }
  }, [romFiles, selectedConfigId, selectedProfileId, overridePlatformId, onClose, t]);

  // ─── Drag & Drop ──────────────────────────────────────────────

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);

    const roms: RomFile[] = files
      .filter((f) => isRomFile(f.name))
      .map((f) => ({
        name: f.name,
        path: (f as any).path ?? f.name,
        platform: guessPlatformFromFilename(f.name),
        region: guessRegionFromFilename(f.name),
        size: f.size,
      }));

    setRomFiles((prev) => [...prev, ...roms]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // ─── Per-ROM Platform Override ─────────────────────────────────

  const handleRomPlatformChange = useCallback((index: number, platform: string) => {
    setRomFiles((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], platform: platform || null };
      return next;
    });
  }, []);

  const handleRemoveRom = useCallback((index: number) => {
    setRomFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div className="lf-modal-panel lf-surface mx-4 flex h-[min(640px,85vh)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-(--surface-active-border) px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-(--color-accent)/10">
              <Gamepad2 className="h-5 w-5 text-(--color-accent)" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-(--color-text)">
                {t("rom.import_title", "Import ROMs")}
              </h2>
              <p className="text-sm text-(--color-muted)">
                {t("rom.import_desc", "Add ROM files to your emulator library")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-(--color-muted) hover:bg-white/10 hover:text-(--color-text)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col space-y-4 min-h-0 px-6 py-4">
          {/* Emulator + Profile */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-(--color-muted)">
                {t("rom.emulator", "Emulator")}
              </label>
              <SourceDropdown
                value={selectedConfigId}
                onChange={setSelectedConfigId}
                options={configOptions}
                className="w-full"
                portal
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-(--color-muted)">
                {t("rom.profile", "Profile")}
              </label>
              <SourceDropdown
                value={selectedProfileId}
                onChange={setSelectedProfileId}
                options={profileOptions}
                className="w-full"
                portal
              />
            </div>
          </div>

          {/* Source Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleScanFolder}
              disabled={importing || !selectedConfigId}
              className="flex items-center gap-2 rounded-lg border border-(--color-accent)/30 bg-(--color-accent)/5 px-4 py-2.5 text-sm text-(--color-accent) transition-colors hover:bg-(--color-accent)/10 disabled:opacity-50"
            >
              <FolderOpen className="h-4 w-4" />
              {importing
                ? t("rom.scanning", "Scanning...")
                : t("rom.browse_folder", "Browse...")}
            </button>
            <button
              onClick={handleBrowseFiles}
              disabled={!selectedConfigId}
              className="flex items-center gap-2 rounded-lg border border-(--surface-active-border) bg-white/[0.04] px-4 py-2.5 text-sm text-(--color-text) transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <FileCode className="h-4 w-4" />
              {t("rom.browse_files", "Browse Files")}
            </button>
            {importedRomPaths.size > 0 && (
              <button
                onClick={() => setHideImported((v) => !v)}
                disabled={!selectedConfigId}
                className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm transition disabled:opacity-50 ${
                  hideImported
                    ? "border-(--color-accent)/50 bg-(--color-accent)/10 text-(--color-accent)"
                    : "border-(--surface-active-border) bg-white/5 text-(--color-muted) hover:bg-white/10 hover:text-(--color-text)"
                }`}
              >
                <EyeOff className="h-4 w-4" />
                {hideImported
                  ? t("rom.hidden", "Hidden")
                  : t("rom.hide_imported", "Hide imported")}
              </button>
            )}
          </div>

          {/* Drop Zone — only when no ROMs */}
          {romFiles.length === 0 && (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-(--surface-active-border) bg-(--surface-active)/50 p-10 transition-colors hover:border-(--color-accent)/50"
            >
              <FolderOpen className="mb-3 h-10 w-10 text-(--color-muted)" />
              <p className="text-sm text-(--color-muted)">
                {t("rom.drag_drop", "Drag & drop ROM files here")}
              </p>
            </div>
          )}

          {/* Override Platform */}
          {romFiles.length > 0 && (
            <div>
              <label className="mb-1 block text-xs text-(--color-muted)">
                {t("rom.override_platform", "Override Platform")}
              </label>
              <SourceDropdown
                value={overridePlatformId}
                onChange={setOverridePlatformId}
                options={platformOptions}
                className="w-full"
                portal
              />
            </div>
          )}

          {/* Scan Options — 2 columns */}
          {romFiles.length > 0 && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded border border-(--surface-active-border) bg-white/[0.04] p-3">
              <CheckboxField
                checked={scanSubfolders}
                onChange={setScanSubfolders}
                label={t("rom.scan_subfolders", "Scan subfolders")}
              />
              <CheckboxField
                checked={scanInsideArchives}
                onChange={setScanInsideArchives}
                label={t("rom.scan_archives", "Scan inside archives")}
              />
              <CheckboxField
                checked={mergeRelatedFiles}
                onChange={setMergeRelatedFiles}
                label={t("rom.merge_files", "Merge multi-disc games")}
              />
              <CheckboxField
                checked={importWithRelativePaths}
                onChange={setImportWithRelativePaths}
                label={t("rom.relative_paths", "Use relative paths")}
              />
            </div>
          )}

          {/* File List */}
          {displayedRoms.length > 0 && (
            <div className="flex flex-1 min-h-0 flex-col">
              <h3 className="mb-2 text-sm font-medium text-(--color-text)">
                {displayedRoms.length} ROM{displayedRoms.length !== 1 ? "s" : ""}
              </h3>
              <div className="flex-1 min-h-0 space-y-1 overflow-y-auto">
                {displayedRoms.map((rom, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded bg-white/[0.04] px-3 py-2"
                  >
                    <FileCode className="h-4 w-4 shrink-0 text-(--color-muted)" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-(--color-text)">{rom.name}</p>
                      {rom.region && (
                        <p className="text-xs text-(--color-muted)">{rom.region}</p>
                      )}
                    </div>

                    <div className="shrink-0">
                      <SourceDropdown
                        value={rom.platform ?? ""}
                        onChange={(v) => handleRomPlatformChange(i, v)}
                        options={romPlatformOptions}
                        portal
                      />
                    </div>

                    <button
                      onClick={() => handleRemoveRom(i)}
                      className="shrink-0 rounded p-1 text-(--color-muted) hover:bg-red-500/10 hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Import Result */}
          {imported > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-green-500/10 p-3">
              <Check className="h-4 w-4 text-green-400" />
              <span className="text-sm text-green-300">
                {t("rom.import_success", "Successfully imported {{count}} ROMs", { count: imported })}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end gap-2 border-t border-(--surface-active-border) px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-(--color-muted) hover:bg-white/10 hover:text-(--color-text)"
          >
            {t("common.cancel", "Cancel")}
          </button>
          <button
            onClick={handleImport}
            disabled={romFiles.length === 0 || importing}
            className="rounded-lg bg-(--color-accent) px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {importing
              ? t("rom.importing", "Importing...")
              : t("rom.import_btn", "Import {{count}} ROMs", { count: romFiles.length })}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Helper Component ──────────────────────────────────────────────────

function CheckboxField({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-(--surface-active-border) bg-(--surface-active) text-(--color-accent) focus:ring-(--color-accent)"
      />
      <span className="text-xs text-(--color-text)">{label}</span>
    </label>
  );
}
