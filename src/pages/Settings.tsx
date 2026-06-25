import { useState } from "react";
import {
  Palette,
  Globe,
  FolderCog,
  SlidersHorizontal,
} from "lucide-react";

import SettingsSection from "../components/settings/SettingsSection";
import ThemeOption from "../components/settings/ThemeOption";
import SettingsInput from "../components/settings/SettingsInput";
import ToggleOption from "../components/settings/ToggleOption";

import { ThemeId, ThemeOption as ThemeOptionType } from "../types/theme";

const themes: ThemeOptionType[] = [
  {
    id: "crimson-dark",
    name: "Crimson Dark",
    description: "Tema oscuro premium con tonos vino y acento azul claro.",
    preview: {
      background: "#181114",
      surface: "#302b2f",
      accent: "#b8d7dc",
    },
  },
  {
    id: "midnight-blue",
    name: "Midnight Blue",
    description: "Estilo launcher nocturno con tonos azules profundos.",
    preview: {
      background: "#0f172a",
      surface: "#1e293b",
      accent: "#38bdf8",
    },
  },
  {
    id: "steam-gray",
    name: "Steam Gray",
    description: "Inspirado en launchers clásicos con grises elegantes.",
    preview: {
      background: "#171a21",
      surface: "#2a475e",
      accent: "#66c0f4",
    },
  },
  {
    id: "oled-black",
    name: "OLED Black",
    description: "Negro profundo para pantallas OLED y máximo contraste.",
    preview: {
      background: "#000000",
      surface: "#111111",
      accent: "#ffffff",
    },
  },
];

export default function Settings() {
  const [selectedTheme, setSelectedTheme] =
    useState<ThemeId>("crimson-dark");

  return (
    <div className="p-5 lg:p-7 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Configuración</h1>
        <p className="mt-2 text-gray-400">
          Personaliza LumaForge, rutas, API, apariencia y comportamiento.
        </p>
      </header>

      <SettingsSection
        title="Apariencia"
        description="Cambia el estilo visual de LumaForge."
      >
        <div className="mb-4 flex items-center gap-2 text-sm text-[#b8d7dc]">
          <Palette className="h-4 w-4" />
          Tema actual: {themes.find((theme) => theme.id === selectedTheme)?.name}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {themes.map((theme) => (
            <ThemeOption
              key={theme.id}
              theme={theme}
              selected={selectedTheme === theme.id}
              onSelect={setSelectedTheme}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="API"
        description="Configura la conexión con el catálogo de paquetes."
      >
        <div className="mb-4 flex items-center gap-2 text-sm text-[#b8d7dc]">
          <Globe className="h-4 w-4" />
          Catálogo remoto
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
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
        <div className="mb-4 flex items-center gap-2 text-sm text-[#b8d7dc]">
          <FolderCog className="h-4 w-4" />
          Steam y carpetas internas
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
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
        <div className="mb-4 flex items-center gap-2 text-sm text-[#b8d7dc]">
          <SlidersHorizontal className="h-4 w-4" />
          Sistema
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
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