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
  Trophy,
  LayoutDashboard,
  Columns3,
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

type SettingsTab = "paths" | "game-detection" | "providers" | "behavior" | "advanced";

const tabs: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { key: "paths", label: "Paths", icon: <FolderCog className="h-4 w-4" /> },
  { key: "game-detection", label: "Game Detection", icon: <Gamepad2 className="h-4 w-4" /> },
  { key: "providers", label: "Providers", icon: <Globe className="h-4 w-4" /> },
  { key: "behavior", label: "Behavior", icon: <Cog className="h-4 w-4" /> },
  { key: "advanced", label: "Advanced", icon: <SlidersHorizontal className="h-4 w-4" /> },
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

  const [activeTab, setActiveTab] = useState<SettingsTab>("paths");
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

        <div className="flex gap-1 rounded-xl border border-(--surface-active-border) bg-white/5 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                activeTab === tab.key
                  ? "bg-(--color-accent)/20 text-(--color-accent)"
                  : "text-(--color-muted) hover:bg-white/5 hover:text-(--color-text)"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "paths" && (
          <div className="lf-tab-panel-in">
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
          </div>
        )}

        {activeTab === "game-detection" && (
          <div className="lf-tab-panel-in">
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
          </div>
        )}

        {activeTab === "providers" && (
          <div className="lf-tab-panel-in">
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

              <div className="mt-6 space-y-4">
                <div className="flex items-center gap-2 text-sm text-(--color-accent)">
                  <Crosshair className="h-4 w-4" />
                  SteamGridDB Artwork
                </div>

                <ToggleOption
                  label="Enable SteamGridDB Artwork"
                  description="Use SteamGridDB to fetch poster, hero and logo artwork for Biblioteca and Juegos. Requires an API key."
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

                <div className="mt-6 space-y-4">
                  <div className="flex items-center gap-2 text-sm text-(--color-accent)">
                    <Trophy className="h-4 w-4" />
                    Steam Achievements
                  </div>

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
              </div>

              {/* IGDB Provider */}
              <div className="mt-6 space-y-4">
                <div className="flex items-center gap-2 text-sm text-(--color-accent)">
                  <Gamepad2 className="h-4 w-4" />
                  IGDB Metadata
                </div>

                <p className="text-xs text-(--color-muted)">
                  IGDB (Internet Game Database) provides cover art and metadata enrichment. Requires a Twitch/IGDB Client ID and OAuth access token.
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
                    onChange={(e) => updateSetting("igdbClientId", e.target.value)}
                    className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                    placeholder="Enter your IGDB Client ID"
                  />
                </label>

                <label className="block">
                  <div className="mb-2">
                    <p className="text-sm font-medium text-(--color-text)">
                      Client Secret / Access Token
                    </p>
                  </div>
                  <div className="relative">
                    <input
                      type={showIgdbSecret ? "text" : "password"}
                      value={settings.igdbClientSecret}
                      onChange={(e) => updateSetting("igdbClientSecret", e.target.value)}
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

              {/* RAWG Provider */}
              <div className="mt-6 space-y-4">
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

              {/* Google Custom Search */}
              <div className="mt-6 space-y-4">
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

              {/* Bing Image Search */}
              <div className="mt-6 space-y-4">
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

            </SettingsSection>
          </div>
        )}

        {activeTab === "behavior" && (
          <div className="lf-tab-panel-in">
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
              title="Dashboard Layout"
              description="Adjust card sizes, spacing and width for the Home dashboard."
            >
              <div className="space-y-4">
                <div className="mb-2 flex items-center gap-2 text-sm text-(--color-accent)">
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </div>

                <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium text-(--color-text)">
                      Content max width
                    </label>
                    <p className="text-xs text-(--color-muted)">
                      {settings.dashboardContentWidth}px — max width of dashboard content area
                    </p>
                  </div>
                  <div className="flex w-36 items-center gap-2">
                    <span className="text-[11px] text-(--color-muted)/60">1200</span>
                    <input
                      type="range"
                      min={1200}
                      max={2400}
                      step={40}
                      value={settings.dashboardContentWidth}
                      onChange={(e) => updateSetting("dashboardContentWidth", Number(e.target.value))}
                      className="w-full accent-(--color-accent)"
                    />
                    <span className="text-[11px] text-(--color-muted)/60">2400</span>
                  </div>
                </div>

                <ToggleOption
                  label="Expanded dashboard"
                  description="Remove content max-width so dashboard fills the full window width."
                  enabled={settings.useExpandedDashboard}
                  onChange={(enabled) => updateSetting("useExpandedDashboard", enabled)}
                />

                <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium text-(--color-text)">
                      Featured card size
                    </label>
                    <p className="text-xs text-(--color-muted)">
                      {settings.dashboardFeaturedCardSize}px — Continue Playing cards
                    </p>
                  </div>
                  <div className="flex w-36 items-center gap-2">
                    <span className="text-[11px] text-(--color-muted)/60">280</span>
                    <input
                      type="range"
                      min={280}
                      max={480}
                      step={10}
                      value={settings.dashboardFeaturedCardSize}
                      onChange={(e) => updateSetting("dashboardFeaturedCardSize", Number(e.target.value))}
                      className="w-full accent-(--color-accent)"
                    />
                    <span className="text-[11px] text-(--color-muted)/60">480</span>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium text-(--color-text)">
                      Standard card size
                    </label>
                    <p className="text-xs text-(--color-muted)">
                      {settings.dashboardCardSize}px — all other dashboard section cards
                    </p>
                  </div>
                  <div className="flex w-36 items-center gap-2">
                    <span className="text-[11px] text-(--color-muted)/60">200</span>
                    <input
                      type="range"
                      min={200}
                      max={400}
                      step={10}
                      value={settings.dashboardCardSize}
                      onChange={(e) => updateSetting("dashboardCardSize", Number(e.target.value))}
                      className="w-full accent-(--color-accent)"
                    />
                    <span className="text-[11px] text-(--color-muted)/60">400</span>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium text-(--color-text)">
                      Card gap
                    </label>
                    <p className="text-xs text-(--color-muted)">
                      {settings.dashboardGridGap}px — spacing between cards in scroll rows
                    </p>
                  </div>
                  <div className="flex w-36 items-center gap-2">
                    <span className="text-[11px] text-(--color-muted)/60">8</span>
                    <input
                      type="range"
                      min={8}
                      max={48}
                      step={4}
                      value={settings.dashboardGridGap}
                      onChange={(e) => updateSetting("dashboardGridGap", Number(e.target.value))}
                      className="w-full accent-(--color-accent)"
                    />
                    <span className="text-[11px] text-(--color-muted)/60">48</span>
                  </div>
                </div>

                <div className="mb-2 mt-6 flex items-center gap-2 text-sm text-(--color-accent)">
                  <Columns3 className="h-4 w-4" />
                  Library Landscape
                </div>

                <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium text-(--color-text)">
                      Landscape card size
                    </label>
                    <p className="text-xs text-(--color-muted)">
                      {settings.libraryLandscapeCardSize}px — used when artwork mode is Landscape
                    </p>
                  </div>
                  <div className="flex w-36 items-center gap-2">
                    <span className="text-[11px] text-(--color-muted)/60">160</span>
                    <input
                      type="range"
                      min={160}
                      max={300}
                      step={5}
                      value={settings.libraryLandscapeCardSize}
                      onChange={(e) => updateSetting("libraryLandscapeCardSize", Number(e.target.value))}
                      className="w-full accent-(--color-accent)"
                    />
                    <span className="text-[11px] text-(--color-muted)/60">300</span>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium text-(--color-text)">
                      Landscape grid gap
                    </label>
                    <p className="text-xs text-(--color-muted)">
                      {settings.libraryLandscapeGap}px — spacing between landscape cards
                    </p>
                  </div>
                  <div className="flex w-36 items-center gap-2">
                    <span className="text-[11px] text-(--color-muted)/60">16</span>
                    <input
                      type="range"
                      min={16}
                      max={56}
                      step={4}
                      value={settings.libraryLandscapeGap}
                      onChange={(e) => updateSetting("libraryLandscapeGap", Number(e.target.value))}
                      className="w-full accent-(--color-accent)"
                    />
                    <span className="text-[11px] text-(--color-muted)/60">56</span>
                  </div>
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      updateSetting("dashboardContentWidth", 1760);
                      updateSetting("useExpandedDashboard", false);
                      updateSetting("dashboardCardSize", 260);
                      updateSetting("dashboardFeaturedCardSize", 340);
                      updateSetting("dashboardGridGap", 16);
                      updateSetting("libraryLandscapeCardSize", 200);
                      updateSetting("libraryLandscapeGap", 28);
                      updateSetting("maxLandscapeColumns", 0);
                    }}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-(--color-muted) transition hover:bg-white/8 hover:text-(--color-text)"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Restore display layout defaults
                  </button>
                </div>
              </div>
            </SettingsSection>

            <SettingsSection
              title="Biblioteca"
              description="Ajusta la visualización de la cuadrícula de juegos."
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium text-(--color-text)">
                      Tamaño de tarjeta
                    </label>
                    <p className="text-xs text-(--color-muted)">
                      {settings.libraryCardSize}px — ancho mínimo por tarjeta
                    </p>
                  </div>
                  <div className="flex w-36 items-center gap-2">
                    <span className="text-[11px] text-(--color-muted)/60">160</span>
                    <input
                      type="range"
                      min={160}
                      max={280}
                      step={5}
                      value={settings.libraryCardSize}
                      onChange={(e) => updateSetting("libraryCardSize", Number(e.target.value))}
                      className="w-full accent-(--color-accent)"
                    />
                    <span className="text-[11px] text-(--color-muted)/60">280</span>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium text-(--color-text)">
                      Espaciado entre tarjetas
                    </label>
                    <p className="text-xs text-(--color-muted)">
                      {settings.libraryGridGap}px
                    </p>
                  </div>
                  <div className="flex w-36 items-center gap-2">
                    <span className="text-[11px] text-(--color-muted)/60">16</span>
                    <input
                      type="range"
                      min={16}
                      max={48}
                      step={4}
                      value={settings.libraryGridGap}
                      onChange={(e) => updateSetting("libraryGridGap", Number(e.target.value))}
                      className="w-full accent-(--color-accent)"
                    />
                    <span className="text-[11px] text-(--color-muted)/60">48</span>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium text-(--color-text)">
                      Ancho del panel de filtros
                    </label>
                    <p className="text-xs text-(--color-muted)">
                      {settings.libraryFilterPanelWidth}px
                    </p>
                  </div>
                  <div className="flex w-36 items-center gap-2">
                    <span className="text-[11px] text-(--color-muted)/60">240</span>
                    <input
                      type="range"
                      min={240}
                      max={360}
                      step={10}
                      value={settings.libraryFilterPanelWidth}
                      onChange={(e) => updateSetting("libraryFilterPanelWidth", Number(e.target.value))}
                      className="w-full accent-(--color-accent)"
                    />
                    <span className="text-[11px] text-(--color-muted)/60">360</span>
                  </div>
                </div>

                <ToggleOption
                  label="Usar ancho completo"
                  description="La cuadrícula ocupa todo el ancho disponible en lugar de estar centrada con límite."
                  enabled={settings.libraryUseFullWidth}
                  onChange={(enabled) => updateSetting("libraryUseFullWidth", enabled)}
                />

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      updateSetting("libraryCardSize", 200);
                      updateSetting("libraryGridGap", 28);
                      updateSetting("libraryUseFullWidth", true);
                      updateSetting("libraryFilterPanelWidth", 280);
                    }}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-(--color-muted) transition hover:bg-white/8 hover:text-(--color-text)"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Restaurar diseño de biblioteca
                  </button>
                </div>
              </div>
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
              title="Importar / Exportar"
              description="Guarda o restaura tu configuración local de LumaForge."
            >
              <SettingsImportExport />
            </SettingsSection>
          </div>
        )}

        {activeTab === "advanced" && (
          <div className="lf-tab-panel-in">
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
                        // We need games from context — use refresh approach
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
          </div>
        )}
      </div>
    </PageContainer>
  );
}
