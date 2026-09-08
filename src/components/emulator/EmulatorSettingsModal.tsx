/**
 * EmulatorSettingsModal
 *
 * Modal for configuring emulators.
 * Supports: Import wizard, manual add, edit, profile selection, browse for exe.
 */

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Gamepad2, Trash2, Check, X, Monitor, Cpu, FolderOpen,
  Search, ChevronDown, Pencil,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { pickFolder } from "../../services/tauri";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  getAllEmulatorConfigs,
  saveEmulatorConfig,
  deleteEmulatorConfig,
  updateEmulatorConfig,
  createEmulatorConfig,
  onEmulatorConfigChange,
} from "../../services/emulatorConfigStore";
import type { EmulatorConfig } from "../../data/emulatorDefinitions/types";
import {
  emulatorDefinitions,
  getEmulatorById,
} from "../../data/emulatorDefinitions";
import type { EmulatorDefinition } from "../../data/emulatorDefinitions/types";
import { scanForEmulators, type DetectedEmulator } from "../../services/emulatorScanner";
import { showError, showSuccess } from "../toast/GameToast";

type EmulatorSettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

type ViewMode = "list" | "import" | "add" | "edit";

export function EmulatorSettingsModal({ open, onClose }: EmulatorSettingsModalProps) {
  const { t } = useTranslation();
  const [configs, setConfigs] = useState<EmulatorConfig[]>([]);
  const [view, setView] = useState<ViewMode>("list");
  const [selectedDef, setSelectedDef] = useState<EmulatorDefinition | null>(null);
  const [editingConfig, setEditingConfig] = useState<EmulatorConfig | null>(null);

  // Import wizard state
  const [importDir, setImportDir] = useState("");
  const [importing, setImporting] = useState(false);
  const [detectedEmulators, setDetectedEmulators] = useState<DetectedEmulator[]>([]);
  const [selectedDetected, setSelectedDetected] = useState<Set<string>>(new Set());

  // Manual add / edit form state
  const [formName, setFormName] = useState("");
  const [formInstallDir, setFormInstallDir] = useState("");
  const [formExePath, setFormExePath] = useState("");
  const [formProfile, setFormProfile] = useState("");

  // Load configs
  useEffect(() => {
    if (!open) return;
    setConfigs(getAllEmulatorConfigs());
    setView("list");
    setEditingConfig(null);
    setSelectedDef(null);
    setDetectedEmulators([]);
    setSelectedDetected(new Set());
  }, [open]);

  // Subscribe to changes
  useEffect(() => {
    return onEmulatorConfigChange(() => {
      setConfigs(getAllEmulatorConfigs());
    });
  }, []);

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

  // ─── Import Wizard ─────────────────────────────────────────────

  const handleImportScan = useCallback(async () => {
    if (!importDir) return;
    setImporting(true);
    try {
      const detected = await scanForEmulators(importDir);
      setDetectedEmulators(detected);
      setSelectedDetected(new Set(detected.map((d) => d.definitionId)));
    } catch (err) {
      showError(t("emulator.scan_error", "Failed to scan directory"));
    } finally {
      setImporting(false);
    }
  }, [importDir, t]);

  const handleImportSelectFolder = useCallback(async () => {
    const folder = await pickFolder(
      t("emulator.select_folder", "Select Emulator Folder")
    );
    if (folder) {
      setImportDir(folder);
    }
  }, [t]);

  const handleImportConfirm = useCallback(() => {
    for (const detected of detectedEmulators) {
      if (!selectedDetected.has(detected.definitionId)) continue;

      // Skip if already configured
      if (configs.some((c) => c.definitionId === detected.definitionId)) continue;

      const config = createEmulatorConfig(
        detected.definitionId,
        detected.definitionName,
        detected.detectedDir
      );
      saveEmulatorConfig(config);
    }
    showSuccess(t("emulator.imported", "Emulators imported successfully"));
    setView("list");
    setDetectedEmulators([]);
  }, [detectedEmulators, selectedDetected, configs, t]);

  // ─── Manual Add / Edit ─────────────────────────────────────────

  const handleAddManual = useCallback((def: EmulatorDefinition) => {
    setSelectedDef(def);
    setFormName(def.name);
    setFormInstallDir("");
    setFormExePath("");
    setFormProfile(def.profiles[0]?.name ?? "");
    setEditingConfig(null);
    setView("add");
  }, []);

  const handleEditConfig = useCallback((config: EmulatorConfig) => {
    const def = config.definitionId ? getEmulatorById(config.definitionId) : null;
    setSelectedDef(def ?? null);
    setEditingConfig(config);
    setFormName(config.name);
    setFormInstallDir(config.installDir);
    setFormExePath("");
    setFormProfile(config.profiles[0]?.name ?? def?.profiles[0]?.name ?? "");
    setView("edit");
  }, []);

  const handleBrowseInstallDir = useCallback(async () => {
    const folder = await pickFolder(
      t("emulator.select_install_dir", "Select Installation Directory"),
      formInstallDir || undefined
    );
    if (folder) setFormInstallDir(folder);
  }, [formInstallDir, t]);

  const handleBrowseExe = useCallback(async () => {
    const file = await openDialog({
      title: t("emulator.select_exe", "Select Executable"),
      filters: [{ name: "Executables", extensions: ["exe"] }],
      defaultPath: formInstallDir || undefined,
      multiple: false,
    });
    if (file) setFormExePath(file as string);
  }, [formInstallDir, t]);

  const handleSaveForm = useCallback(() => {
    if (!formName.trim() || !formInstallDir.trim()) return;

    if (editingConfig) {
      updateEmulatorConfig(editingConfig.id, {
        name: formName.trim(),
        installDir: formInstallDir.trim(),
      });
      showSuccess(t("emulator.updated", "Emulator updated"));
    } else if (selectedDef) {
      const config = createEmulatorConfig(
        selectedDef.id,
        formName.trim(),
        formInstallDir.trim()
      );
      saveEmulatorConfig(config);
      showSuccess(t("emulator.added", "Emulator added"));
    }

    setView("list");
    setEditingConfig(null);
    setSelectedDef(null);
  }, [formName, formInstallDir, editingConfig, selectedDef, t]);

  const handleDelete = useCallback((id: string) => {
    deleteEmulatorConfig(id);
  }, []);

  const configuredIds = new Set(configs.map((c) => c.definitionId).filter(Boolean) as string[]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative mx-4 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
              <Gamepad2 className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-neutral-100">
                {view === "list" && t("emulator.settings_title", "Emulator Settings")}
                {view === "import" && t("emulator.import_title", "Import Emulators")}
                {view === "add" && t("emulator.add_title", "Add Emulator")}
                {view === "edit" && t("emulator.edit_title", "Edit Emulator")}
              </h2>
              <p className="text-sm text-neutral-400">
                {view === "list" && t("emulator.settings_desc", "Configure emulators to play ROM games")}
                {view === "import" && t("emulator.import_desc", "Scan a folder to detect installed emulators")}
                {view === "add" && t("emulator.add_desc", "Configure a new emulator manually")}
                {view === "edit" && t("emulator.edit_desc", "Update emulator configuration")}
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
          {/* ── LIST VIEW ── */}
          {view === "list" && (
            <>
              {/* Configured Emulators */}
              {configs.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-medium text-neutral-300">
                    {t("emulator.configured", "Configured Emulators")}
                  </h3>
                  <div className="space-y-2">
                    {configs.map((config) => {
                      const def = config.definitionId ? getEmulatorById(config.definitionId) : null;
                      return (
                        <div
                          key={config.id}
                          className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/50 p-3"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <Monitor className="h-4 w-4 shrink-0 text-purple-400" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-neutral-200">
                                {config.name}
                              </p>
                              <p className="truncate text-xs text-neutral-500">
                                {def?.name ?? "Custom"}
                                {config.profiles.length > 0 && ` — ${config.profiles.length} profile(s)`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => handleEditConfig(config)}
                              className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(config.id)}
                              className="rounded p-1.5 text-neutral-400 hover:bg-red-500/10 hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => setView("import")}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/5 px-4 py-3 text-sm text-purple-300 transition-colors hover:bg-purple-500/10"
                >
                  <Search className="h-4 w-4" />
                  {t("emulator.import_btn", "Import Emulators")}
                </button>
                <button
                  onClick={() => setView("add")}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800/50 px-4 py-3 text-sm text-neutral-300 transition-colors hover:bg-neutral-800"
                >
                  <Cpu className="h-4 w-4" />
                  {t("emulator.add_btn", "Add Manually")}
                </button>
              </div>

              {/* Available Emulators Grid */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-neutral-300">
                  {t("emulator.available", "Available Emulators")}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {emulatorDefinitions.map((def) => {
                    const isConfigured = configuredIds.has(def.id);
                    return (
                      <button
                        key={def.id}
                        onClick={() => !isConfigured && handleAddManual(def)}
                        disabled={isConfigured}
                        className={`flex items-center gap-2 rounded-lg border p-3 text-left transition-colors ${
                          isConfigured
                            ? "border-neutral-700 bg-neutral-800/50 opacity-50"
                            : "border-neutral-700 bg-neutral-800/50 hover:border-purple-500/50 hover:bg-purple-500/5"
                        }`}
                      >
                        <Cpu className="h-4 w-4 shrink-0 text-neutral-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-neutral-200">{def.name}</p>
                          <p className="truncate text-xs text-neutral-500">
                            {def.profiles.length} profile{def.profiles.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                        {isConfigured && <Check className="h-4 w-4 shrink-0 text-green-400" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* ── IMPORT VIEW ── */}
          {view === "import" && (
            <div className="space-y-4">
              <p className="text-sm text-neutral-400">
                {t("emulator.import_instructions", "Select the folder where your emulators are installed. LumaForge will scan for known emulator executables.")}
              </p>

              {/* Folder picker */}
              <div>
                <label className="mb-1 block text-xs text-neutral-400">
                  {t("emulator.emulator_folder", "Emulator Folder")}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={importDir}
                    onChange={(e) => setImportDir(e.target.value)}
                    placeholder="C:\Emulators"
                    className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:border-purple-500 focus:outline-none"
                  />
                  <button
                    onClick={handleImportSelectFolder}
                    className="rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Scan button */}
              <button
                onClick={handleImportScan}
                disabled={!importDir || importing}
                className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {importing
                  ? t("emulator.scanning", "Scanning...")
                  : t("emulator.scan_btn", "Scan for Emulators")}
              </button>

              {/* Detected emulators */}
              {detectedEmulators.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-medium text-neutral-300">
                    {t("emulator.detected", "Detected Emulators")}
                  </h3>
                  <div className="space-y-2">
                    {detectedEmulators.map((detected) => (
                      <label
                        key={detected.definitionId}
                        className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedDetected.has(detected.definitionId)}
                          onChange={(e) => {
                            const next = new Set(selectedDetected);
                            if (e.target.checked) {
                              next.add(detected.definitionId);
                            } else {
                              next.delete(detected.definitionId);
                            }
                            setSelectedDetected(next);
                          }}
                          className="rounded border-neutral-600 bg-neutral-800 text-purple-500 focus:ring-purple-500"
                        />
                        <Monitor className="h-4 w-4 text-purple-400" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-neutral-200">
                            {detected.definitionName}
                          </p>
                          <p className="truncate text-xs text-neutral-500">
                            {detected.matchedProfiles.length} profile(s) — {detected.detectedDir}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>

                  <button
                    onClick={handleImportConfirm}
                    disabled={selectedDetected.size === 0}
                    className="mt-3 w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {t("emulator.import_confirm", "Import Selected")}
                  </button>
                </div>
              )}

              {/* No results */}
              {!importing && importDir && detectedEmulators.length === 0 && (
                <p className="text-center text-sm text-neutral-500">
                  {t("emulator.no_emulators_found", "No known emulators found in this directory.")}
                </p>
              )}

              {/* Back button */}
              <button
                onClick={() => setView("list")}
                className="w-full rounded-lg px-4 py-2 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
              >
                {t("common.back", "Back")}
              </button>
            </div>
          )}

          {/* ── ADD / EDIT VIEW ── */}
          {(view === "add" || view === "edit") && (
            <div className="space-y-4">
              {/* Emulator selector (add mode only) */}
              {view === "add" && !selectedDef && (
                <div>
                  <label className="mb-1 block text-xs text-neutral-400">
                    {t("emulator.select_emulator", "Select Emulator")}
                  </label>
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-neutral-700 bg-neutral-800 p-2">
                    {emulatorDefinitions
                      .filter((def) => !configuredIds.has(def.id))
                      .map((def) => (
                        <button
                          key={def.id}
                          onClick={() => handleAddManual(def)}
                          className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-700"
                        >
                          <Cpu className="h-4 w-4 text-neutral-400" />
                          <span>{def.name}</span>
                          <span className="ml-auto text-xs text-neutral-500">
                            {def.profiles.length} profiles
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* Form */}
              {(selectedDef || editingConfig) && (
                <div className="space-y-3">
                  {/* Name */}
                  <div>
                    <label className="mb-1 block text-xs text-neutral-400">
                      {t("emulator.name", "Name")}
                    </label>
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:border-purple-500 focus:outline-none"
                    />
                  </div>

                  {/* Installation Directory */}
                  <div>
                    <label className="mb-1 block text-xs text-neutral-400">
                      {t("emulator.install_dir", "Installation Directory")}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={formInstallDir}
                        onChange={(e) => setFormInstallDir(e.target.value)}
                        placeholder="C:\Emulators\RetroArch"
                        className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:border-purple-500 focus:outline-none"
                      />
                      <button
                        onClick={handleBrowseInstallDir}
                        className="rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
                      >
                        <FolderOpen className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Executable Path */}
                  <div>
                    <label className="mb-1 block text-xs text-neutral-400">
                      {t("emulator.exe_path", "Executable (optional)")}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={formExePath}
                        onChange={(e) => setFormExePath(e.target.value)}
                        placeholder="C:\Emulators\RetroArch\retroarch.exe"
                        className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:border-purple-500 focus:outline-none"
                      />
                      <button
                        onClick={handleBrowseExe}
                        className="rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
                      >
                        <FolderOpen className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Profile Selection */}
                  {selectedDef && selectedDef.profiles.length > 0 && (
                    <div>
                      <label className="mb-1 block text-xs text-neutral-400">
                        {t("emulator.default_profile", "Default Profile")}
                      </label>
                      <div className="relative">
                        <select
                          value={formProfile}
                          onChange={(e) => setFormProfile(e.target.value)}
                          className="w-full appearance-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 pr-8 text-sm text-neutral-200 focus:border-purple-500 focus:outline-none"
                        >
                          {selectedDef.profiles.map((p) => (
                            <option key={p.name} value={p.name}>
                              {p.name} ({p.platforms.join(", ")})
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={() => {
                        setView("list");
                        setEditingConfig(null);
                        setSelectedDef(null);
                      }}
                      className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                    >
                      {t("common.cancel", "Cancel")}
                    </button>
                    <button
                      onClick={handleSaveForm}
                      disabled={!formName.trim() || !formInstallDir.trim()}
                      className="rounded-lg bg-purple-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                    >
                      {editingConfig
                        ? t("common.save", "Save")
                        : t("emulator.add_btn", "Add Emulator")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {view === "list" && (
          <div className="flex justify-end border-t border-neutral-800 px-6 py-4">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              {t("common.close", "Close")}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
