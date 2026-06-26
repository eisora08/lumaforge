import {
  Palette,
  Globe,
  FolderCog,
  SlidersHorizontal,
  RotateCcw,
} from "lucide-react";

import ProviderSettingsCard from "../components/settings/ProviderSettingsCard";
import { defaultApiProviders } from "../data/providers";
import { ApiProviderUserSettings } from "../types/provider";

import SettingsSection from "../components/settings/SettingsSection";
import ThemeOption from "../components/settings/ThemeOption";
import SurfaceModeOption from "../components/settings/SurfaceModeOption";
import SettingsInput from "../components/settings/SettingsInput";
import ToggleOption from "../components/settings/ToggleOption";
import SettingsImportExport from "../components/settings/SettingsImportExport";
import { themes, surfaceModes } from "../theme/themes";
import { useTheme } from "../context/ThemeContext";
import { useSettings } from "../context/SettingsContext";

export default function Settings() {
  const {
    theme: selectedTheme,
    surfaceMode,
    setTheme,
    setSurfaceMode,
  } = useTheme();

  const {
    settings,
    updateSetting,
    resetSettings,
  } = useSettings();

  const currentTheme = themes.find((theme) => theme.id === selectedTheme);

  return (
    <div className="space-y-6 p-5 lg:p-7">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-(--color-text)">
            Configuración
          </h1>

          <p className="mt-2 text-(--color-muted)">
            Personaliza LumaForge, rutas, API, apariencia y comportamiento.
          </p>
        </div>

        <button
          onClick={resetSettings}
          className="inline-flex w-fit items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm text-(--color-text) transition hover:bg-white/10"
        >
          <RotateCcw className="h-4 w-4" />
          Restablecer
        </button>
      </header>

      <SettingsSection
        title="Apariencia"
        description="Cambia el estilo visual de LumaForge."
      >
        <div className="mb-4 flex items-center gap-2 text-sm text-(--color-accent)">
          <Palette className="h-4 w-4" />
          Tema actual: {currentTheme?.name}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {themes.map((theme) => (
            <ThemeOption
              key={theme.id}
              theme={theme}
              selected={selectedTheme === theme.id}
              onSelect={setTheme}
            />
          ))}
        </div>

        <div className="mt-6">
          <div className="mb-3">
            <h3 className="font-medium text-(--color-text)">
              Estilo de superficie
            </h3>

            <p className="mt-1 text-sm text-(--color-muted)">
              Define cómo se ven las cards, paneles y contenedores.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {surfaceModes.map((mode) => (
              <SurfaceModeOption
                key={mode.id}
                mode={mode}
                selected={surfaceMode === mode.id}
                onSelect={setSurfaceMode}
              />
            ))}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Importar / Exportar"
        description="Guarda o restaura tu configuración local de LumaForge."
      >
        <SettingsImportExport />
      </SettingsSection>

      <SettingsSection
        title="Providers / APIs"
        description="Configura las fuentes que LumaForge usará para buscar y descargar paquetes."
      >
        <div className="mb-4 flex items-center gap-2 text-sm text-(--color-accent)">
          <Globe className="h-4 w-4" />
          Multi-provider fallback
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {defaultApiProviders.map((provider) => {
            const providerSettings = settings.providers[provider.id];

            function handleProviderChange(nextProviderSettings: ApiProviderUserSettings) {
              updateSetting("providers", {
                ...settings.providers,
                [provider.id]: nextProviderSettings,
              });
            }

            return (
              <ProviderSettingsCard
                key={provider.id}
                provider={provider}
                settings={providerSettings}
                onChange={handleProviderChange}
              />
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Rutas"
        description="Administra rutas detectadas o configuradas manualmente."
      >
        <div className="mb-4 flex items-center gap-2 text-sm text-(--color-accent)">
          <FolderCog className="h-4 w-4" />
          Steam y carpetas internas
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SettingsInput
            label="Steam Root"
            description="Carpeta raíz donde está steam.exe."
            placeholder="No detectada"
            value={settings.steamRoot}
            onChange={(value) => updateSetting("steamRoot", value)}
          />

          <SettingsInput
            label="config/lua"
            description="Destino para archivos .lua instalados."
            placeholder="No detectada"
            value={settings.luaPath}
            onChange={(value) => updateSetting("luaPath", value)}
          />

          <SettingsInput
            label="depotcache"
            description="Destino para archivos .manifest."
            placeholder="No detectado"
            value={settings.depotcachePath}
            onChange={(value) => updateSetting("depotcachePath", value)}
          />

          <SettingsInput
            label="Carpeta temporal"
            description="Ubicación para descargas y extracción de ZIP."
            placeholder="Usar carpeta temporal del sistema"
            value={settings.tempFolder}
            onChange={(value) => updateSetting("tempFolder", value)}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Avanzado"
        description="Opciones de mantenimiento, logs y seguridad."
      >
        <div className="mb-4 flex items-center gap-2 text-sm text-(--color-accent)">
          <SlidersHorizontal className="h-4 w-4" />
          Sistema
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ToggleOption
            label="Crear backups automáticamente"
            description="Antes de sobrescribir archivos existentes."
            enabled={settings.createBackups}
            onChange={(enabled) => updateSetting("createBackups", enabled)}
          />

          <ToggleOption
            label="Guardar logs detallados"
            description="Registra instalaciones, descargas, errores y rutas."
            enabled={settings.detailedLogs}
            onChange={(enabled) => updateSetting("detailedLogs", enabled)}
          />

          <ToggleOption
            label="Limpiar temporales al cerrar"
            description="Elimina ZIPs y carpetas extraídas al salir."
            enabled={settings.cleanTempOnExit}
            onChange={(enabled) => updateSetting("cleanTempOnExit", enabled)}
          />

          <ToggleOption
            label="Modo compacto"
            description="Reduce animaciones y espaciado visual."
            enabled={settings.compactMode}
            onChange={(enabled) => updateSetting("compactMode", enabled)}
          />
        </div>
      </SettingsSection>
    </div>
  );
}