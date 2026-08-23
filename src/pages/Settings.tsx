import { useState, useSyncExternalStore } from "react";

import ThirdPartyToolsSection from "../components/settings/ThirdPartyToolsSection";
import { setAmbientEnabled, setAmbientIntensity, setAmbientMode, subscribeAmbient, getAmbientSnapshot } from "../services/ambientBackgroundStore";
import { setHeroTransition, subscribeHeroTransition, getHeroTransitionSnapshot, HERO_TRANSITION_OPTIONS } from "../services/heroTransitionStore";
import {
  Eye,
  EyeOff,
  Palette,
  Globe,
  FolderCog,
  SlidersHorizontal,
  RotateCcw,
  Crosshair,
  Gamepad2,
  Cog,
  Database,
  Library,
  Power,
  ExternalLink,
  Code,
  Zap,
  Cloud,
  Puzzle,
} from "lucide-react";

import {
  showError,
  showSuccess,
  showWarning,
} from "../components/toast/GameToast";

import { detectSteamPaths } from "../services/tauri";

import ProviderSettingsCard from "../components/settings/ProviderSettingsCard";
import HubcapProviderBadges from "../components/settings/HubcapProviderBadges";
import DebridProvidersCard from "../components/settings/DebridProvidersCard";
import SettingsSection from "../components/settings/SettingsSection";
import CardLayoutEditor from "../components/settings/CardLayoutEditor";
import HomeLayoutEditor from "../components/settings/HomeLayoutEditor";
import ThemeOption from "../components/settings/ThemeOption";
import SurfaceModeOption from "../components/settings/SurfaceModeOption";
import AccentColorPicker from "../components/settings/AccentColorPicker";
import SettingsInput from "../components/settings/SettingsInput";
import ToggleOption from "../components/settings/ToggleOption";
import BackupSectionUI from "../components/settings/BackupSection";
import SteamAccountDetector from "../components/settings/SteamAccountDetector";
import IntegrationsSection from "../components/settings/IntegrationsSection";
import ExtensionsSettings from "../extensions/ui/ExtensionsSettings";

import { defaultApiProviders } from "../data/providers";
import { ApiProviderUserSettings } from "../types/provider";

import { themes, surfaceModes, themeVariables } from "../theme/themes";
import { useTheme } from "../context/ThemeContext";
import { useSettings } from "../context/SettingsContext";
import { clearIgdbTokenCache } from "../services/igdbAccessTokenService";
import { openExternalUrl } from "../services/externalLinks";

type SettingsSectionId =
  | "general"
  | "appearance"
  | "library"
  | "notifications"
  | "metadata"
  | "extensions"
  | "providers"
  | "backup"
  | "startup";

const navSections: {
  key: SettingsSectionId;
  label: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  { key: "general", label: "General", icon: <Cog className="h-4 w-4" />, description: "Steam paths, account and auto-detection" },
  { key: "appearance", label: "Appearance", icon: <Palette className="h-4 w-4" />, description: "Theme, surface mode and accent color" },
  { key: "library", label: "Layout", icon: <Library className="h-4 w-4" />, description: "Dashboard, card layout and display mode" },
  { key: "notifications", label: "Notifications", icon: <Gamepad2 className="h-4 w-4" />, description: "Achievement alerts and session overlay" },
  { key: "metadata", label: "Artwork & Metadata Providers", icon: <Database className="h-4 w-4" />, description: "IGDB, RAWG and SteamGridDB API keys" },
  { key: "extensions", label: "Extensions", icon: <Puzzle className="h-4 w-4" />, description: "External tool integrations" },
  { key: "providers", label: "Providers & Tools", icon: <Zap className="h-4 w-4" />, description: "Package sources, integrations and tools" },
  { key: "backup", label: "Cloud & Backup", icon: <Cloud className="h-4 w-4" />, description: "Backups, restore and cloud sync" },
  { key: "startup", label: "Startup & More", icon: <Power className="h-4 w-4" />, description: "Launch mode, behavior, maintenance and about" },
];

type SettingsProps = {
  onSectionChange?: (label: string) => void;
};

export default function Settings({ onSectionChange }: SettingsProps) {
  const {
    theme: selectedTheme,
    surfaceMode,
    accentOverride,
    setTheme,
    setSurfaceMode,
    setAccentOverride,
  } = useTheme();

  const {
    settings,
    updateSetting,
    resetSettings,
  } = useSettings();

  const ambientState = useSyncExternalStore(
    subscribeAmbient,
    getAmbientSnapshot,
    getAmbientSnapshot,
  );

  const heroTransitionState = useSyncExternalStore(
    subscribeHeroTransition,
    getHeroTransitionSnapshot,
    getHeroTransitionSnapshot,
  );

  const [activeSection, setActiveSection] = useState<SettingsSectionId>("general");
  const [showSgdbKey, setShowSgdbKey] = useState(false);
  const [showSteamApiKey, setShowSteamApiKey] = useState(false);
  const [showIgdbSecret, setShowIgdbSecret] = useState(false);
  const [showRawgKey, setShowRawgKey] = useState(false);

  const currentTheme = themes.find((theme) => theme.id === selectedTheme);

  // Notify overlay header when section changes
  function handleSectionChange(key: SettingsSectionId) {
    setActiveSection(key);
    const section = navSections.find((s) => s.key === key);
    onSectionChange?.(section?.label ?? key);
  }

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
    <>
      {/* Sidebar nav — vertical, 260px wide, scrollable */}
      <nav className="flex w-[260px] shrink-0 flex-col border-r border-(--surface-active-border) p-3">
        <div className="flex flex-1 flex-col gap-0.5">
          {navSections.map((section) => (
            <button
              key={section.key}
              type="button"
              onClick={() => handleSectionChange(section.key)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                activeSection === section.key
                  ? "bg-(--color-accent)/10 text-(--color-accent)"
                  : "text-(--color-muted) hover:bg-white/[0.04] hover:text-(--color-text)"
              }`}
            >
              <span className="shrink-0">{section.icon}</span>
              <span className="truncate">{section.label}</span>
            </button>
          ))}
        </div>

        {/* Reset button pinned to bottom of sidebar */}
        <div className="mt-auto flex flex-col items-stretch border-t border-(--surface-active-border) pt-3">
          <button
            type="button"
            onClick={resetSettings}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-(--color-muted) transition hover:bg-white/[0.04] hover:text-(--color-text)"
          >
            <RotateCcw className="h-4 w-4 shrink-0" />
            <span className="truncate">Restablecer</span>
          </button>
        </div>
      </nav>

      {/* Content area — scrollable */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
            {activeSection === "general" && (
              <>
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

              <SettingsSection
                title="Steam Account"
                description="Credenciales de cuenta para achievement tracking y integraciones."
              >
                <div className="space-y-4">
                  <ToggleOption
                    label="Enable Steam Achievements Tracking"
                    description="Use Steam Web API to load achievement progress, badges and rarity. Requires API Key and SteamID64 below."
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
                        Required for Steam Achievement tracking. Used to fetch achievement progress, badges and rarity.
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
                      placeholder="76561197960265728"
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
                      placeholder="12345678"
                    />
                  </label>

                  <SteamAccountDetector
                    steamRoot={settings.steamRoot}
                    currentSteamId64={settings.steamId64}
                    onSelect={(steamId64) => updateSetting("steamId64", steamId64)}
                  />
                </div>
              </SettingsSection>
              </>
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

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
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

                  <div className="mt-6">
                    <AccentColorPicker
                      value={accentOverride}
                      themeAccent={themeVariables[selectedTheme]["--color-accent"]}
                      onChange={setAccentOverride}
                    />
                  </div>
                </SettingsSection>

                <SettingsSection
                  title="Animaciones"
                  description="Controla la transición de los héroes y fondos de juegos."
                >
                  <div className="mb-3 flex items-center gap-2 text-sm text-(--color-muted)">
                    <SlidersHorizontal className="h-4 w-4" />
                    Transición de hero / fondo
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {HERO_TRANSITION_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setHeroTransition(opt.id)}
                        className={`rounded-xl border p-3 text-left transition ${
                          heroTransitionState.id === opt.id
                            ? "border-(--color-accent)/60 bg-(--color-accent)/15"
                            : "border-(--surface-active-border) bg-white/5 hover:bg-white/10"
                        }`}
                      >
                        <span
                          className={`block text-sm font-medium ${
                            heroTransitionState.id === opt.id
                              ? "text-(--color-accent)"
                              : "text-(--color-text)"
                          }`}
                        >
                          {opt.label}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-(--color-muted)">
                          {opt.description}
                        </span>
                      </button>
                    ))}
                  </div>

                  <p className="mt-4 text-xs text-(--color-muted)">
                    El fondo ambiental siempre usa la transicion de fundido
                    premium, independientemente de esta seleccion.
                  </p>

                  <div className="mt-4 border-t border-(--surface-active-border) pt-4">
                    <ToggleOption
                      label="Modo compacto"
                      description="Reduce animaciones y espaciado visual."
                      enabled={settings.compactMode}
                      onChange={(enabled) => updateSetting("compactMode", enabled)}
                    />
                  </div>
                </SettingsSection>

                <SettingsSection
                  title="Fondo ambiental"
                  description="Muestra el arte del juego activo (difuminado) detras de la interfaz."
                >
                  <div className="space-y-4">
                    <ToggleOption
                      label="Fondo ambiental"
                      description="Activa el fondo dinamico en todas las pantallas."
                      enabled={ambientState.enabled}
                      onChange={setAmbientEnabled}
                    />

                    {ambientState.enabled && (
                      <>
                        <div className="lf-surface rounded-2xl border p-4">
                          <p className="text-sm font-medium text-(--color-text)">
                            Modo del fondo ambiental
                          </p>
                          <p className="mt-1 text-xs text-(--color-muted)">
                            Muestra el arte difuminado o el color dominante extraido de la foto.
                          </p>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            {(
                              [
                                { id: "image", label: "Imagen (difuminado)" },
                                { id: "color", label: "Color dominante" },
                              ] as const
                            ).map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => setAmbientMode(opt.id)}
                                className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                                  ambientState.mode === opt.id
                                    ? "border-(--color-accent)/60 bg-(--color-accent)/15 text-(--color-accent)"
                                    : "border-(--surface-active-border) bg-white/5 text-(--color-muted) hover:bg-white/10"
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="lf-surface rounded-2xl border p-4">
                          <p className="text-sm font-medium text-(--color-text)">
                            Intensidad del fondo ambiental
                          </p>
                          <p className="mt-1 text-xs text-(--color-muted)">
                            Controla cuanto se ve y se difumina el fondo ambiental.
                          </p>
                          <div className="mt-3 grid grid-cols-3 gap-2">
                            {(
                              [
                                { id: "sutil", label: "Sutil" },
                                { id: "equilibrado", label: "Equilibrado" },
                                { id: "vivido", label: "Vivido" },
                              ] as const
                            ).map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => setAmbientIntensity(opt.id)}
                                className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                                  ambientState.intensity === opt.id
                                    ? "border-(--color-accent)/60 bg-(--color-accent)/15 text-(--color-accent)"
                                    : "border-(--surface-active-border) bg-white/5 text-(--color-muted) hover:bg-white/10"
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </SettingsSection>
              </>
            )}

            {activeSection === "library" && (
              <>
                <HomeLayoutEditor />

                <CardLayoutEditor />
              </>
            )}

            {activeSection === "notifications" && (
              <>
                <SettingsSection
                  title="Session Overlay"
                  description="Control how game session notifications (launch/stop) are delivered."
                >
                  <div className="space-y-4">
                    <ToggleOption
                      label="Overlay notification window"
                      description="Use a transparent always-on-top overlay window for game launch and stop notifications."
                      enabled={settings.gameSessionOverlayEnabled}
                      onChange={(enabled) => updateSetting("gameSessionOverlayEnabled", enabled)}
                    />

                    <div className="lf-surface flex items-center justify-between gap-4 rounded-2xl border p-4">
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
                                ? "bg-(--color-accent) text-(--color-accent-text)"
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

                    <ToggleOption
                      label="Game session HUD"
                      description="Show a floating pill during gameplay with game info, elapsed time, and stop/resume buttons."
                      enabled={settings.gameSessionHudEnabled}
                      onChange={(enabled) => updateSetting("gameSessionHudEnabled", enabled)}
                    />

                    <ToggleOption
                      label="Send native OS notification"
                      description="Send a system notification when an achievement unlocks. Requires notification permission."
                      enabled={settings.achievementNativeNotificationsEnabled}
                      onChange={(enabled) => updateSetting("achievementNativeNotificationsEnabled", enabled)}
                    />

                    <ToggleOption
                      label="Achievement overlay window"
                      description="Show achievement unlocks in a transparent overlay window on top of the game."
                      enabled={settings.achievementOverlayNotificationsEnabled}
                      onChange={(enabled) => updateSetting("achievementOverlayNotificationsEnabled", enabled)}
                    />

                    <ToggleOption
                      label="Launcher achievement overlay"
                      description="Show launcher meta-achievements (streaks, playtime milestones) in the overlay window."
                      enabled={settings.launcherAchievementOverlayEnabled}
                      onChange={(enabled) => updateSetting("launcherAchievementOverlayEnabled", enabled)}
                    />
                  </div>
                </SettingsSection>
              </>
            )}

            {activeSection === "extensions" && (
              <ExtensionsSettings />
            )}

            {activeSection === "backup" && (
              <>
                <SettingsSection
                  title="Cloud & Backup"
                  description="Backups, restore and cloud sync."
                >
                  <div className="space-y-4">
                    <div className="mb-4 flex items-center gap-2 text-sm text-(--color-accent)">
                      <Cloud className="h-4 w-4" />
                      Backup & Restore
                    </div>
                    <p className="text-xs text-(--color-muted)">
                      Export your LumaForge settings, favorites, manual games, playtime and other data.
                      Import a backup to restore settings across devices or after a fresh install.
                    </p>
                  </div>
                </SettingsSection>
                <SettingsSection
                  title="Local Backups"
                  description="Export and import backup archives stored on this device."
                >
                  <BackupSectionUI />
                </SettingsSection>
              </>
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
                      <Crosshair className="h-4 w-4" />
                      SteamGridDB Artwork
                    </div>

                    <p className="text-xs text-(--color-muted)">
                      SteamGridDB provides poster, hero and logo artwork for Library cards. Requires an API key.
                    </p>

                    <ToggleOption
                      label="Enable SteamGridDB Artwork"
                      description="Use SteamGridDB to fetch poster, hero and logo artwork for Library and Juegos."
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
                </div>
              </SettingsSection>
            )}

            {activeSection === "providers" && (
              <>
                <SettingsSection
                  title="Downloads / Packages"
                  description="Configura las fuentes que LumaForge usara para buscar y descargar paquetes."
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
                          badgeContent={
                            provider.id === "hubcapdb"
                              ? <HubcapProviderBadges surface="settings" />
                              : provider.id === "ryuu" && providerSettings.apiKey
                                ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">Active</span>
                                : undefined
                          }
                        />
                      );
                    })}
                  </div>
                </SettingsSection>

                <div className="mt-6">
                  <DebridProvidersCard
                    config={settings.debridProviders}
                    onChange={(patch) => {
                      if (patch.debridProviders) updateSetting("debridProviders", patch.debridProviders);
                    }}
                  />
                </div>

                <div className="mt-6">
                  <ThirdPartyToolsSection />
                </div>

                <SettingsSection
                  title="Integrations"
                  description="Control which game providers are active and where they appear."
                >
                  <div className="space-y-4">
                    <div className="mb-4 flex items-center gap-2 text-sm text-(--color-accent)">
                      <Zap className="h-4 w-4" />
                      Provider integrations
                    </div>
                    <p className="text-xs text-(--color-muted)">
                      Disable an integration to stop its scans and hide its games from selected UI surfaces.
                      All stored data is preserved when an integration is disabled.
                    </p>
                  </div>
                </SettingsSection>
                <IntegrationsSection />
              </>
            )}

            {activeSection === "startup" && (
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
                      description="Elimina ZIPs y carpetas extraidas al salir."
                      enabled={settings.cleanTempOnExit}
                      onChange={(enabled) => updateSetting("cleanTempOnExit", enabled)}
                    />
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium text-(--color-text)">
                          Media cache profile
                        </label>
                        <p className="text-xs text-(--color-muted)">
                          Controls how aggressively artwork and metadata are cached locally.
                        </p>
                      </div>
                      <div className="flex overflow-hidden rounded-lg border border-(--surface-active-border)">
                        {(["minimal", "playnite-balanced", "full"] as const).map((profile) => (
                          <button
                            key={profile}
                            type="button"
                            onClick={() => updateSetting("mediaCacheProfile", profile)}
                            className={`cursor-pointer px-3 py-1.5 text-xs font-medium transition ${
                              settings.mediaCacheProfile === profile
                                ? "bg-(--color-accent) text-(--color-accent-text)"
                                : "bg-white/5 text-(--color-muted) hover:text-(--color-text)"
                            }`}
                          >
                            {profile === "minimal" ? "Minimal" : profile === "playnite-balanced" ? "Balanced" : "Full"}
                          </button>
                        ))}
                      </div>
                    </div>
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
                              ? "bg-(--color-accent) text-(--color-accent-text)"
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
                              ? "bg-(--color-accent) text-(--color-accent-text)"
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
                                ? "bg-(--color-accent) text-(--color-accent-text)"
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
                      description="Launch LumaForge automatically when Windows starts."
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

                <SettingsSection
                  title="Maintenance"
                  description="Re-run setup or reset configuration."
                >
                  <button
                    onClick={() => {
                      try { localStorage.removeItem("lumaforge-wizard-completed"); } catch {}
                      window.location.reload();
                    }}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/8"
                  >
                    <RotateCcw className="h-4 w-4 text-(--color-muted)" />
                    Run Setup Wizard
                  </button>
                </SettingsSection>
              </>
            )}

            {activeSection === "startup" && (
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
                  description="External services and tools used by LumaForge. LumaForge is not affiliated with or endorsed by any of these services."
                >
                  <div className="space-y-3">
                    {[
                      {
                        name: "Steam",
                        description: "Game library metadata, Steam app IDs, store links, achievements, and playtime tracking.",
                        url: "https://store.steampowered.com/",
                        badge: "configured" as const,
                        show: !!settings.steamRoot,
                      },
                      {
                        name: "SteamGridDB",
                        description: "Community artwork provider for covers, heroes, logos, and icons.",
                        url: "https://www.steamgriddb.com/",
                        badge: "configured" as const,
                        show: settings.steamGridDbArtworkEnabled && !!settings.steamGridDbApiKey,
                      },
                      {
                        name: "IGDB / Twitch",
                        description: "Game metadata provider using Twitch OAuth credentials.",
                        url: "https://www.igdb.com/",
                        badge: "configured" as const,
                        show: !!settings.igdbClientId && !!settings.igdbClientSecret,
                      },
                      {
                        name: "RAWG",
                        description: "Optional game metadata and background artwork provider.",
                        url: "https://rawg.io/",
                        badge: "configured" as const,
                        show: !!settings.rawgApiKey,
                      },
                      {
                        name: "Hubcap",
                        description: "Package and provider source for game downloads.",
                        url: "https://hubcapmanifest.com/",
                        badge: "configured" as const,
                        show: !!(settings.providers?.hubcapdb?.apiKey),
                      },
                      {
                        name: "Epic Games Store",
                        description: "Epic Games library detection and launcher integration.",
                        url: "https://store.epicgames.com/",
                        badge: "external" as const,
                      },
                      {
                        name: "Ryuu",
                        description: "Third-party game launcher and library manager.",
                        url: "https://ryuu.de/",
                        badge: "external" as const,
                      },
                      {
                        name: "TorBox",
                        description: "Debrid service for torrent and direct download acceleration.",
                        url: "https://torbox.app/",
                        badge: "external" as const,
                      },
                      {
                        name: "Real-Debrid",
                        description: "Debrid service for unrestricted downloads and torrent caching.",
                        url: "https://real-debrid.com/",
                        badge: "external" as const,
                      },
                      {
                        name: "AllDebrid",
                        description: "Debrid service for fast, unrestricted file hosting downloads.",
                        url: "https://alldebrid.com/",
                        badge: "external" as const,
                      },
                      {
                        name: "Premiumize",
                        description: "Debrid service combining VPN, cloud storage, and download acceleration.",
                        url: "https://premiumize.me/",
                        badge: "external" as const,
                      },
                      {
                        name: "SmokeAPI",
                        description: "Steam API proxy for offline and cracked games.",
                        url: "https://github.com/acidicoala/SmokeAPI",
                        badge: "external" as const,
                      },
                      {
                        name: "Steamless",
                        description: "SteamStub DRM unpacker for game executables.",
                        url: "https://github.com/atom0s/Steamless",
                        badge: "external" as const,
                      },
                      {
                        name: "Goldberg (GSE)",
                        description: "Offline Steam emulator with achievements support.",
                        url: "https://github.com/Detanup01/gbe_fork",
                        badge: "external" as const,
                      },
                      {
                        name: "Online-Fix",
                        description: "Multiplayer and co-op patches for local and LAN play.",
                        url: "https://online-fix.me/",
                        badge: "external" as const,
                      },
                      {
                        name: "Koaloader",
                        description: "Plugin loader for game directories. Auto-installed when needed.",
                        url: "https://github.com/acidicoala/Koaloader",
                        badge: "external" as const,
                      },
                      {
                        name: "OpenSteamTool",
                        description: "Steam library management and game modification tool.",
                        url: "https://github.com/OpenSteam001/OpenSteamTool",
                        badge: "external" as const,
                      },
                      {
                        name: "GitHub",
                        description: "LumaForge project source code and issue tracking.",
                        url: "https://github.com/nicegoodthings/lumaforge",
                        badge: "always" as const,
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
                            {service.badge === "configured" && service.show ? (
                              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                                Configured
                              </span>
                            ) : service.badge === "configured" ? (
                              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-(--color-muted)">
                                Optional
                              </span>
                            ) : (
                              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-(--color-muted)">
                                External
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
    </>
  );
}
