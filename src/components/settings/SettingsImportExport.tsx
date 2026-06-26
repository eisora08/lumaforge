import { Download, Upload } from "lucide-react";
import { useRef } from "react";

import { useSettings } from "../../context/SettingsContext";
import { useTheme } from "../../context/ThemeContext";
import {
  downloadJsonFile,
  isValidSettingsBackup,
  readJsonFile,
} from "../../utils/settingsBackup";
import { SettingsBackup } from "../../types/settingsBackup";

export default function SettingsImportExport() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { settings, replaceSettings } = useSettings();
  const { theme, surfaceMode, setTheme, setSurfaceMode } = useTheme();

  function handleExport() {
    const backup: SettingsBackup = {
      app: "LumaForge",
      version: 1,
      exportedAt: new Date().toISOString(),
      theme,
      surfaceMode,
      settings,
    };

    downloadJsonFile("lumaforge-settings.json", backup);
  }

  async function handleImport(file: File) {
    try {
      const backup = await readJsonFile<unknown>(file);

      if (!isValidSettingsBackup(backup)) {
        alert("El archivo no parece ser una configuración válida de LumaForge.");
        return;
      }

      replaceSettings(backup.settings);
      setTheme(backup.theme);
      setSurfaceMode(backup.surfaceMode);

      alert("Configuración importada correctamente.");
    } catch (error) {
      console.error(error);
      alert("No se pudo importar la configuración.");
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <button
        type="button"
        onClick={handleExport}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-sm text-(--color-text) transition hover:bg-white/10"
      >
        <Download className="h-4 w-4" />
        Exportar configuración
      </button>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-sm text-(--color-text) transition hover:bg-white/10"
      >
        <Upload className="h-4 w-4" />
        Importar configuración
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file) {
            handleImport(file);
          }

          event.target.value = "";
        }}
      />
    </div>
  );
}