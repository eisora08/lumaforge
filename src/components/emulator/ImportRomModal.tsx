/**
 * ImportRomModal
 *
 * Modal for importing ROM files into the emulator library.
 * Matches Playnite's Import Wizard:
 *   - Scan folder / Browse files
 *   - Emulator + Profile dropdowns
 *   - Override platform
 *   - Checkboxes: scan subfolders, scan archives, merge files, relative paths
 *   - DataGrid of detected ROMs with per-ROM platform override
 *   - Import button
 */

import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Gamepad2, FolderOpen, FileCode, Check, X, Trash2, Search, ChevronDown,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { pickFolder } from "../../services/tauri";
import {
  saveEmulatorGames,
  isRomFile,
  guessPlatformFromFilename,
  guessRegionFromFilename,
} from "../../services/emulatorGameStore";
import { emulatorPlatforms } from "../../data/emulatorDefinitions/platforms";
import { getAllEmulatorConfigs } from "../../services/emulatorConfigStore";
import { scanForRoms, createEmulatorGameEntries } from "../../services/emulatorScanner";
import { showError, showSuccess } from "../toast/GameToast";

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

  const configs = getAllEmulatorConfigs();
  const selectedConfig = configs.find((c) => c.id === selectedConfigId);

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
    const selected = await openDialog({
      title: t("rom.select_files", "Select ROM Files"),
      multiple: true,
      filters: [
        {
          name: "ROM Files",
          extensions: [
            "nes", "sfc", "smc", "n64", "z64", "v64", "gcm", "iso", "wbfs", "rvz",
            "gba", "gb", "gbc", "nds", "3ds", "cia", "3dsx",
            "gen", "md", "smd", "sms", "gg", "bin", "cue", "cdi", "gdi",
            "pbp", "chd", "cso", "vpk", "zip", "7z", "pce", "ngp", "wsc",
          ],
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
  }, [t]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative mx-4 max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
              <Gamepad2 className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-neutral-100">
                {t("rom.import_title", "Import ROMs")}
              </h2>
              <p className="text-sm text-neutral-400">
                {t("rom.import_desc", "Add ROM files to your emulator library")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 px-6 py-4">
          {/* Scan Folder */}
          <div>
            <label className="mb-1 block text-xs text-neutral-400">
              {t("rom.scan_folder", "Scan Folder")}
            </label>
            <div className="flex gap-2">
              <button
                onClick={handleScanFolder}
                disabled={importing}
                className="flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/5 px-4 py-2.5 text-sm text-purple-300 transition-colors hover:bg-purple-500/10 disabled:opacity-50"
              >
                <FolderOpen className="h-4 w-4" />
                {t("rom.browse_folder", "Browse...")}
              </button>
              <button
                onClick={handleBrowseFiles}
                className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800/50 px-4 py-2.5 text-sm text-neutral-300 transition-colors hover:bg-neutral-800"
              >
                <FileCode className="h-4 w-4" />
                {t("rom.browse_files", "Browse Files")}
              </button>
              <button
                onClick={handleScanFolder}
                disabled={importing}
                className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800/50 px-4 py-2.5 text-sm text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-50"
              >
                <Search className="h-4 w-4" />
                {importing
                  ? t("rom.scanning", "Scanning...")
                  : t("rom.scan_btn", "Scan")}
              </button>
            </div>
          </div>

          {/* Drop Zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-700 bg-neutral-900/50 p-4 transition-colors hover:border-purple-500/50"
          >
            <FolderOpen className="mb-2 h-6 w-6 text-neutral-500" />
            <p className="text-sm text-neutral-400">
              {t("rom.drag_drop", "Drag & drop ROM files here")}
            </p>
          </div>

          {/* Emulator + Profile Dropdowns */}
          <div className="grid grid-cols-2 gap-3">
            {/* Emulator */}
            <div>
              <label className="mb-1 block text-xs text-neutral-400">
                {t("rom.emulator", "Emulator")}
              </label>
              <div className="relative">
                <select
                  value={selectedConfigId}
                  onChange={(e) => setSelectedConfigId(e.target.value)}
                  className="w-full appearance-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 pr-8 text-sm text-neutral-200 focus:border-purple-500 focus:outline-none"
                >
                  <option value="">{t("rom.none", "None")}</option>
                  {configs.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              </div>
            </div>

            {/* Profile */}
            <div>
              <label className="mb-1 block text-xs text-neutral-400">
                {t("rom.profile", "Profile")}
              </label>
              <div className="relative">
                <select
                  value={selectedProfileId}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                  disabled={!selectedConfig}
                  className="w-full appearance-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 pr-8 text-sm text-neutral-200 focus:border-purple-500 focus:outline-none disabled:opacity-50"
                >
                  <option value="">{t("rom.none", "None")}</option>
                  {selectedConfig?.profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              </div>
            </div>
          </div>

          {/* Override Platform */}
          {romFiles.length > 0 && (
            <div>
              <label className="mb-1 block text-xs text-neutral-400">
                {t("rom.override_platform", "Override Platform")}
              </label>
              <div className="relative">
                <select
                  value={overridePlatformId}
                  onChange={(e) => setOverridePlatformId(e.target.value)}
                  className="w-full appearance-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 pr-8 text-sm text-neutral-200 focus:border-purple-500 focus:outline-none"
                >
                  <option value="">{t("rom.auto_detect", "Auto-detect")}</option>
                  {emulatorPlatforms.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.shortName})</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              </div>
            </div>
          )}

          {/* Scan Options */}
          {romFiles.length > 0 && (
            <div className="space-y-2 rounded border border-neutral-700 bg-neutral-800/50 p-3">
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
          {romFiles.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-neutral-300">
                {romFiles.length} ROM{romFiles.length !== 1 ? "s" : ""} found
              </h3>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {romFiles.map((rom, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded bg-neutral-800/50 px-3 py-2"
                  >
                    <FileCode className="h-4 w-4 shrink-0 text-neutral-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-neutral-200">{rom.name}</p>
                      {rom.region && (
                        <p className="text-xs text-neutral-500">{rom.region}</p>
                      )}
                    </div>

                    {/* Per-ROM platform dropdown */}
                    <div className="relative shrink-0">
                      <select
                        value={rom.platform ?? ""}
                        onChange={(e) => handleRomPlatformChange(i, e.target.value)}
                        className="appearance-none rounded border border-neutral-700 bg-neutral-800 px-2 py-1 pr-6 text-xs text-neutral-200 focus:border-purple-500 focus:outline-none"
                      >
                        <option value="">{t("rom.auto", "Auto")}</option>
                        {emulatorPlatforms.map((p) => (
                          <option key={p.id} value={p.id}>{p.shortName}</option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
                    </div>

                    <button
                      onClick={() => handleRemoveRom(i)}
                      className="shrink-0 rounded p-1 text-neutral-400 hover:bg-red-500/10 hover:text-red-400"
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
        <div className="flex justify-end gap-2 border-t border-neutral-800 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            {t("common.cancel", "Cancel")}
          </button>
          <button
            onClick={handleImport}
            disabled={romFiles.length === 0 || importing}
            className="rounded-lg bg-purple-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
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
        className="rounded border-neutral-600 bg-neutral-800 text-purple-500 focus:ring-purple-500"
      />
      <span className="text-xs text-neutral-300">{label}</span>
    </label>
  );
}
