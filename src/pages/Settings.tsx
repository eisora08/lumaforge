import {
  Palette,
  Globe,
  FolderCog,
  SlidersHorizontal,
} from "lucide-react";

import SettingsSection from "../components/settings/SettingsSection";
import ThemeOption from "../components/settings/ThemeOption";
import SurfaceModeOption from "../components/settings/SurfaceModeOption";
import SettingsInput from "../components/settings/SettingsInput";
import ToggleOption from "../components/settings/ToggleOption";

import { themes, surfaceModes } from "../theme/themes";
import { useTheme } from "../context/ThemeContext";

export default function Settings() {
  const {
    theme: selectedTheme,
    surfaceMode,
    setTheme,
    setSurfaceMode,
  } = useTheme();

  const currentTheme = themes.find((theme) => theme.id === selectedTheme);

  return (
    <div className="space-y-6 p-5 lg:p-7">
      <header>
        <h1 className="text-3xl font-bold text-(--color-text)">
          Configuración
        </h1>

        <p className="mt-2 text-(--color-muted)">
          Personaliza LumaForge, rutas, API, apariencia y comportamiento.
        </p>
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
        title="API"
        description="Configura la conexión con el catálogo de paquetes."
      >
        <div className="mb-4 flex items-center gap-2 text-sm text-(--color-accent)">
          <Globe className="h-4 w-4" />
          Catálogo remoto
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SettingsInput
            label="Base URL"
            description="URL principal desde donde se consultarán los paquetes."
            placeholder="https://api.tu-dominio.com"
          />

          <SettingsInput
            label="API Key"
            description="Opcional. Solo si tu API requiere autenticación."
            placeholder="No configurada"
          />
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
          />

          <SettingsInput
            label="config/lua"
            description="Destino para archivos .lua instalados."
            placeholder="No detectada"
          />

          <SettingsInput
            label="depotcache"
            description="Destino para archivos .manifest."
            placeholder="No detectado"
          />

          <SettingsInput
            label="Carpeta temporal"
            description="Ubicación para descargas y extracción de ZIP."
            placeholder="Usar carpeta temporal del sistema"
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
            enabled
          />

          <ToggleOption
            label="Guardar logs detallados"
            description="Registra instalaciones, descargas, errores y rutas."
            enabled
          />

          <ToggleOption
            label="Limpiar temporales al cerrar"
            description="Elimina ZIPs y carpetas extraídas al salir."
          />

          <ToggleOption
            label="Modo compacto"
            description="Reduce animaciones y espaciado visual."
          />
        </div>
      </SettingsSection>
    </div>
  );
}