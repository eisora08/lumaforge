import { useState } from "react";
import {
  Eye,
  EyeOff,
  Palette,
  Globe,
  FolderCog,
  SlidersHorizontal,
  RotateCcw,
  Crosshair,
  Plus,
  Trash2,
  FolderSearch,
  Gamepad2,
  Cog,
  BookOpen,
  MonitorSmartphone,
  Download,
  Database,
  Image,
  Library,
  Power,
  Info,
  ExternalLink,
  Code,
  FolderOpen,
} from "lucide-react";

import {
  showError,
  showSuccess,
  showWarning,
} from "../components/toast/GameToast";

import { detectSteamPaths } from "../services/tauri";

import ProviderSettingsCard from "../components/settings/ProviderSettingsCard";
import HubcapProviderBadges from "../components/settings/HubcapProviderBadges";
import SettingsSection from "../components/settings/SettingsSection";
import CardLayoutEditor from "../components/settings/CardLayoutEditor";
import CollectionsSection from "../components/settings/CollectionsSection";
import ThemeOption from "../components/settings/ThemeOption";
import SurfaceModeOption from "../components/settings/SurfaceModeOption";
import SettingsInput from "../components/settings/SettingsInput";
import ToggleOption from "../components/settings/ToggleOption";
import SettingsImportExport from "../components/settings/SettingsImportExport";
import SteamAccountDetector from "../components/settings/SteamAccountDetector";
import PageContainer from "../components/layout/PageContainer";

import { defaultApiProviders } from "../data/providers";
import { ApiProviderUserSettings } from "../types/provider";

import { themes, surfaceModes } from "../theme/themes";
import { useTheme } from "../context/ThemeContext";
import { useSettings } from "../context/SettingsContext";
import { clearIgdbTokenCache } from "../services/igdbAccessTokenService";
import { openExternalUrl } from "../services/externalLinks";

type SettingsSectionId =
  | "general"
  | "appearance"
  | "library"
  | "collections"
  | "metadata"
  | "artwork"
  | "manual"
  | "console"
  | "packages"
  | "advanced"
  | "startup"
  | "about";

const navSections: {
  key: SettingsSectionId;
  label: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  { key: "general", label: "General", icon: <Cog className="h-4 w-4" />, description: "Steam paths and auto-detection" },
  { key: "appearance", label: "Appearance", icon: <Palette className="h-4 w-4" />, description: "Theme, surface and display mode" },
  { key: "library", label: "Library & Sources", icon: <Library className="h-4 w-4" />, description: "Grid, dashboard, detection and notifications" },
  { key: "collections", label: "Collections", icon: <FolderOpen className="h-4 w-4" />, description: "Game grouping and organization" },
  { key: "metadata", label: "Metadata Providers", icon: <Database className="h-4 w-4" />, description: "IGDB, RAWG, Google and Bing" },
  { key: "artwork", label: "Artwork Providers", icon: <Image className="h-4 w-4" />, description: "SteamGridDB artwork configuration" },
  { key: "manual", label: "Manual Games", icon: <BookOpen className="h-4 w-4" />, description: "Manually added games info" },
  { key: "console", label: "Console Mode", icon: <MonitorSmartphone className="h-4 w-4" />, description: "Controller-friendly interface" },
  { key: "packages", label: "Downloads / Packages", icon: <Download className="h-4 w-4" />, description: "Multi-provider package sources" },
  { key: "startup", label: "Startup & Behavior", icon: <Power className="h-4 w-4" />, description: "Launch mode and window behavior" },
  { key: "advanced", label: "Advanced", icon: <SlidersHorizontal className="h-4 w-4" />, description: "Maintenance, logs and import/export" },
  { key: "about", label: "About", icon: <Info className="h-4 w-4" />, description: "Version, license and attributions" },
];

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

  const [activeSection, setActiveSection] = useState<SettingsSectionId>("general");
  const [showSgdbKey, setShowSgdbKey] = useState(false);
  const [showSteamApiKey, setShowSteamApiKey] = useState(false);
  const [showIgdbSecret, setShowIgdbSecret] = useState(false);
  const [showRawgKey, setShowRawgKey] = useState(false);
  const [showGoogleKey, setShowGoogleKey] = useState(false);
  const [showBingKey, setShowBingKey] = useState(false);
  const [newScanFolder, setNewScanFolder] = useState("");

  const currentTheme = themes.find((theme) => theme.id === selectedTheme);

  async function handleDetectSteamPaths() {
    try {
      const paths = await detectSteamPaths();

      if (!paths) {
        showError("No se encontró una instalación de Steam con steam.exe.", {
          title: "Steam no detectado",
        });

        return;
      }

      updateSetting("steamRoot", paths.steam_root);
      updateSetting("luaPath", paths.lua_path);
      updateSetting("depotcachePath", paths.depotcache_path);

      if (!paths.lua_exists) {
        showWarning(
          "Steam fue detectado, pero la carpeta config/lua no existe todavía.",
          {
            title: "Carpeta Lua no encontrada",
          }
        );

        return;
      }

      showSuccess("Las rutas de Steam fueron detectadas correctamente.", {
        title: "Steam detectado",
      });
    } catch (error) {
      console.error(error);

      showError("Ocurrió un error detectando las rutas de Steam.", {
        title: "Error de detección",
      });
    }
  }

  return (
    <PageContainer>
      <div className="space-y-6 py-6">
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
            type="button"
            onClick={resetSettings}
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm text-(--color-text) transition hover:bg-white/10"
          >
            <RotateCcw className="h-4 w-4" />
            Restablecer
          </button>
        </header>

        <div className="flex flex-col gap-6 lg:flex-row">
          <nav className="w-full shrink-0 lg:w-64">
            <div className="flex flex-row gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {navSections.map((section) => (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => setActiveSection(section.key)}
                  className={`flex min-w-fit items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition lg:w-full ${
                    activeSection === section.key
                      ? "bg-(--color-accent)/15 text-(--color-accent)"
                      : "text-(--color-muted) hover:bg-white/5 hover:text-(--color-text)"
                  }`}
                >
                  <span className="shrink-0">{section.icon}</span>
                  <span className="hidden truncate lg:inline">{section.label}</span>
                </button>
              ))}
            </div>
          </nav>

          <div className="min-w-0 flex-1 space-y-6">
            {activeSection === "general" && (
              <SettingsSection
                title="Rutas"
                description="Administra rutas detectadas o configuradas manualmente."
              >
                <div className="mb-4 flex items-center gap-2 text-sm text-(--color-accent)">
                  <FolderCog className="h-4 w-4" />
                  Steam y carpetas internas
                </div>

                <button
                  type="button"
                  onClick={handleDetectSteamPaths}
                  className="mb-4 inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm text-(--color-text) transition hover:bg-white/10"
                >
                  <Crosshair className="h-4 w-4" />
                  Detectar Steam automáticamente
                </button>

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
            )}

            {activeSection === "appearance" && (
              <>
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
                  title="Display"
                  description="Modo de visualización de tarjetas y espaciado."
                >
                  <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                    <div className="space-y-0.5">
                      <label className="text-sm font-medium text-(--color-text)">
                        Card artwork mode
                      </label>
                      <p className="text-xs text-(--color-muted)">
                        Choose between landscape hero or poster grid images for library game cards.
                      </p>
                    </div>
                    <div className="flex overflow-hidden rounded-lg border border-(--surface-active-border)">
                      <button
                        type="button"
                        onClick={() => updateSetting("libraryCardArtworkMode", "landscape")}
                        className={`cursor-pointer px-3 py-1.5 text-xs font-medium transition ${
                          settings.libraryCardArtworkMode === "landscape"
                            ? "bg-(--color-accent) text-black"
                            : "bg-white/5 text-(--color-muted) hover:text-(--color-text)"
                        }`}
                      >
                        Landscape
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSetting("libraryCardArtworkMode", "poster")}
                        className={`cursor-pointer px-3 py-1.5 text-xs font-medium transition ${
                          settings.libraryCardArtworkMode === "poster"
                            ? "bg-(--color-accent) text-black"
                            : "bg-white/5 text-(--color-muted) hover:text-(--color-text)"
                        }`}
                      >
                        Poster
                      </button>
                    </div>
                  </div>

                  <ToggleOption
                    label="Modo compacto"
                    description="Reduce animaciones y espaciado visual."
                    enabled={settings.compactMode}
                    onChange={(enabled) => updateSetting("compactMode", enabled)}
                  />
                </SettingsSection>
              </>
            )}

            {activeSection === "library" && (
              <>
                <CardLayoutEditor />

                <SettingsSection
                  title="Game Detection"
                  description="Configura cómo LumaForge detecta juegos instalados y ejecutables locales."
                >
                  <div className="mb-4 flex items-center gap-2 text-sm text-(--color-accent)">
                    <FolderSearch className="h-4 w-4" />
                    Local EXE detection
                  </div>

                  <div className="mb-4">
                    <ToggleOption
                      label="Escanear juegos locales"
                      description="Busca ejecutables .exe en las carpetas configuradas."
                      enabled={settings.scanLocalGames}
                      onChange={(enabled) => updateSetting("scanLocalGames", enabled)}
                    />
                  </div>

                  {settings.scanLocalGames && (
                    <>
                      <div className="mb-4 space-y-2">
                        {settings.gameScanFolders.length === 0 ? (
                          <p className="text-sm text-(--color-muted)">
                            No se configuraron carpetas de escaneo.
                          </p>
                        ) : (
                          settings.gameScanFolders.map((folder, index) => (
                            <div
                              key={index}
                              className="flex items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3"
                            >
                              <span className="flex-1 truncate text-sm text-(--color-text)">
                                {folder}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = settings.gameScanFolders.filter((_, i) => i !== index);
                                  updateSetting("gameScanFolders", updated);
                                }}
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-red-500/20 hover:text-red-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          value={newScanFolder}
                          onChange={(e) => setNewScanFolder(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && newScanFolder.trim()) {
                              const trimmed = newScanFolder.trim();
                              if (!settings.gameScanFolders.includes(trimmed)) {
                                updateSetting("gameScanFolders", [
                                  ...settings.gameScanFolders,
                                  trimmed,
                                ]);
                              }
                              setNewScanFolder("");
                            }
                          }}
                          placeholder="C:\\Ruta\\a\\carpeta\\de\\juegos"
                          className="flex-1 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const trimmed = newScanFolder.trim();
                            if (trimmed && !settings.gameScanFolders.includes(trimmed)) {
                              updateSetting("gameScanFolders", [
                                ...settings.gameScanFolders,
                                trimmed,
                              ]);
                            }
                            setNewScanFolder("");
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-(--color-accent) px-3 py-2 text-xs font-bold text-black transition hover:opacity-90"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add Folder
                        </button>
                      </div>

                      <p className="mt-3 text-xs text-(--color-muted)">
                        LumaForge escanea solo estas carpetas para encontrar juegos ejecutables locales.
                        No escaneará todo tu PC automáticamente.
                      </p>
                    </>
                  )}
                </SettingsSection>

                <SettingsSection
                  title="Achievement Notifications"
                  description="Control how achievement unlock notifications are delivered."
                >
                  <div className="space-y-4">
                    <ToggleOption
                      label="Show in-app toast"
                      description="Show a premium toast card in the app when an achievement unlocks."
                      enabled={settings.achievementToastEnabled}
                      onChange={(enabled) => updateSetting("achievementToastEnabled", enabled)}
                    />

                    <ToggleOption
                      label="Send native OS notification"
                      description="Also send a system notification when an achievement unlocks. Requires notification permission."
                      enabled={settings.achievementNativeNotificationsEnabled}
                      onChange={(enabled) => updateSetting("achievementNativeNotificationsEnabled", enabled)}
                    />

                    <ToggleOption
                      label="Overlay notification (experimental)"
                      description="Use a transparent always-on-top overlay window for achievement notifications. Currently in development."
                      enabled={settings.achievementOverlayNotificationsEnabled}
                      onChange={(enabled) => updateSetting("achievementOverlayNotificationsEnabled", enabled)}
                    />

                    <ToggleOption
                      label="Auto-sync progress"
                      description="Automatically refresh achievements when Steam writes new progress to disk (librarycache change, game exit, or window focus)."
                      enabled={settings.achievementAutoSyncEnabled}
                      onChange={(enabled) => updateSetting("achievementAutoSyncEnabled", enabled)}
                    />
                  </div>
                </SettingsSection>

                <SettingsSection
                  title="Session Overlay"
                  description="Control how game session notifications (launch/stop) are delivered."
                >
                  <div className="space-y-4">
                    <ToggleOption
                      label="Overlay notification (experimental)"
                      description="Use a transparent always-on-top overlay window for game launch and stop notifications."
                      enabled={settings.gameSessionOverlayEnabled}
                      onChange={(enabled) => updateSetting("gameSessionOverlayEnabled", enabled)}
                    />

                    <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium text-(--color-text)">
                          Overlay position
                        </label>
                        <p className="text-xs text-(--color-muted)">
                          Choose where achievement and session overlay notifications appear.
                        </p>
                      </div>
                      <div className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-lg border border-(--surface-active-border)">
                        {(["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"] as const).map((pos) => (
                          <button
                            key={pos}
                            type="button"
                            onClick={() => updateSetting("overlayNotificationPosition", pos)}
                            className={`cursor-pointer px-2 py-1.5 text-[11px] font-medium transition ${
                              settings.overlayNotificationPosition === pos
                                ? "bg-(--color-accent) text-black"
                                : "bg-white/5 text-(--color-muted) hover:text-(--color-text)"
                            }`}
                          >
                            {pos === "top-left" ? "TL" :
                             pos === "top-center" ? "TC" :
                             pos === "top-right" ? "TR" :
                             pos === "bottom-left" ? "BL" :
                             pos === "bottom-center" ? "BC" :
                             "BR"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </SettingsSection>

                <SettingsSection
                  title="Steam Achievements"
                  description="Configura el seguimiento de logros de Steam."
                >
                  <div className="space-y-4">
                    <ToggleOption
                      label="Enable Steam Achievements Tracking"
                      description="Use Steam Web API to load achievement progress, badges and rarity for Steam games. Requires Steam Web API Key and SteamID64."
                      enabled={settings.steamAchievementsEnabled}
                      onChange={(enabled) => updateSetting("steamAchievementsEnabled", enabled)}
                    />

                    {settings.steamAchievementsEnabled && (!settings.steamWebApiKey || !settings.steamId64) && (
                      <p className="text-xs text-amber-400">
                        Fill in Steam Web API Key and SteamID64 below to enable achievement tracking.
                      </p>
                    )}

                    <label className="block">
                      <div className="mb-2">
                        <p className="text-sm font-medium text-(--color-text)">
                          Steam Web API Key
                        </p>
                        <p className="mt-1 text-xs text-(--color-muted)">
                          Required for Steam Achievement tracking. Used to fetch your achievement progress, badges and rarity.
                        </p>
                      </div>
                      <div className="relative">
                        <input
                          type={showSteamApiKey ? "text" : "password"}
                          value={settings.steamWebApiKey}
                          onChange={(e) => updateSetting("steamWebApiKey", e.target.value)}
                          className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 pr-10 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                          placeholder="Enter your Steam Web API key"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSteamApiKey(!showSteamApiKey)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-(--color-muted) hover:text-(--color-text) transition"
                          tabIndex={-1}
                        >
                          {showSteamApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </label>

                    <label className="block">
                      <div className="mb-2">
                        <p className="text-sm font-medium text-(--color-text)">
                          SteamID64
                        </p>
                        <p className="mt-1 text-xs text-(--color-muted)">
                          Required with Steam Web API Key for per-user achievement progress.
                        </p>
                      </div>
                      <input
                        type="text"
                        value={settings.steamId64}
                        onChange={(e) => updateSetting("steamId64", e.target.value)}
                        className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                        placeholder="Enter your SteamID64 (e.g. 76561197960265728)"
                      />
                    </label>

                    <label className="block">
                      <div className="mb-2">
                        <p className="text-sm font-medium text-(--color-text)">
                          SteamID32 / Account ID (optional)
                        </p>
                        <p className="mt-1 text-xs text-(--color-muted)">
                          Optional. Used for local Steam userdata paths and future integrations.
                        </p>
                      </div>
                      <input
                        type="text"
                        value={settings.steamAccountId}
                        onChange={(e) => updateSetting("steamAccountId", e.target.value)}
                        className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                        placeholder="Enter your SteamID32 (e.g. 12345678)"
                      />
                    </label>

                    <SteamAccountDetector
                      steamRoot={settings.steamRoot}
                      currentSteamId64={settings.steamId64}
                      onSelect={(steamId64) => updateSetting("steamId64", steamId64)}
                    />

                    <div className="mt-4">
                      <label className="block">
                        <div className="mb-2">
                          <p className="text-sm font-medium text-(--color-text)">
                            Achievements App Schema Folder (optional)
                          </p>
                          <p className="mt-1 text-xs text-(--color-muted)">
                            Optional. Path to a folder containing <code>achievements.json</code> and <code>achievementpercentages.json</code> from the Steam Achievement Schema app. Used as a fallback when no other achievement data is available.
                          </p>
                        </div>
                        <input
                          type="text"
                          value={settings.achievementSchemaPath}
                          onChange={(e) => updateSetting("achievementSchemaPath", e.target.value)}
                          className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                          placeholder="C:\\path\\to\\achievements-schema"
                        />
                      </label>
                    </div>
                  </div>
                </SettingsSection>
              </>
            )}

            {activeSection === "collections" && (
              <CollectionsSection />
            )}

            {activeSection === "metadata" && (
              <SettingsSection
                title="Metadata Providers"
                description="Configura las fuentes de metadatos para enriquecer la información de tus juegos."
              >
                <div className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm text-(--color-accent)">
                      <Gamepad2 className="h-4 w-4" />
                      IGDB Metadata
                    </div>

                    <p className="text-xs text-(--color-muted)">
                      IGDB (Internet Game Database) provides cover art and metadata enrichment. Requires a Twitch Client ID and Client Secret (OAuth credentials from dev.twitch.tv).
                    </p>

                    {(!settings.igdbClientId || !settings.igdbClientSecret) && (
                      <p className="text-xs text-amber-400">
                        Fill in both Client ID and Client Secret to enable IGDB artwork and metadata sources.
                      </p>
                    )}

                    <label className="block">
                      <div className="mb-2">
                        <p className="text-sm font-medium text-(--color-text)">
                          Client ID
                        </p>
                      </div>
                      <input
                        type="text"
                        value={settings.igdbClientId}
                        onChange={(e) => { updateSetting("igdbClientId", e.target.value); clearIgdbTokenCache(); }}
                        className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                        placeholder="Enter your IGDB Client ID"
                      />
                    </label>

                    <label className="block">
                      <div className="mb-2">
                        <p className="text-sm font-medium text-(--color-text)">
                          Client Secret
                        </p>
                      </div>
                      <div className="relative">
                        <input
                          type={showIgdbSecret ? "text" : "password"}
                          value={settings.igdbClientSecret}
                          onChange={(e) => { updateSetting("igdbClientSecret", e.target.value); clearIgdbTokenCache(); }}
                          className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 pr-10 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                          placeholder="Enter your IGDB Client Secret"
                        />
                        <button
                          type="button"
                          onClick={() => setShowIgdbSecret(!showIgdbSecret)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-(--color-muted) hover:text-(--color-text) transition"
                          tabIndex={-1}
                        >
                          {showIgdbSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </label>
                  </div>

                  <div className="border-t border-(--surface-active-border) pt-6 space-y-4">
                    <div className="flex items-center gap-2 text-sm text-(--color-accent)">
                      <Globe className="h-4 w-4" />
                      RAWG Metadata
                    </div>

                    <p className="text-xs text-(--color-muted)">
                      RAWG provides background artwork and metadata enrichment. Requires a free API key from rawg.io.
                    </p>

                    {!settings.rawgApiKey && (
                      <p className="text-xs text-amber-400">
                        Add a RAWG API key to enable RAWG background artwork.
                      </p>
                    )}

                    <label className="block">
                      <div className="mb-2">
                        <p className="text-sm font-medium text-(--color-text)">
                          API Key
                        </p>
                      </div>
                      <div className="relative">
                        <input
                          type={showRawgKey ? "text" : "password"}
                          value={settings.rawgApiKey}
                          onChange={(e) => updateSetting("rawgApiKey", e.target.value)}
                          className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 pr-10 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                          placeholder="Enter your RAWG API key"
                        />
                        <button
                          type="button"
                          onClick={() => setShowRawgKey(!showRawgKey)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-(--color-muted) hover:text-(--color-text) transition"
                          tabIndex={-1}
                        >
                          {showRawgKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </label>
                  </div>

                  <div className="border-t border-(--surface-active-border) pt-6 space-y-4">
                    <div className="flex items-center gap-2 text-sm text-(--color-accent)">
                      <Globe className="h-4 w-4" />
                      Google Custom Search
                    </div>

                    <p className="text-xs text-(--color-muted)">
                      Google Custom Search enables in-app image search for manual artwork selection. Requires a Custom Search API Key and Search Engine ID (cx) from the Google Cloud Console.
                    </p>

                    {(!settings.googleSearchApiKey || !settings.googleSearchCx) && (
                      <p className="text-xs text-amber-400">
                        Fill in both fields to enable Google image search in the Media editor.
                      </p>
                    )}

                    <label className="block">
                      <div className="mb-2">
                        <p className="text-sm font-medium text-(--color-text)">
                          API Key
                        </p>
                      </div>
                      <div className="relative">
                        <input
                          type={showGoogleKey ? "text" : "password"}
                          value={settings.googleSearchApiKey}
                          onChange={(e) => updateSetting("googleSearchApiKey", e.target.value)}
                          className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 pr-10 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                          placeholder="Enter your Google API key"
                        />
                        <button
                          type="button"
                          onClick={() => setShowGoogleKey(!showGoogleKey)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-(--color-muted) hover:text-(--color-text) transition"
                          tabIndex={-1}
                        >
                          {showGoogleKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </label>

                    <label className="block">
                      <div className="mb-2">
                        <p className="text-sm font-medium text-(--color-text)">
                          Search Engine ID (cx)
                        </p>
                      </div>
                      <input
                        type="text"
                        value={settings.googleSearchCx}
                        onChange={(e) => updateSetting("googleSearchCx", e.target.value)}
                        className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                        placeholder="Enter your Search Engine ID"
                      />
                    </label>
                  </div>

                  <div className="border-t border-(--surface-active-border) pt-6 space-y-4">
                    <div className="flex items-center gap-2 text-sm text-(--color-accent)">
                      <Globe className="h-4 w-4" />
                      Bing Image Search
                    </div>

                    <p className="text-xs text-(--color-muted)">
                      Bing Image Search provides an alternative in-app image search source. Requires a Bing Search API key from the Azure portal.
                    </p>

                    {!settings.bingSearchApiKey && (
                      <p className="text-xs text-amber-400">
                        Add a Bing Search API key to enable Bing image search in the Media editor.
                      </p>
                    )}

                    <label className="block">
                      <div className="mb-2">
                        <p className="text-sm font-medium text-(--color-text)">
                          API Key
                        </p>
                      </div>
                      <div className="relative">
                        <input
                          type={showBingKey ? "text" : "password"}
                          value={settings.bingSearchApiKey}
                          onChange={(e) => updateSetting("bingSearchApiKey", e.target.value)}
                          className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 pr-10 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                          placeholder="Enter your Bing Search API key"
                        />
                        <button
                          type="button"
                          onClick={() => setShowBingKey(!showBingKey)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-(--color-muted) hover:text-(--color-text) transition"
                          tabIndex={-1}
                        >
                          {showBingKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </label>
                  </div>
                </div>
              </SettingsSection>
            )}

            {activeSection === "artwork" && (
              <SettingsSection
                title="Artwork Providers"
                description="Configura las fuentes de arte para carátulas, heroes y logos."
              >
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-(--color-accent)">
                    <Crosshair className="h-4 w-4" />
                    SteamGridDB Artwork
                  </div>

                  <ToggleOption
                    label="Enable SteamGridDB Artwork"
                    description="Use SteamGridDB to fetch poster, hero and logo artwork for Biblioteca y Juegos. Requires an API key."
                    enabled={settings.steamGridDbArtworkEnabled}
                    onChange={(enabled) => updateSetting("steamGridDbArtworkEnabled", enabled)}
                  />

                  {settings.steamGridDbArtworkEnabled && !settings.steamGridDbApiKey && (
                    <p className="text-xs text-amber-400">
                      Add a SteamGridDB API key to fetch artwork.
                    </p>
                  )}

                  <label className="block">
                    <div className="mb-2">
                      <p className="text-sm font-medium text-(--color-text)">
                        API Key (optional)
                      </p>
                      <p className="mt-1 text-xs text-(--color-muted)">
                        Used to fetch native poster, hero and logo artwork for Library cards.
                      </p>
                    </div>
                    <div className="relative">
                      <input
                        type={showSgdbKey ? "text" : "password"}
                        value={settings.steamGridDbApiKey}
                        onChange={(e) => updateSetting("steamGridDbApiKey", e.target.value)}
                        className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 pr-10 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                        placeholder="Enter your SteamGridDB API key"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSgdbKey(!showSgdbKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-(--color-muted) hover:text-(--color-text) transition"
                        tabIndex={-1}
                      >
                        {showSgdbKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </label>
                </div>
              </SettingsSection>
            )}

            {activeSection === "manual" && (
              <SettingsSection
                title="Manual Games"
                description="Información sobre juegos agregados manualmente a tu biblioteca."
              >
                <div className="space-y-4">
                  <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-(--color-accent)/15 text-(--color-accent)">
                        <BookOpen className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-(--color-text)">
                          Juegos manuales
                        </p>
                        <p className="text-xs text-(--color-muted)">
                          Los juegos manuales se almacenan en un archivo JSON local.
                        </p>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-(--color-muted)">
                    Los juegos manuales se pueden crear, editar y eliminar desde la biblioteca.
                    Cada juego manual tiene su propia carpeta de medios y metadatos.
                    El seguimiento de logros y tiempo de juego funciona igual que con juegos de Steam.
                  </p>
                </div>
              </SettingsSection>
            )}

            {activeSection === "console" && (
              <SettingsSection
                title="Console Mode"
                description="Modo de interfaz amigable con controlador."
              >
                <div className="space-y-4">
                  <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-(--color-accent)/15 text-(--color-accent)">
                        <MonitorSmartphone className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-(--color-text)">
                          Console Mode
                        </p>
                        <p className="text-xs text-(--color-muted)">
                          Configura Console Mode desde la propia interfaz de Console Mode.
                        </p>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-(--color-muted)">
                    Console Mode se activa desde el botón de navegación y ofrece una interfaz amigable con controlador.
                    Todas las configuraciones de Console Mode se guardan por separado.
                  </p>
                </div>
              </SettingsSection>
            )}

            {activeSection === "packages" && (
              <>
                <SettingsSection
                  title="Downloads / Packages"
                  description="Configura las fuentes que LumaForge usará para buscar y descargar paquetes."
                >
                  <div className="mb-4 flex items-center gap-2 text-sm text-(--color-accent)">
                    <Globe className="h-4 w-4" />
                    Multi-provider fallback
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {defaultApiProviders.map((provider) => {
                      const providerSettings =
                        settings.providers?.[provider.id] ?? {
                          enabled: provider.enabledByDefault,
                          baseUrl: provider.baseUrl,
                          apiKey: "",
                        };

                      function handleProviderChange(
                        nextProviderSettings: ApiProviderUserSettings
                      ) {
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
                          badgeContent={provider.id === "hubcapdb" ? <HubcapProviderBadges surface="settings" /> : undefined}
                        />
                      );
                    })}
                  </div>
                </SettingsSection>

                <SettingsSection
                  title="Importar / Exportar"
                  description="Guarda o restaura tu configuración local de LumaForge."
                >
                  <SettingsImportExport />
                </SettingsSection>
              </>
            )}

            {activeSection === "advanced" && (
              <>
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
                  </div>

                  <div className="mt-6 border-t border-(--surface-active-border) pt-4">
                    <div className="mb-3 flex items-center gap-2 text-sm text-(--color-accent)">
                      <SlidersHorizontal className="h-4 w-4" />
                      Mantenimiento de la biblioteca
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const { rebuildLibraryIndex } = await import("../services/gameStore");
                            const { getCachedSettings } = await import("../services/appBootCoordinator");
                            const s = getCachedSettings() ?? settings;
                            await rebuildLibraryIndex(s);
                            showSuccess("Library index rebuilt from config/lua definitions");
                          } catch (err) {
                            showError(`Rebuild failed: ${err}`);
                          }
                        }}
                        className="lf-btn lf-btn-primary text-xs"
                      >
                        Reconstruir índice de biblioteca
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const { validateLibraryIndexHealth } = await import("../services/gameStore");
                            const { games: storeGames } = { games: [] };
                            const report = await validateLibraryIndexHealth(storeGames);
                            const lines = [
                              `Lua games: ${report.luaGames}`,
                              `SQLite games: ${report.sqliteGames}`,
                              `Reconciled games: ${report.reconciledGames}`,
                              `Missing from SQLite: ${report.missingFromSQLite}`,
                              `Missing from Store: ${report.missingFromStore}`,
                              `Stale SQLite-only: ${report.staleSqliteOnly}`,
                              `Missing media: ${report.missingMedia}`,
                              `Invalid paths: ${report.invalidPaths}`,
                            ];
                            showSuccess(lines.join("\n"), { duration: 8000 });
                            console.log("[LIBRARY][HEALTH]", report);
                          } catch (err) {
                            showError(`Validation failed: ${err}`);
                          }
                        }}
                        className="lf-btn lf-btn-secondary text-xs"
                      >
                        Validar salud de la biblioteca
                      </button>
                    </div>
                  </div>
                </SettingsSection>

                <SettingsSection
                  title="Importar / Exportar"
                  description="Guarda o restaura tu configuración local de LumaForge."
                >
                  <SettingsImportExport />
                </SettingsSection>
              </>
            )}

            {activeSection === "startup" && (
              <>
                <SettingsSection
                  title="Startup & Window Behavior"
                  description="Control how LumaForge starts and how the window behaves."
                >
                  <div className="space-y-4">
                    <div className="mb-2 flex items-center gap-2 text-sm text-(--color-accent)">
                      <Power className="h-4 w-4" />
                      Launch Mode
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium text-(--color-text)">
                          Default launch mode
                        </label>
                        <p className="text-xs text-(--color-muted)">
                          Choose which interface opens when LumaForge starts.
                        </p>
                      </div>
                      <div className="flex overflow-hidden rounded-lg border border-(--surface-active-border)">
                        <button
                          type="button"
                          onClick={() => updateSetting("launchMode", "desktop")}
                          className={`cursor-pointer px-3 py-1.5 text-xs font-medium transition ${
                            settings.launchMode === "desktop"
                              ? "bg-(--color-accent) text-black"
                              : "bg-white/5 text-(--color-muted) hover:text-(--color-text)"
                          }`}
                        >
                          Desktop
                        </button>
                        <button
                          type="button"
                          onClick={() => updateSetting("launchMode", "console")}
                          className={`cursor-pointer px-3 py-1.5 text-xs font-medium transition ${
                            settings.launchMode === "console"
                              ? "bg-(--color-accent) text-black"
                              : "bg-white/5 text-(--color-muted) hover:text-(--color-text)"
                          }`}
                        >
                          Console
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium text-(--color-text)">
                          Startup window mode
                        </label>
                        <p className="text-xs text-(--color-muted)">
                          How the main window appears on launch.
                        </p>
                      </div>
                      <div className="flex overflow-hidden rounded-lg border border-(--surface-active-border)">
                        {(["windowed", "maximized", "fullscreen"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => updateSetting("startupWindowMode", mode)}
                            className={`cursor-pointer px-3 py-1.5 text-xs font-medium capitalize transition ${
                              settings.startupWindowMode === mode
                                ? "bg-(--color-accent) text-black"
                                : "bg-white/5 text-(--color-muted) hover:text-(--color-text)"
                            }`}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </SettingsSection>

                <SettingsSection
                  title="Startup Behavior"
                  description="Control automatic behaviors on startup and shutdown."
                >
                  <div className="space-y-4">
                    <ToggleOption
                      label="Start with Windows"
                      description="Launch LumaForge automatically when Windows starts. (Requires OS registration — not yet implemented.)"
                      enabled={settings.startWithWindows}
                      onChange={(enabled) => updateSetting("startWithWindows", enabled)}
                    />

                    <ToggleOption
                      label="Start maximized"
                      description="Open the main window maximized on startup."
                      enabled={settings.startMaximized}
                      onChange={(enabled) => updateSetting("startMaximized", enabled)}
                    />

                    <ToggleOption
                      label="Start in tray"
                      description="Launch minimized to the system tray without showing the window."
                      enabled={settings.startInTray}
                      onChange={(enabled) => updateSetting("startInTray", enabled)}
                    />

                    <ToggleOption
                      label="Close to tray"
                      description="When closing the window, minimize to tray instead of quitting."
                      enabled={settings.closeToTray}
                      onChange={(enabled) => updateSetting("closeToTray", enabled)}
                    />

                    <ToggleOption
                      label="Show Dashboard on startup"
                      description="Open the Home dashboard instead of the last used page."
                      enabled={settings.showDashboardOnStartup}
                      onChange={(enabled) => updateSetting("showDashboardOnStartup", enabled)}
                    />

                    <ToggleOption
                      label="Disable automatic updates"
                      description="Prevent LumaForge from checking for updates on startup."
                      enabled={settings.disableAutoUpdates}
                      onChange={(enabled) => updateSetting("disableAutoUpdates", enabled)}
                    />
                  </div>
                </SettingsSection>
              </>
            )}

            {activeSection === "about" && (
              <>
                <SettingsSection
                  title="About LumaForge"
                  description="Application information and links."
                >
                  <div className="space-y-4">
                    <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-5">
                      <div className="flex items-start gap-4">
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-(--color-accent)/15 text-(--color-accent)">
                          <Cog className="h-7 w-7" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-lg font-bold text-(--color-text)">
                            LumaForge
                          </h3>
                          <p className="text-sm text-(--color-muted)">
                            Your Steam game library companion
                          </p>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-(--color-muted)">
                            <span>Version 0.1.0</span>
                            <span className="text-white/20">|</span>
                            <span>Desktop Mode</span>
                            <span className="text-white/20">|</span>
                            <span>Tauri + React</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => openExternalUrl("https://github.com/nicegoodthings/lumaforge")}
                        className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm text-(--color-text) transition hover:bg-white/10"
                      >
                        <Code className="h-4 w-4" />
                        GitHub Repository
                        <ExternalLink className="h-3 w-3 text-(--color-muted)" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openExternalUrl("https://github.com/nicegoodthings/lumaforge/blob/main/LICENSE")}
                        className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm text-(--color-text) transition hover:bg-white/10"
                      >
                        <ExternalLink className="h-4 w-4" />
                        View License
                      </button>
                    </div>
                  </div>
                </SettingsSection>

                <SettingsSection
                  title="Data & Services"
                  description="External services used by LumaForge. LumaForge is not affiliated with or endorsed by any of these services."
                >
                  <div className="space-y-3">
                    {[
                      {
                        name: "Steam",
                        description: "Game library metadata, Steam app IDs, store links, achievements, and playtime tracking.",
                        url: "https://store.steampowered.com/",
                        configured: !!settings.steamRoot,
                      },
                      {
                        name: "SteamGridDB",
                        description: "Community artwork provider for covers, heroes, logos, and icons.",
                        url: "https://www.steamgriddb.com/",
                        configured: settings.steamGridDbArtworkEnabled && !!settings.steamGridDbApiKey,
                      },
                      {
                        name: "IGDB / Twitch",
                        description: "Game metadata provider using Twitch OAuth credentials.",
                        url: "https://www.igdb.com/",
                        configured: !!settings.igdbClientId && !!settings.igdbClientSecret,
                      },
                      {
                        name: "RAWG",
                        description: "Optional game metadata and background artwork provider.",
                        url: "https://rawg.io/",
                        configured: !!settings.rawgApiKey,
                      },
                      {
                        name: "Google Custom Search",
                        description: "Optional in-app image search for manual artwork selection.",
                        url: "https://developers.google.com/custom-search",
                        configured: !!settings.googleSearchApiKey && !!settings.googleSearchCx,
                      },
                      {
                        name: "Bing Search",
                        description: "Optional alternative in-app image search source.",
                        url: "https://www.microsoft.com/bing/apis/bing-web-search-api",
                        configured: !!settings.bingSearchApiKey,
                      },
                      {
                        name: "Hubcap",
                        description: "Package and provider source for game downloads.",
                        url: "https://hubcapmanifest.com/",
                        configured: !!(settings.providers?.hubcapdb?.apiKey),
                      },
                      {
                        name: "GitHub",
                        description: "Project source code and issue tracking.",
                        url: "https://github.com/nicegoodthings/lumaforge",
                        configured: true,
                      },
                    ].map((service) => (
                      <div
                        key={service.name}
                        className="flex items-center gap-4 rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-(--color-text)">
                              {service.name}
                            </p>
                            {service.configured ? (
                              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                                Configured
                              </span>
                            ) : (
                              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-(--color-muted)">
                                Optional
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-(--color-muted)">
                            {service.description}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openExternalUrl(service.url)}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/5 px-2.5 py-1.5 text-[11px] text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Visit
                        </button>
                      </div>
                    ))}
                  </div>
                </SettingsSection>
              </>
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
