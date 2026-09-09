/**
 * EmulatorListPanel
 *
 * Left panel showing the list of configured emulators with Import/Add/Copy/Remove buttons.
 * Matches Playnite's left panel in the Emulators tab.
 */

import { useTranslation } from "react-i18next";
import { Monitor, Search, Plus, Copy, Trash2 } from "lucide-react";
import type { EmulatorConfig } from "../../data/emulatorDefinitions/types";

type EmulatorListPanelProps = {
  configs: EmulatorConfig[];
  selectedConfigId: string | null;
  onSelect: (id: string | null) => void;
  onImport: () => void;
  onAdd: () => void;
  onCopy: () => void;
  onRemove: () => void;
};

export function EmulatorListPanel({
  configs,
  selectedConfigId,
  onSelect,
  onImport,
  onAdd,
  onCopy,
  onRemove,
}: EmulatorListPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="w-[250px] shrink-0 flex flex-col border border-(--surface-active-border) rounded-lg bg-(--surface-active)/50">
      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {configs.length > 0 ? (
          configs.map((config) => (
            <button
              key={config.id}
              onClick={() => onSelect(config.id)}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                selectedConfigId === config.id
                  ? "bg-(--color-accent)/10 text-(--color-accent)"
                  : "text-(--color-text) hover:bg-white/10"
              }`}
            >
              <Monitor className="h-4 w-4 shrink-0 text-(--color-accent)" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{config.name}</p>
                <p className="truncate text-xs text-(--color-muted)">
                  {t('emulator.profile_count', '{{count}} profile(s)', { count: config.profiles.length })}
                </p>
              </div>
            </button>
          ))
        ) : (
          <div className="flex h-full items-center justify-center px-3 py-8">
            <p className="text-xs text-(--color-muted) text-center">
              {t("emulator.no_emulators", "No emulators configured")}
            </p>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex border-t border-(--surface-active-border) p-2 gap-1">
        <button
          onClick={onImport}
          className="flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-xs text-(--color-text) hover:bg-white/10"
          title={t("emulator.import_btn", "Import Emulators")}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">{t("common.import", "Import")}</span>
        </button>
        <button
          onClick={onAdd}
          className="flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-xs text-(--color-text) hover:bg-white/10"
          title={t("emulator.add_btn", "Add Emulator")}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">{t("common.add", "Add")}</span>
        </button>
        <button
          onClick={onCopy}
          disabled={!selectedConfigId}
          className="flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-xs text-(--color-text) hover:bg-white/10 disabled:opacity-30"
          title={t("emulator.copy_btn", "Copy Emulator")}
        >
          <Copy className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">{t("common.copy", "Copy")}</span>
        </button>
        <button
          onClick={onRemove}
          disabled={!selectedConfigId}
          className="flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-xs text-(--color-muted) hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30"
          title={t("emulator.remove_btn", "Remove Emulator")}
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">{t("common.remove", "Remove")}</span>
        </button>
      </div>
    </div>
  );
}
