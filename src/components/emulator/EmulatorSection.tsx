/**
 * EmulatorSection
 *
 * Inline settings section for managing emulators and auto-scan configurations.
 * Matches Playnite's "Configure Emulators" window layout:
 *   Tab 1: Emulators — left panel (list + buttons), right panel (config + profiles)
 *   Tab 2: Auto-scan configurations — left panel (list + buttons), right panel (scanner config)
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Gamepad2, Plus, Copy, Trash2, Search, Settings,
} from "lucide-react";
import {
  getAllEmulatorConfigs,
  saveEmulatorConfig,
  deleteEmulatorConfig,
  createEmulatorConfig,
  copyEmulatorConfig,
  createCustomProfile,
  cloneProfile,
  onEmulatorConfigChange,
} from "../../services/emulatorConfigStore";
import {
  getAllScanConfigs,
  saveScanConfig,
  deleteScanConfig,
  copyScanConfig,
  onScanConfigChange,
} from "../../services/scanConfigStore";
import type { EmulatorConfig, EmulatorProfileConfig, ScanConfiguration } from "../../data/emulatorDefinitions/types";
import { pickFolder } from "../../services/tauri";
import { showError, showSuccess } from "../toast/GameToast";
import SettingsSection from "../settings/SettingsSection";
import { EmulatorListPanel } from "./EmulatorListPanel";
import { EmulatorDetailPanel } from "./EmulatorDetailPanel";
import { ProfileEditor } from "./ProfileEditor";
import { AutoScanSection } from "./AutoScanSection";

// ─── Types ─────────────────────────────────────────────────────────────

type TabId = "emulators" | "autoscan";

// ─── Component ─────────────────────────────────────────────────────────

export default function EmulatorSection() {
  const { t } = useTranslation();

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<TabId>("emulators");

  // ── Emulator state ──
  const [configs, setConfigs] = useState<EmulatorConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  // ── Scan config state ──
  const [scanConfigs, setScanConfigs] = useState<ScanConfiguration[]>([]);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);

  // ── Load ──
  useEffect(() => {
    setConfigs(getAllEmulatorConfigs());
    setScanConfigs(getAllScanConfigs());
  }, []);

  useEffect(() => {
    return onEmulatorConfigChange(() => setConfigs(getAllEmulatorConfigs()));
  }, []);

  useEffect(() => {
    return onScanConfigChange(() => setScanConfigs(getAllScanConfigs()));
  }, []);

  // ── Derived ──
  const selectedConfig = configs.find((c) => c.id === selectedConfigId) ?? null;
  const selectedProfile = selectedConfig?.profiles.find((p) => p.id === selectedProfileId) ?? null;
  const selectedScanConfig = scanConfigs.find((c) => c.id === selectedScanId) ?? null;

  // ── Emulator actions ──

  const handleImportEmulators = useCallback(async () => {
    const folder = await pickFolder(
      t("emulator.select_emulators_folder", "Select Emulators Folder")
    );
    if (!folder) return;

    // Use emulator scanner to detect emulators in the folder
    const { scanForEmulators } = await import("../../services/emulatorScanner");
    try {
      const detected = await scanForEmulators(folder);
      let imported = 0;
      for (const d of detected) {
        if (configs.some((c) => c.definitionId === d.definitionId)) continue;
        const config = createEmulatorConfig(d.definitionId, d.definitionName, d.detectedDir);
        // Auto-create a profile from the first detected profile
        if (d.matchedProfiles.length > 0) {
          const bp = d.matchedProfiles[0];
          config.profiles.push({
            id: `#builtin_${crypto.randomUUID()}`,
            name: bp.name,
            type: "builtin",
            builtinProfileName: bp.name,
            overrideDefaultArgs: false,
            supportedPlatforms: [],
            supportedFileTypes: [],
            trackingMode: "default",
          });
        }
        saveEmulatorConfig(config);
        imported++;
      }
      if (imported > 0) {
        showSuccess(t("emulator.imported_count", "Imported {{count}} emulator(s)", { count: imported }));
      } else {
        showSuccess(t("emulator.nothing_new", "No new emulators found"));
      }
    } catch {
      showError(t("emulator.scan_error", "Failed to scan directory"));
    }
  }, [configs, t]);

  const handleAddManual = useCallback(() => {
    // Create a blank config — user picks the definition in the detail panel
    const config = createEmulatorConfig("", "New Emulator", "");
    saveEmulatorConfig(config);
    setSelectedConfigId(config.id);
    setSelectedProfileId(null);
  }, []);

  const handleCopyEmulator = useCallback(() => {
    if (!selectedConfig) return;
    const copy = copyEmulatorConfig(selectedConfig);
    saveEmulatorConfig(copy);
    setSelectedConfigId(copy.id);
    setSelectedProfileId(null);
    showSuccess(t("emulator.copied", "Emulator copied"));
  }, [selectedConfig, t]);

  const handleRemoveEmulator = useCallback(async () => {
    if (!selectedConfig) return;
    deleteEmulatorConfig(selectedConfig.id);
    setSelectedConfigId(null);
    setSelectedProfileId(null);
  }, [selectedConfig]);

  const handleConfigChange = useCallback((config: EmulatorConfig) => {
    saveEmulatorConfig(config);
  }, []);

  // ── Profile actions ──

  const handleAddProfile = useCallback(() => {
    if (!selectedConfig) return;
    const profile = createCustomProfile("New Profile");
    selectedConfig.profiles.push(profile);
    saveEmulatorConfig(selectedConfig);
    setSelectedProfileId(profile.id);
  }, [selectedConfig]);

  const handleCopyProfile = useCallback(() => {
    if (!selectedConfig || !selectedProfile) return;
    const copy = cloneProfile(selectedProfile);
    selectedConfig.profiles.push(copy);
    saveEmulatorConfig(selectedConfig);
    setSelectedProfileId(copy.id);
  }, [selectedConfig, selectedProfile]);

  const handleRemoveProfile = useCallback(() => {
    if (!selectedConfig || !selectedProfileId) return;
    selectedConfig.profiles = selectedConfig.profiles.filter((p) => p.id !== selectedProfileId);
    saveEmulatorConfig(selectedConfig);
    setSelectedProfileId(null);
  }, [selectedConfig, selectedProfileId]);

  const handleProfileChange = useCallback((profile: EmulatorProfileConfig) => {
    if (!selectedConfig) return;
    const updatedConfig = {
      ...selectedConfig,
      profiles: selectedConfig.profiles.map((p) =>
        p.id === profile.id ? profile : p
      ),
    };
    saveEmulatorConfig(updatedConfig);
  }, [selectedConfig]);

  // ── Scan config actions ──

  const handleAddScanConfig = useCallback(() => {
    const newId = crypto.randomUUID();
    const now = Date.now();
    const config: ScanConfiguration = {
      id: newId,
      name: "New Scan Config",
      emulatorId: "",
      profileId: "",
      directory: "",
      playActionSettings: "scanner",
      crcExcludeFileTypes: [],
      excludeOnlineFiles: false,
      useSimplifiedScan: false,
      importWithRelativePaths: true,
      scanSubfolders: true,
      scanInsideArchives: true,
      mergeRelatedFiles: true,
      includeInGlobalUpdate: true,
      excludedFiles: [],
      excludedDirectories: [],
      createdAt: now,
      updatedAt: now,
    };
    saveScanConfig(config);
    setScanConfigs(getAllScanConfigs());
    setSelectedScanId(newId);
  }, []);

  const handleCopyScanConfig = useCallback(() => {
    if (!selectedScanConfig) return;
    const copy = copyScanConfig(selectedScanConfig);
    saveScanConfig(copy);
    setScanConfigs(getAllScanConfigs());
    setSelectedScanId(copy.id);
  }, [selectedScanConfig]);

  const handleRemoveScanConfig = useCallback(() => {
    if (!selectedScanId) return;
    deleteScanConfig(selectedScanId);
    setScanConfigs(getAllScanConfigs());
    setSelectedScanId(null);
  }, [selectedScanId]);

  return (
    <SettingsSection
      title={t("settings.emulators", "Emulators")}
      description={t("settings.emulators_desc", "Configure emulators for playing ROM games")}
    >
      {/* ── Tab Bar ── */}
      <div className="flex gap-0 border-b border-(--surface-active-border) mb-4">
        <button
          onClick={() => setActiveTab("emulators")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "emulators"
              ? "border-b-2 border-(--color-accent) text-(--color-accent)"
              : "text-(--color-muted) hover:text-(--color-text)"
          }`}
        >
          <Gamepad2 className="mr-1.5 inline h-4 w-4" />
          {t("emulator.tab_emulators", "Emulators")}
        </button>
        <button
          onClick={() => setActiveTab("autoscan")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "autoscan"
              ? "border-b-2 border-(--color-accent) text-(--color-accent)"
              : "text-(--color-muted) hover:text-(--color-text)"
          }`}
        >
          <Search className="mr-1.5 inline h-4 w-4" />
          {t("emulator.tab_autoscan", "Auto-scan configurations")}
        </button>
      </div>

      {/* ── Tab Content ── */}
      {activeTab === "emulators" && (
        <div className="flex gap-4 min-h-[400px]">
          {/* Left Panel — Emulator List */}
          <EmulatorListPanel
            configs={configs}
            selectedConfigId={selectedConfigId}
            onSelect={setSelectedConfigId}
            onImport={handleImportEmulators}
            onAdd={handleAddManual}
            onCopy={handleCopyEmulator}
            onRemove={handleRemoveEmulator}
          />

          {/* Right Panel — Emulator Detail */}
          <div className="flex-1 min-w-0">
            {selectedConfig ? (
              <div className="space-y-4">
                <EmulatorDetailPanel
                  config={selectedConfig}
                  onChange={handleConfigChange}
                />

                {/* Profiles Section */}
                <div className="border-t border-(--surface-active-border) pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-(--color-text)">
                      {t("emulator.profiles", "Profiles")}
                    </h3>
                    <div className="flex gap-1">
                      <button
                        onClick={handleAddProfile}
                        className="rounded p-1.5 text-(--color-muted) hover:bg-white/10 hover:text-(--color-text)"
                        title={t("emulator.add_profile", "Add Profile")}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                      <button
                        onClick={handleCopyProfile}
                        disabled={!selectedProfile}
                        className="rounded p-1.5 text-(--color-muted) hover:bg-white/10 hover:text-(--color-text) disabled:opacity-30"
                        title={t("emulator.copy_profile", "Copy Profile")}
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        onClick={handleRemoveProfile}
                        disabled={!selectedProfileId}
                        className="rounded p-1.5 text-(--color-muted) hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30"
                        title={t("emulator.remove_profile", "Remove Profile")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Profile List */}
                  <div className="max-h-40 overflow-y-auto rounded border border-(--surface-active-border) bg-white/5">
                    {selectedConfig.profiles.length > 0 ? (
                      selectedConfig.profiles.map((profile) => (
                        <button
                          key={profile.id}
                          onClick={() => {
                            setSelectedProfileId(profile.id);
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                            selectedProfileId === profile.id
                              ? "bg-(--color-accent)/10 text-(--color-accent)"
                              : "text-(--color-text) hover:bg-white/10"
                          }`}
                        >
                          <Settings className="h-3.5 w-3.5 shrink-0 text-(--color-muted)" />
                          <span className="truncate">{profile.name}</span>
                          <span className="ml-auto text-xs text-(--color-muted)">
                            {profile.type === "builtin" ? t("emulator.builtin", "Built-in") : t("emulator.custom", "Custom")}
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="px-3 py-2 text-xs text-(--color-muted)">
                        {t("emulator.no_profiles", "No profiles. Click + to add one.")}
                      </p>
                    )}
                  </div>

                  {/* Profile Editor */}
                  {selectedProfile && (
                    <div className="mt-3">
                      <ProfileEditor
                        profile={selectedProfile}
                        onChange={handleProfileChange}
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-(--color-muted)">
                {t("emulator.select_config", "Select an emulator from the list, or add a new one.")}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "autoscan" && (
        <AutoScanSection
          scanConfigs={scanConfigs}
          emulatorConfigs={configs}
          selectedScanId={selectedScanId}
          onSelectScan={setSelectedScanId}
          onAdd={handleAddScanConfig}
          onCopy={handleCopyScanConfig}
          onRemove={handleRemoveScanConfig}
          onChange={(config) => {
            saveScanConfig(config);
            setScanConfigs(getAllScanConfigs());
          }}
        />
      )}
    </SettingsSection>
  );
}
