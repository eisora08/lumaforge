/**
 * AutoScanSection
 *
 * Right panel for auto-scan configuration.
 * Matches Playnite's GameScannerConfigPanel:
 *   Left: scan config list + Add/Copy/Remove
 *   Right: Name, Scan folder, Emulator dropdown, Profile dropdown,
 *          Override platform, Play action settings, checkboxes, Exclusions tab
 */

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen, ChevronDown, Plus, Copy, Trash2, Settings,
} from "lucide-react";
import type { EmulatorConfig, EmulatorPlatform, ScanConfiguration } from "../../data/emulatorDefinitions/types";
import { pickFolder } from "../../services/tauri";

type AutoScanSectionProps = {
  scanConfigs: ScanConfiguration[];
  emulatorConfigs: EmulatorConfig[];
  selectedScanId: string | null;
  onSelectScan: (id: string | null) => void;
  onAdd: () => void;
  onCopy: () => void;
  onRemove: () => void;
  onChange: (config: ScanConfiguration) => void;
};

export function AutoScanSection({
  scanConfigs,
  emulatorConfigs,
  selectedScanId,
  onSelectScan,
  onAdd,
  onCopy,
  onRemove,
  onChange,
}: AutoScanSectionProps) {
  const { t } = useTranslation();
  const [exclusionsOpen, setExclusionsOpen] = useState(false);
  const [newExcludedFile, setNewExcludedFile] = useState("");
  const [newExcludedDir, setNewExcludedDir] = useState("");

  const selectedScan = scanConfigs.find((c) => c.id === selectedScanId) ?? null;
  const selectedEmulator = selectedScan
    ? emulatorConfigs.find((e) => e.id === selectedScan.emulatorId)
    : null;

  const update = useCallback(
    (updates: Partial<ScanConfiguration>) => {
      if (!selectedScan) return;
      onChange({ ...selectedScan, ...updates });
    },
    [selectedScan, onChange]
  );

  // ── Exclusions ──

  const addExcludedFile = useCallback(() => {
    if (!newExcludedFile.trim() || !selectedScan) return;
    update({ excludedFiles: [...selectedScan.excludedFiles, newExcludedFile.trim()] });
    setNewExcludedFile("");
  }, [newExcludedFile, selectedScan, update]);

  const removeExcludedFile = useCallback(
    (idx: number) => {
      if (!selectedScan) return;
      const next = [...selectedScan.excludedFiles];
      next.splice(idx, 1);
      update({ excludedFiles: next });
    },
    [selectedScan, update]
  );

  const addExcludedDir = useCallback(() => {
    if (!newExcludedDir.trim() || !selectedScan) return;
    update({ excludedDirectories: [...selectedScan.excludedDirectories, newExcludedDir.trim()] });
    setNewExcludedDir("");
  }, [newExcludedDir, selectedScan, update]);

  const removeExcludedDir = useCallback(
    (idx: number) => {
      if (!selectedScan) return;
      const next = [...selectedScan.excludedDirectories];
      next.splice(idx, 1);
      update({ excludedDirectories: next });
    },
    [selectedScan, update]
  );

  // ── All available platforms ──
  const allPlatforms: EmulatorPlatform[] = (() => {
    try {
      const { emulatorPlatforms } = require("../../data/emulatorDefinitions/platforms");
      return emulatorPlatforms ?? [];
    } catch {
      return [];
    }
  })();

  return (
    <div className="flex gap-4 min-h-[400px]">
      {/* Left Panel — Scan Config List */}
      <div className="w-[250px] shrink-0 flex flex-col border border-neutral-800 rounded-lg bg-neutral-900/50">
        <div className="flex-1 overflow-y-auto min-h-0">
          {scanConfigs.length > 0 ? (
            scanConfigs.map((config) => (
              <button
                key={config.id}
                onClick={() => onSelectScan(config.id)}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                  selectedScanId === config.id
                    ? "bg-purple-500/10 text-purple-300"
                    : "text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-purple-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{config.name}</p>
                  <p className="truncate text-xs text-neutral-500">
                    {config.directory || t("emulator.no_folder", "No folder set")}
                  </p>
                </div>
              </button>
            ))
          ) : (
            <div className="flex h-full items-center justify-center px-3 py-8">
              <p className="text-xs text-neutral-500 text-center">
                {t("emulator.no_scan_configs", "No scan configurations")}
              </p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex border-t border-neutral-800 p-2 gap-1">
          <button
            onClick={onAdd}
            className="flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
            title={t("emulator.add_scan", "Add Scan Config")}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onCopy}
            disabled={!selectedScanId}
            className="flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-30"
            title={t("emulator.copy_scan", "Copy Scan Config")}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onRemove}
            disabled={!selectedScanId}
            className="flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-xs text-neutral-400 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30"
            title={t("emulator.remove_scan", "Remove Scan Config")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Right Panel — Scan Config Detail */}
      <div className="flex-1 min-w-0">
        {selectedScan ? (
          <div className="space-y-3">
            {/* Name */}
            <div>
              <label className="mb-1 block text-xs text-neutral-400">
                {t("emulator.scan_name", "Name")}
              </label>
              <input
                type="text"
                value={selectedScan.name}
                onChange={(e) => update({ name: e.target.value })}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:border-purple-500 focus:outline-none"
              />
            </div>

            {/* Scan Folder */}
            <div>
              <label className="mb-1 block text-xs text-neutral-400">
                {t("emulator.scan_folder", "Scan Folder")}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={selectedScan.directory}
                  onChange={(e) => update({ directory: e.target.value })}
                  placeholder="C:\ROMs\SNES"
                  className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:border-purple-500 focus:outline-none"
                />
                <button
                  onClick={async () => {
                    const folder = await pickFolder(
                      t("emulator.select_scan_folder", "Select Scan Folder"),
                      selectedScan.directory || undefined
                    );
                    if (folder) update({ directory: folder });
                  }}
                  className="rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Scan With Emulator */}
            <div>
              <label className="mb-1 block text-xs text-neutral-400">
                {t("emulator.scan_with", "Scan With Emulator")}
              </label>
              <div className="relative">
                <select
                  value={selectedScan.emulatorId}
                  onChange={(e) => update({ emulatorId: e.target.value, profileId: "" })}
                  className="w-full appearance-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 pr-8 text-sm text-neutral-200 focus:border-purple-500 focus:outline-none"
                >
                  <option value="">{t("emulator.none", "(none)")}</option>
                  {emulatorConfigs.map((em) => (
                    <option key={em.id} value={em.id}>
                      {em.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              </div>
            </div>

            {/* Profile */}
            <div>
              <label className="mb-1 block text-xs text-neutral-400">
                {t("emulator.scan_profile", "Profile")}
              </label>
              <div className="relative">
                <select
                  value={selectedScan.profileId}
                  onChange={(e) => update({ profileId: e.target.value })}
                  disabled={!selectedEmulator}
                  className="w-full appearance-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 pr-8 text-sm text-neutral-200 focus:border-purple-500 focus:outline-none disabled:opacity-50"
                >
                  <option value="">{t("emulator.none", "(none)")}</option>
                  {selectedEmulator?.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              </div>
            </div>

            {/* Override Platform */}
            <div>
              <label className="mb-1 block text-xs text-neutral-400">
                {t("emulator.override_platform", "Override Platform")}
              </label>
              <div className="relative">
                <select
                  value={selectedScan.overridePlatformId ?? ""}
                  onChange={(e) => update({ overridePlatformId: e.target.value || undefined })}
                  className="w-full appearance-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 pr-8 text-sm text-neutral-200 focus:border-purple-500 focus:outline-none"
                >
                  <option value="">{t("emulator.auto_detect", "Auto-detect")}</option>
                  {allPlatforms.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.shortName}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              </div>
            </div>

            {/* Play Action Settings */}
            <div>
              <label className="mb-1 block text-xs text-neutral-400">
                {t("emulator.play_action", "Play Action Settings")}
              </label>
              <div className="relative">
                <select
                  value={selectedScan.playActionSettings}
                  onChange={(e) =>
                    update({ playActionSettings: e.target.value as ScanConfiguration["playActionSettings"] })
                  }
                  className="w-full appearance-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 pr-8 text-sm text-neutral-200 focus:border-purple-500 focus:outline-none"
                >
                  <option value="scanner">{t("emulator.play_scanner", "Use Scanner")}</option>
                  <option value="select_profile">{t("emulator.play_select_profile", "Select Profile")}</option>
                  <option value="select_emulator">{t("emulator.play_select_emulator", "Select Emulator")}</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              </div>
            </div>

            {/* Checkboxes */}
            <div className="space-y-2 rounded border border-neutral-700 bg-neutral-800/50 p-3">
              <CheckboxField
                checked={selectedScan.excludeOnlineFiles}
                onChange={(v) => update({ excludeOnlineFiles: v })}
                label={t("emulator.exclude_online", "Skip cloud-stored files not downloaded locally")}
              />
              <CheckboxField
                checked={selectedScan.useSimplifiedScan}
                onChange={(v) => update({ useSimplifiedScan: v })}
                label={t("emulator.simplified_scan", "Scan without reading file content")}
              />
              <CheckboxField
                checked={selectedScan.importWithRelativePaths}
                onChange={(v) => update({ importWithRelativePaths: v })}
                label={t("emulator.relative_paths", "Use relative paths for ROM imports")}
              />
              <CheckboxField
                checked={selectedScan.scanSubfolders}
                onChange={(v) => update({ scanSubfolders: v })}
                label={t("emulator.scan_subfolders", "Recurse into subdirectories")}
              />
              <CheckboxField
                checked={selectedScan.scanInsideArchives}
                onChange={(v) => update({ scanInsideArchives: v })}
                label={t("emulator.scan_archives", "Scan inside .zip/.7z/.rar archives")}
              />
              <CheckboxField
                checked={selectedScan.mergeRelatedFiles}
                onChange={(v) => update({ mergeRelatedFiles: v })}
                label={t("emulator.merge_files", "Merge multi-disc/multi-file games into one entry")}
              />
              <CheckboxField
                checked={selectedScan.includeInGlobalUpdate}
                onChange={(v) => update({ includeInGlobalUpdate: v })}
                label={t("emulator.global_update", "Include in bulk library update scan")}
              />
            </div>

            {/* Exclusions */}
            <div className="border border-neutral-700 rounded-lg">
              <button
                onClick={() => setExclusionsOpen(!exclusionsOpen)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-neutral-300 hover:bg-neutral-800"
              >
                <Settings className="h-4 w-4" />
                {t("emulator.exclusions", "Exclusions")}
                <span className="ml-auto text-xs text-neutral-500">
                  {selectedScan.excludedFiles.length + selectedScan.excludedDirectories.length} item(s)
                </span>
              </button>
              {exclusionsOpen && (
                <div className="border-t border-neutral-700 p-3 space-y-3">
                  {/* CRC Excluded File Types */}
                  <div>
                    <label className="mb-1 block text-xs text-neutral-400">
                      {t("emulator.crc_exclude", "CRC Excluded File Types")}
                    </label>
                    <input
                      type="text"
                      value={selectedScan.crcExcludeFileTypes.join(", ")}
                      onChange={(e) =>
                        update({
                          crcExcludeFileTypes: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="*.chd, *.bin"
                      className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-600 focus:border-purple-500 focus:outline-none"
                    />
                  </div>

                  {/* Excluded Files */}
                  <div>
                    <label className="mb-1 block text-xs text-neutral-400">
                      {t("emulator.excluded_files", "Excluded Files")}
                    </label>
                    <div className="flex gap-2 mb-1">
                      <input
                        type="text"
                        value={newExcludedFile}
                        onChange={(e) => setNewExcludedFile(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addExcludedFile()}
                        placeholder="file.txt"
                        className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 placeholder-neutral-600 focus:border-purple-500 focus:outline-none"
                      />
                      <button
                        onClick={addExcludedFile}
                        className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-600"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {selectedScan.excludedFiles.map((f, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300"
                        >
                          {f}
                          <button onClick={() => removeExcludedFile(i)} className="text-neutral-500 hover:text-red-400">×</button>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Excluded Directories */}
                  <div>
                    <label className="mb-1 block text-xs text-neutral-400">
                      {t("emulator.excluded_dirs", "Excluded Directories")}
                    </label>
                    <div className="flex gap-2 mb-1">
                      <input
                        type="text"
                        value={newExcludedDir}
                        onChange={(e) => setNewExcludedDir(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addExcludedDir()}
                        placeholder="subfolder"
                        className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 placeholder-neutral-600 focus:border-purple-500 focus:outline-none"
                      />
                      <button
                        onClick={addExcludedDir}
                        className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-600"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {selectedScan.excludedDirectories.map((d, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300"
                        >
                          {d}
                          <button onClick={() => removeExcludedDir(i)} className="text-neutral-500 hover:text-red-400">×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            {t("emulator.select_scan_config", "Select a scan configuration, or add a new one.")}
          </div>
        )}
      </div>
    </div>
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
