/**
 * EmulatorDetailPanel
 *
 * Right panel showing emulator configuration fields:
 * Name, InstallDir, Emulator Specification dropdown.
 * Matches Playnite's right panel in the Emulators tab.
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, ChevronDown } from "lucide-react";
import type { EmulatorConfig } from "../../data/emulatorDefinitions/types";
import { emulatorDefinitions } from "../../data/emulatorDefinitions";
import { pickFolder } from "../../services/tauri";

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
          className="w-full rounded border border-(--surface-active-border) bg-white/5 px-3 py-2 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none"
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
            className="flex-1 rounded border border-(--surface-active-border) bg-white/5 px-3 py-2 text-sm text-(--color-text) placeholder-(--color-muted) focus:border-(--color-accent) focus:outline-none"
          />
          <button
            onClick={handleBrowseInstallDir}
            className="rounded border border-(--surface-active-border) bg-white/5 px-3 py-2 text-sm text-(--color-text) hover:bg-white/10"
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
        <div className="relative">
          <select
            value={config.definitionId ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              onChange({ ...config, definitionId: val || undefined });
            }}
            className="w-full appearance-none rounded border border-(--surface-active-border) bg-white/5 px-3 py-2 pr-8 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none"
          >
            <option value="">{t("emulator.no_spec", "(none)")}</option>
            {emulatorDefinitions.map((def) => (
              <option key={def.id} value={def.id}>
                {def.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted)" />
        </div>
        <p className="mt-1 text-xs text-(--color-muted)">
          {t("emulator.spec_hint", "Link to a known emulator for auto-detected profiles")}
        </p>
      </div>
    </div>
  );
}
