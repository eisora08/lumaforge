/**
 * EmulatorDetailPanel
 *
 * Right panel showing emulator configuration fields:
 * Name, InstallDir, Emulator Specification dropdown.
 * Matches Playnite's right panel in the Emulators tab.
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react";
import type { EmulatorConfig } from "../../data/emulatorDefinitions/types";
import { emulatorDefinitions } from "../../data/emulatorDefinitions";
import { pickFolder } from "../../services/tauri";
import SourceDropdown from "../common/SourceDropdown";

type EmulatorDetailPanelProps = {
  config: EmulatorConfig;
  onChange: (config: EmulatorConfig) => void;
};

export function EmulatorDetailPanel({ config, onChange }: EmulatorDetailPanelProps) {
  const { t } = useTranslation();

  const handleBrowseInstallDir = useCallback(async () => {
    const folder = await pickFolder(
      t("emulator.select_install_dir", "Select Installation Directory"),
      config.installDir || undefined
    );
    if (folder) {
      onChange({ ...config, installDir: folder });
    }
  }, [config, onChange, t]);

  return (
    <div className="space-y-3">
      {/* Name */}
      <div>
        <label className="mb-1 block text-xs text-(--color-muted)">
          {t("emulator.name", "Name")}
        </label>
        <input
          type="text"
          value={config.name}
          onChange={(e) => onChange({ ...config, name: e.target.value })}
          className="w-full rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-2 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none"
        />
      </div>

      {/* Installation Directory */}
      <div>
        <label className="mb-1 block text-xs text-(--color-muted)">
          {t("emulator.install_dir", "Installation Directory")}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={config.installDir}
            onChange={(e) => onChange({ ...config, installDir: e.target.value })}
            placeholder="C:\Emulators\RetroArch"
            className="flex-1 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-2 text-sm text-(--color-text) placeholder-(--color-muted) focus:border-(--color-accent) focus:outline-none"
          />
          <button
            onClick={handleBrowseInstallDir}
            className="rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-2 text-sm text-(--color-text) hover:bg-white/10"
          >
            <FolderOpen className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Emulator Specification */}
      <div>
        <label className="mb-1 block text-xs text-(--color-muted)">
          {t("emulator.specification", "Emulator Specification")}
        </label>
        <SourceDropdown
          className="w-full"
          portal
          value={config.definitionId ?? ""}
          onChange={(val) => onChange({ ...config, definitionId: val || undefined })}
          options={[
            { value: "", label: t("emulator.no_spec", "(none)") },
            ...emulatorDefinitions.map((def) => ({
              value: def.id,
              label: def.name,
            })),
          ]}
        />
        <p className="mt-1 text-xs text-(--color-muted)">
          {t("emulator.spec_hint", "Link to a known emulator for auto-detected profiles")}
        </p>
      </div>
    </div>
  );
}
