import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import ThirdPartyToolsSection from "../components/settings/ThirdPartyToolsSection";
import { EpicAuthPanel } from "../features/epic/EpicAuthPanel";
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
  Volume2,
  Play,
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
// import ExtensionsSettings from "../extensions/ui/ExtensionsSettings";

import { defaultApiProviders } from "../data/providers";
import { ApiProviderUserSettings } from "../types/provider";

import { themes, surfaceModes, themeVariables } from "../theme/themes";
import { useTheme } from "../context/ThemeContext";
import { useSettings } from "../context/SettingsContext";
import { clearIgdbTokenCache } from "../services/igdbAccessTokenService";
import { openExternalUrl } from "../services/externalLinks";
import { previewAchievementSound } from "../features/activity/achievements/achievementSound";
import { ACHIEVEMENT_SOUND_STYLES } from "../features/activity/achievements/achievementSoundStyles";

type SettingsSectionId =
  | "general"
  | "appearance"
  | "sound"
  | "library"
  | "notifications"
  | "metadata"
  | "extensions"
  | "providers"
  | "backup"
  | "startup";

type SettingsProps = {
  onSectionChange?: (label: string) => void;
};

export default function Settings({ onSectionChange }: SettingsProps) {
  const { t, i18n } = useTranslation();

  const navSections: {
    key: SettingsSectionId;
    label: string;
    icon: React.ReactNode;
    description: string;
  }[] = [
    { key: "general", label: t("settings.general"), icon: <Cog className="h-4 w-4" />, description: t("settings.general_desc") },
    { key: "appearance", label: t("settings.appearance"), icon: <Palette className="h-4 w-4" />, description: t("settings.appearance_desc") },
    { key: "sound", label: t("settings.sound"), icon: <Volume2 className="h-4 w-4" />, description: t("settings.sound_desc") },
    { key: "library", label: t("settings.layout"), icon: <Library className="h-4 w-4" />, description: t("settings.layout_desc") },
    { key: "notifications", label: t("settings.notifications"), icon: <Gamepad2 className="h-4 w-4" />, description: t("settings.notifications_desc") },
    { key: "metadata", label: t("settings.metadata"), icon: <Database className="h-4 w-4" />, description: t("settings.metadata_desc") },
    // { key: "extensions", label: t("settings.extensions"), icon: <Puzzle className="h-4 w-4" />, description: t("settings.extensions_desc") },
    { key: "providers", label: t("settings.providers"), icon: <Zap className="h-4 w-4" />, description: t("settings.providers_desc") },
    { key: "backup", label: t("settings.backup"), icon: <Cloud className="h-4 w-4" />, description: t("settings.backup_desc") },
    { key: "startup", label: t("settings.startup"), icon: <Power className="h-4 w-4" />, description: t("settings.startup_desc") },
  ];
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
        showError(t("steam_detection.no_steam_msg"), {
          title: t("steam_detection.no_steam_title"),
        });

        return;
      }

      updateSetting("steamRoot", paths.steam_root);
      updateSetting("luaPath", paths.lua_path);
      updateSetting("depotcachePath", paths.depotcache_path);

      if (!paths.lua_exists) {
          showWarning(
            t("steam_detection.lua_not_found_msg"),
            {
              title: t("steam_detection.lua_not_found_title"),
            }
          );

        return;
      }

        showSuccess(t("steam_detection.steam_detected_msg"), {
          title: t("steam_detection.steam_detected_title"),
        });
    } catch (error) {
      console.error(error);

      showError(t("steam_detection.error_msg"), {
        title: t("steam_detection.error_title"),
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
            <span className="truncate">{t("settings.reset")}</span>
          </button>
        </div>
      </nav>

      {/* Content area — scrollable */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
            {activeSection === "general" && (
              <>
                <SettingsSection
                  title={t("settings.paths")}
                  description={t("settings.paths_desc")}
                >
                <div className="mb-4 flex items-center gap-2 text-sm text-(--color-accent)">
                  <FolderCog className="h-4 w-4" />
                  {t("settings.steam_folders")}
                </div>

                <button
                  type="button"
                  onClick={handleDetectSteamPaths}
                  className="mb-4 inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm text-(--color-text) transition hover:bg-white/10"
                >
                  <Crosshair className="h-4 w-4" />
                  {t("settings.detect_steam")}
                </button>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <SettingsInput
                    label={t("settings.steam_root")}
                    description={t("settings.steam_root_desc")}
                    placeholder={t("settings.not_detected")}
                    value={settings.steamRoot}
                    onChange={(value) => updateSetting("steamRoot", value)}
                  />

                  <SettingsInput
                    label={t("settings.lua_path")}
                    description={t("settings.lua_path_desc")}
                    placeholder={t("settings.not_detected")}
                    value={settings.luaPath}
                    onChange={(value) => updateSetting("luaPath", value)}
                  />

                  <SettingsInput
                    label={t("settings.depot_cache")}
                    description={t("settings.depot_cache_desc")}
                    placeholder={t("settings.not_detected")}
                    value={settings.depotcachePath}
                    onChange={(value) => updateSetting("depotcachePath", value)}
                  />

                  <SettingsInput
                    label={t("settings.temp_folder")}
                    description={t("settings.temp_folder_desc")}
                    placeholder={t("settings.temp_use_system")}
                    value={settings.tempFolder}
                    onChange={(value) => updateSetting("tempFolder", value)}
                  />
                </div>
              </SettingsSection>

              <SettingsSection
                title={t("settings.steam_account")}
                description={t("settings.steam_account_desc")}
              >
                <div className="space-y-4">
                  <ToggleOption
                    label={t("settings.enable_achievements")}
                    description={t("settings.achievements_desc")}
                    enabled={settings.steamAchievementsEnabled}
                    onChange={(enabled) => updateSetting("steamAchievementsEnabled", enabled)}
                  />

                  {settings.steamAchievementsEnabled && (!settings.steamWebApiKey || !settings.steamId64) && (
                    <p className="text-xs text-amber-400">
                      {t("settings.achievements_warning")}
                    </p>
                  )}

                  <label className="block">
                    <div className="mb-2">
                      <p className="text-sm font-medium text-(--color-text)">
                        {t("settings.api_key")}
                      </p>
                      <p className="mt-1 text-xs text-(--color-muted)">
                        {t("settings.api_key_desc")}
                      </p>
                    </div>
                    <div className="relative">
                      <input
                        type={showSteamApiKey ? "text" : "password"}
                        value={settings.steamWebApiKey}
                        onChange={(e) => updateSetting("steamWebApiKey", e.target.value)}
                        className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 pr-10 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                        placeholder={t("settings.api_key_placeholder")}
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
                        {t("settings.steam_id64")}
                      </p>
                      <p className="mt-1 text-xs text-(--color-muted)">
                        {t("settings.steam_id64_desc")}
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
                        {t("settings.steam_id32")}
                      </p>
                      <p className="mt-1 text-xs text-(--color-muted)">
                        {t("settings.steam_id32_desc")}
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

              <SettingsSection
                title={t("settings.epic_account")}
                description={t("settings.epic_account_desc")}
              >
                <EpicAuthPanel />
              </SettingsSection>
              </>
            )}

            {activeSection === "appearance" && (
              <>
                <SettingsSection
                  title={t("settings.appearance_title")}
                  description={t("settings.appearance_desc")}
                >
                  <div className="mb-4 flex items-center gap-2 text-sm text-(--color-accent)">
                    <Palette className="h-4 w-4" />
                    {t("settings.current_theme")} {currentTheme?.name}
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

                  {/* Language Selector */}
                  <div className="mt-6">
                    <div className="mb-3">
                      <h3 className="font-medium text-(--color-text)">
                        {t("settings.language", "Idioma")}
                      </h3>
                      <p className="mt-1 text-sm text-(--color-muted)">
                        {t("settings.languageDescription", "Cambia el idioma de la interfaz.")}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { i18n.changeLanguage("es"); localStorage.setItem("lumaforge-lang", "es"); updateSetting("language", "es"); }}
                        className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                          settings.language === "es"
                            ? "bg-blue-600 text-white"
                            : "bg-(--color-surface) text-(--color-muted) hover:text-(--color-text)"
                        }`}
                      >
                        Español
                      </button>
                      <button
                        onClick={() => { i18n.changeLanguage("en"); localStorage.setItem("lumaforge-lang", "en"); updateSetting("language", "en"); }}
                        className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                          settings.language === "en"
                            ? "bg-blue-600 text-white"
                            : "bg-(--color-surface) text-(--color-muted) hover:text-(--color-text)"
                        }`}
                      >
                        English
                      </button>
                    </div>
                  </div>

                  <div className="mt-6">
                    <div className="mb-3">
                      <h3 className="font-medium text-(--color-text)">
                        {t("settings.surface_style")}
                      </h3>

                      <p className="mt-1 text-sm text-(--color-muted)">
                        {t("settings.surface_style_desc")}
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
                  title={t("settings.animations")}
                  description={t("settings.animations_desc")}
                >
                  <div className="mb-3 flex items-center gap-2 text-sm text-(--color-muted)">
                    <SlidersHorizontal className="h-4 w-4" />
                    {t("settings.hero_transition")}
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
                          {t(opt.labelKey, opt.label)}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-(--color-muted)">
                          {t(opt.descriptionKey, opt.description)}
                        </span>
                      </button>
                    ))}
                  </div>

                  <p className="mt-4 text-xs text-(--color-muted)">
                    {t("settings.ambient_note")}
                  </p>

                  <div className="mt-4 border-t border-(--surface-active-border) pt-4">
                    <ToggleOption
                      label={t("settings.compact_mode")}
                      description={t("settings.compact_desc")}
                      enabled={settings.compactMode}
                      onChange={(enabled) => updateSetting("compactMode", enabled)}
                    />
                  </div>
                </SettingsSection>

                <SettingsSection
                  title={t("settings.ambient")}
                  description={t("settings.ambient_desc")}
                >
                  <div className="space-y-4">
                    <ToggleOption
                      label={t("settings.ambient_toggle")}
                      description={t("settings.ambient_toggle_desc")}
                      enabled={ambientState.enabled}
                      onChange={setAmbientEnabled}
                    />

                    {ambientState.enabled && (
                      <>
                        <div className="lf-surface rounded-2xl border p-4">
                          <p className="text-sm font-medium text-(--color-text)">
                            {t("settings.ambient_mode")}
                          </p>
                          <p className="mt-1 text-xs text-(--color-muted)">
                            {t("settings.ambient_mode_desc")}
                          </p>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            {(
                              [
                                { id: "image", label: t("settings.ambient_mode_image") },
                                { id: "color", label: t("settings.ambient_mode_color") },
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
                            {t("settings.ambient_intensity")}
                          </p>
                          <p className="mt-1 text-xs text-(--color-muted)">
                            {t("settings.ambient_intensity_desc")}
                          </p>
                          <div className="mt-3 grid grid-cols-3 gap-2">
                            {(
                              [
                                { id: "sutil", label: t("settings.ambient_subtle") },
                                { id: "equilibrado", label: t("settings.ambient_balanced") },
                                { id: "vivido", label: t("settings.ambient_vivid") },
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

            {activeSection === "sound" && (
              <>
                <SettingsSection
                  title={t("settings.sound_effects_title")}
                  description={t("settings.sound_effects_desc")}
                >
                  <div className="space-y-4">
                    <ToggleOption
                      label={t("settings.sound_effects_enabled")}
                      description={t("settings.sound_effects_enabled_desc")}
                      enabled={settings.soundEffectsEnabled}
                      onChange={(enabled) => updateSetting("soundEffectsEnabled", enabled)}
                    />

                    {settings.soundEffectsEnabled && (
                      <div className="lf-surface rounded-2xl border p-4">
                        <div className="space-y-3">
                          <div>
                            <label className="text-sm font-medium text-(--color-text)">
                              {t("settings.sound_effects_volume")}
                            </label>
                            <p className="text-xs text-(--color-muted)">
                              {t("settings.sound_effects_volume_desc")}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <Volume2 className="h-4 w-4 text-(--color-muted)" />
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={Math.round(settings.soundEffectsVolume * 100)}
                              onChange={(e) => updateSetting("soundEffectsVolume", Number(e.target.value) / 100)}
                              className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-(--color-accent)"
                            />
                            <span className="min-w-[3ch] text-right text-xs text-(--color-muted)">
                              {Math.round(settings.soundEffectsVolume * 100)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </SettingsSection>

                <SettingsSection
                  title={t("settings.achievement_sounds_title")}
                  description={t("settings.achievement_sounds_desc")}
                >
                  <div className="space-y-4">
                    <ToggleOption
                      label={t("settings.achievement_sounds_enabled")}
                      description={t("settings.achievement_sounds_enabled_desc")}
                      enabled={settings.achievementSoundsEnabled}
                      onChange={(enabled) => updateSetting("achievementSoundsEnabled", enabled)}
                    />

                    {settings.achievementSoundsEnabled && (
                      <div className="lf-surface rounded-2xl border p-4">
                        <div className="space-y-3">
                          <div>
                            <label className="text-sm font-medium text-(--color-text)">
                              {t("settings.achievement_sound_style")}
                            </label>
                            <p className="text-xs text-(--color-muted)">
                              {t("settings.achievement_sound_style_desc")}
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {ACHIEVEMENT_SOUND_STYLES.map((style) => (
                              <div
                                key={style.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => updateSetting("achievementSoundStyle", style.id as any)}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); updateSetting("achievementSoundStyle", style.id as any); } }}
                                className={`flex items-center justify-between gap-2 rounded-xl border p-3 text-left transition ${
                                  settings.achievementSoundStyle === style.id
                                    ? "border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent)"
                                    : "border-white/10 bg-white/5 text-(--color-muted) hover:text-(--color-text)"
                                }`}
                              >
                                <span className="text-sm font-medium">{style.label}</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    previewAchievementSound(style.id, "legendary");
                                  }}
                                  className="rounded-lg p-1.5 transition hover:bg-white/10"
                                  title={t("settings.achievement_sound_preview")}
                                >
                                  <Play className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </SettingsSection>

                <SettingsSection
                  title={t("settings.ambient_sound_title")}
                  description={t("settings.ambient_sound_desc")}
                >
                  <div className="space-y-4">
                    <ToggleOption
                      label={t("settings.ambient_sound_enabled")}
                      description={t("settings.ambient_sound_enabled_desc")}
                      enabled={settings.consoleAmbientEnabled}
                      onChange={(enabled) => updateSetting("consoleAmbientEnabled", enabled)}
                    />
                  </div>
                </SettingsSection>
              </>
            )}

            {activeSection === "notifications" && (
              <>
                <SettingsSection
                  title={t("settings.overlay_title")}
                  description={t("settings.overlay_desc")}
                >
                  <div className="space-y-4">
                    <ToggleOption
                      label={t("settings.overlay_window")}
                      description={t("settings.overlay_window_desc")}
                      enabled={settings.gameSessionOverlayEnabled}
                      onChange={(enabled) => updateSetting("gameSessionOverlayEnabled", enabled)}
                    />

                    <div className="lf-surface flex items-center justify-between gap-4 rounded-2xl border p-4">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium text-(--color-text)">
                          {t("settings.overlay_position")}
                        </label>
                        <p className="text-xs text-(--color-muted)">
                          {t("settings.overlay_position_desc")}
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
                      label={t("settings.hud")}
                      description={t("settings.hud_desc")}
                      enabled={settings.gameSessionHudEnabled}
                      onChange={(enabled) => updateSetting("gameSessionHudEnabled", enabled)}
                    />

                    <ToggleOption
                      label={t("settings.native_notification")}
                      description={t("settings.native_notification_desc")}
                      enabled={settings.achievementNativeNotificationsEnabled}
                      onChange={(enabled) => updateSetting("achievementNativeNotificationsEnabled", enabled)}
                    />

                    <ToggleOption
                      label={t("settings.achievement_overlay")}
                      description={t("settings.achievement_overlay_desc")}
                      enabled={settings.achievementOverlayNotificationsEnabled}
                      onChange={(enabled) => updateSetting("achievementOverlayNotificationsEnabled", enabled)}
                    />

                    <ToggleOption
                      label={t("settings.launcher_overlay")}
                      description={t("settings.launcher_overlay_desc")}
                      enabled={settings.launcherAchievementOverlayEnabled}
                      onChange={(enabled) => updateSetting("launcherAchievementOverlayEnabled", enabled)}
                    />
                  </div>
                </SettingsSection>
              </>
            )}

            {/* {activeSection === "extensions" && (
              <ExtensionsSettings />
            )} */}

            {activeSection === "backup" && (
              <>
                <SettingsSection
                  title={t("settings.backup_title")}
                  description={t("settings.backup_desc")}
                >
                  <div className="space-y-4">
                    <div className="mb-4 flex items-center gap-2 text-sm text-(--color-accent)">
                      <Cloud className="h-4 w-4" />
                      {t("settings.backup_section")}
                    </div>
                    <p className="text-xs text-(--color-muted)">
                      {t("settings.backup_description")}
                    </p>
                  </div>
                </SettingsSection>
                <SettingsSection
                  title={t("settings.backup_local")}
                  description={t("settings.backup_local_desc")}
                >
                  <BackupSectionUI />
                </SettingsSection>
              </>
            )}

            {activeSection === "metadata" && (
              <SettingsSection
                title={t("settings.metadata_title")}
                description={t("settings.metadata_desc")}
              >
                <div className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm text-(--color-accent)">
                      <Gamepad2 className="h-4 w-4" />
                      {t("settings.igdb_label")}
                    </div>

                    <p className="text-xs text-(--color-muted)">
                      {t("settings.igdb_desc")}
                    </p>

                    {(!settings.igdbClientId || !settings.igdbClientSecret) && (
                      <p className="text-xs text-amber-400">
                        {t("settings.igdb_warning")}
                      </p>
                    )}

                    <label className="block">
                      <div className="mb-2">
                        <p className="text-sm font-medium text-(--color-text)">
                          {t("settings.igdb_client_id")}
                        </p>
                      </div>
                      <input
                        type="text"
                        value={settings.igdbClientId}
                        onChange={(e) => { updateSetting("igdbClientId", e.target.value); clearIgdbTokenCache(); }}
                        className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                        placeholder={t("settings.igdb_client_id_placeholder")}
                      />
                    </label>

                    <label className="block">
                      <div className="mb-2">
                        <p className="text-sm font-medium text-(--color-text)">
                          {t("settings.igdb_client_secret")}
                        </p>
                      </div>
                      <div className="relative">
                        <input
                          type={showIgdbSecret ? "text" : "password"}
                          value={settings.igdbClientSecret}
                          onChange={(e) => { updateSetting("igdbClientSecret", e.target.value); clearIgdbTokenCache(); }}
                          className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 pr-10 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                          placeholder={t("settings.igdb_client_secret_placeholder")}
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
                      {t("settings.rawg_label")}
                    </div>

                    <p className="text-xs text-(--color-muted)">
                      {t("settings.rawg_desc")}
                    </p>

                    {!settings.rawgApiKey && (
                      <p className="text-xs text-amber-400">
                        {t("settings.rawg_warning")}
                      </p>
                    )}

                    <label className="block">
                      <div className="mb-2">
                        <p className="text-sm font-medium text-(--color-text)">
                          {t("settings.rawg_key")}
                        </p>
                      </div>
                      <div className="relative">
                        <input
                          type={showRawgKey ? "text" : "password"}
                          value={settings.rawgApiKey}
                          onChange={(e) => updateSetting("rawgApiKey", e.target.value)}
                          className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 pr-10 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                          placeholder={t("settings.rawg_key_placeholder")}
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
                      {t("settings.sgdb_label")}
                    </div>

                    <p className="text-xs text-(--color-muted)">
                      {t("settings.sgdb_desc")}
                    </p>

                    <ToggleOption
                      label={t("settings.sgdb_enable")}
                      description={t("settings.sgdb_enable_desc")}
                      enabled={settings.steamGridDbArtworkEnabled}
                      onChange={(enabled) => updateSetting("steamGridDbArtworkEnabled", enabled)}
                    />

                    {settings.steamGridDbArtworkEnabled && !settings.steamGridDbApiKey && (
                      <p className="text-xs text-amber-400">
                        {t("settings.sgdb_warning")}
                      </p>
                    )}

                    <label className="block">
                      <div className="mb-2">
                        <p className="text-sm font-medium text-(--color-text)">
                          {t("settings.sgdb_key")}
                        </p>
                        <p className="mt-1 text-xs text-(--color-muted)">
                          {t("settings.sgdb_key_desc")}
                        </p>
                      </div>
                      <div className="relative">
                        <input
                          type={showSgdbKey ? "text" : "password"}
                          value={settings.steamGridDbApiKey}
                          onChange={(e) => updateSetting("steamGridDbApiKey", e.target.value)}
                          className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 pr-10 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
                          placeholder={t("settings.sgdb_key_placeholder")}
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
                  title={t("settings.providers_downloads")}
                  description={t("settings.providers_downloads_desc")}
                >
                  <div className="mb-4 flex items-center gap-2 text-sm text-(--color-accent)">
                    <Globe className="h-4 w-4" />
                    {t("settings.multi_fallback")}
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
                                ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">{t("settings.active_label")}</span>
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
                  title={t("settings.integrations")}
                  description={t("settings.integrations_desc")}
                >
                  <div className="space-y-4">
                    <div className="mb-4 flex items-center gap-2 text-sm text-(--color-accent)">
                      <Zap className="h-4 w-4" />
                      {t("settings.integrations_icon")}
                    </div>
                    <p className="text-xs text-(--color-muted)">
                      {t("settings.integrations_note")}
                    </p>
                  </div>
                </SettingsSection>
                <IntegrationsSection />
              </>
            )}

            {activeSection === "startup" && (
              <>
                <SettingsSection
                  title={t("settings.advanced")}
                  description={t("settings.advanced_desc")}
                >
                  <div className="mb-4 flex items-center gap-2 text-sm text-(--color-accent)">
                    <SlidersHorizontal className="h-4 w-4" />
                    {t("settings.system")}
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <ToggleOption
                      label={t("settings.auto_backup")}
                      description={t("settings.auto_backup_desc")}
                      enabled={settings.createBackups}
                      onChange={(enabled) => updateSetting("createBackups", enabled)}
                    />

                    <ToggleOption
                      label={t("settings.detailed_logs")}
                      description={t("settings.detailed_logs_desc")}
                      enabled={settings.detailedLogs}
                      onChange={(enabled) => updateSetting("detailedLogs", enabled)}
                    />

                    <ToggleOption
                      label={t("settings.clean_temp")}
                      description={t("settings.clean_temp_desc")}
                      enabled={settings.cleanTempOnExit}
                      onChange={(enabled) => updateSetting("cleanTempOnExit", enabled)}
                    />
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium text-(--color-text)">
                          {t("settings.media_cache")}
                        </label>
                        <p className="text-xs text-(--color-muted)">
                          {t("settings.media_cache_desc")}
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
                            {profile === "minimal" ? t("settings.media_cache_minimal") : profile === "playnite-balanced" ? t("settings.media_cache_balanced") : t("settings.media_cache_full")}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 border-t border-(--surface-active-border) pt-4">
                    <div className="mb-3 flex items-center gap-2 text-sm text-(--color-accent)">
                      <SlidersHorizontal className="h-4 w-4" />
                      {t("settings.library_maintenance")}
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
                            showSuccess(t("settings.library_rebuild_success"));
                          } catch (err) {
                            showError(t("settings.library_rebuild_error", { error: String(err) }));
                          }
                        }}
                        className="lf-btn lf-btn-primary text-xs"
                      >
                        {t("settings.rebuild_index")}
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
                        {t("settings.validate_health")}
                      </button>
                    </div>
                  </div>
                </SettingsSection>
              </>
            )}

            {activeSection === "startup" && (
              <>
                <SettingsSection
                  title={t("settings.startup_behavior")}
                  description={t("settings.startup_behavior_desc")}
                >
                  <div className="space-y-4">
                    <div className="mb-2 flex items-center gap-2 text-sm text-(--color-accent)">
                      <Power className="h-4 w-4" />
                      {t("settings.launch_mode")}
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium text-(--color-text)">
                          {t("settings.default_launch")}
                        </label>
                        <p className="text-xs text-(--color-muted)">
                          {t("settings.default_launch_desc")}
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
                          {t("settings.desktop")}
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
                          {t("settings.console")}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium text-(--color-text)">
                          {t("settings.window_mode")}
                        </label>
                        <p className="text-xs text-(--color-muted)">
                          {t("settings.window_mode_desc")}
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
                  title={t("settings.auto_behavior_title")}
                  description={t("settings.auto_behavior_desc")}
                >
                  <div className="space-y-4">
                    <ToggleOption
                      label={t("settings.start_with_windows")}
                      description={t("settings.start_with_windows_desc")}
                      enabled={settings.startWithWindows}
                      onChange={(enabled) => updateSetting("startWithWindows", enabled)}
                    />

                    <ToggleOption
                      label={t("settings.start_maximized")}
                      description={t("settings.start_maximized_desc")}
                      enabled={settings.startMaximized}
                      onChange={(enabled) => updateSetting("startMaximized", enabled)}
                    />

                    <ToggleOption
                      label={t("settings.start_in_tray")}
                      description={t("settings.start_in_tray_desc")}
                      enabled={settings.startInTray}
                      onChange={(enabled) => updateSetting("startInTray", enabled)}
                    />

                    <ToggleOption
                      label={t("settings.close_to_tray")}
                      description={t("settings.close_to_tray_desc")}
                      enabled={settings.closeToTray}
                      onChange={(enabled) => updateSetting("closeToTray", enabled)}
                    />

                    <ToggleOption
                      label={t("settings.show_dashboard_on_startup")}
                      description={t("settings.show_dashboard_on_startup_desc")}
                      enabled={settings.showDashboardOnStartup}
                      onChange={(enabled) => updateSetting("showDashboardOnStartup", enabled)}
                    />

                    <ToggleOption
                      label={t("settings.disable_auto_updates")}
                      description={t("settings.disable_auto_updates_desc")}
                      enabled={settings.disableAutoUpdates}
                      onChange={(enabled) => updateSetting("disableAutoUpdates", enabled)}
                    />
                  </div>
                </SettingsSection>

                <SettingsSection
                  title={t("settings.maintenance")}
                  description={t("settings.maintenance_desc")}
                >
                  <button
                    onClick={() => {
                      try { localStorage.removeItem("lumaforge-wizard-completed"); } catch {}
                      window.location.reload();
                    }}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/8"
                  >
                    <RotateCcw className="h-4 w-4 text-(--color-muted)" />
                    {t("settings.run_wizard")}
                  </button>
                </SettingsSection>
              </>
            )}

            {activeSection === "startup" && (
              <>
                <SettingsSection
                  title={t("settings.about")}
                  description={t("settings.about_desc")}
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
                            {t("settings.your_companion")}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-(--color-muted)">
                            <span>{t("settings.version_label")} 0.1.0</span>
                            <span className="text-white/20">|</span>
                            <span>{t("settings.desktop_mode_label")}</span>
                            <span className="text-white/20">|</span>
                            <span>{t("settings.tauri_react")}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => openExternalUrl("https://github.com/anomalyco/LumaForge")}
                        className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm text-(--color-text) transition hover:bg-white/10"
                      >
                        <Code className="h-4 w-4" />
                        {t("settings.github_repo")}
                        <ExternalLink className="h-3 w-3 text-(--color-muted)" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openExternalUrl("https://github.com/anomalyco/LumaForge/blob/main/LICENSE")}
                        className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm text-(--color-text) transition hover:bg-white/10"
                      >
                        <ExternalLink className="h-4 w-4" />
                        {t("settings.view_license")}
                      </button>
                    </div>
                  </div>
                </SettingsSection>

                <SettingsSection
                  title={t("settings.data_services")}
                  description={t("settings.data_services_desc")}
                >
                  <div className="space-y-3">
                    {[
                      {
                        name: "Steam",
                        description: t("settings.service_steam_desc"),
                        url: "https://store.steampowered.com/",
                        badge: "configured" as const,
                        show: !!settings.steamRoot,
                      },
                      {
                        name: "SteamGridDB",
                        description: t("settings.service_sgdb_desc"),
                        url: "https://www.steamgriddb.com/",
                        badge: "configured" as const,
                        show: settings.steamGridDbArtworkEnabled && !!settings.steamGridDbApiKey,
                      },
                      {
                        name: "IGDB / Twitch",
                        description: t("settings.service_igdb_desc"),
                        url: "https://www.igdb.com/",
                        badge: "configured" as const,
                        show: !!settings.igdbClientId && !!settings.igdbClientSecret,
                      },
                      {
                        name: "RAWG",
                        description: t("settings.service_rawg_desc"),
                        url: "https://rawg.io/",
                        badge: "configured" as const,
                        show: !!settings.rawgApiKey,
                      },
                      {
                        name: "Hubcap",
                        description: t("settings.service_hubcap_desc"),
                        url: "https://hubcapmanifest.com/",
                        badge: "configured" as const,
                        show: !!(settings.providers?.hubcapdb?.apiKey),
                      },
                      {
                        name: "Epic Games Store",
                        description: t("settings.service_epic_desc"),
                        url: "https://store.epicgames.com/",
                        badge: "external" as const,
                      },
                      {
                        name: "Ryuu",
                        description: t("settings.service_ryuu_desc"),
                        url: "https://ryuu.de/",
                        badge: "external" as const,
                      },
                      {
                        name: "TorBox",
                        description: t("settings.service_torbox_desc"),
                        url: "https://torbox.app/",
                        badge: "external" as const,
                      },
                      {
                        name: "Real-Debrid",
                        description: t("settings.service_realdebrid_desc"),
                        url: "https://real-debrid.com/",
                        badge: "external" as const,
                      },
                      {
                        name: "AllDebrid",
                        description: t("settings.service_alldebrid_desc"),
                        url: "https://alldebrid.com/",
                        badge: "external" as const,
                      },
                      {
                        name: "Premiumize",
                        description: t("settings.service_premiumize_desc"),
                        url: "https://premiumize.me/",
                        badge: "external" as const,
                      },
                      {
                        name: "SmokeAPI",
                        description: t("settings.service_smokeapi_desc"),
                        url: "https://github.com/acidicoala/SmokeAPI",
                        badge: "external" as const,
                      },
                      {
                        name: "Steamless",
                        description: t("settings.service_steamless_desc"),
                        url: "https://github.com/atom0s/Steamless",
                        badge: "external" as const,
                      },
                      {
                        name: "Goldberg (GSE)",
                        description: t("settings.service_goldberg_desc"),
                        url: "https://github.com/Detanup01/gbe_fork",
                        badge: "external" as const,
                      },
                      {
                        name: "Online-Fix",
                        description: t("settings.service_onlinefix_desc"),
                        url: "https://online-fix.me/",
                        badge: "external" as const,
                      },
                      {
                        name: "Koaloader",
                        description: t("settings.service_koaloader_desc"),
                        url: "https://github.com/acidicoala/Koaloader",
                        badge: "external" as const,
                      },
                      {
                        name: "OpenSteamTool",
                        description: t("settings.service_opentool_desc"),
                        url: "https://github.com/OpenSteam001/OpenSteamTool",
                        badge: "external" as const,
                      },
                      {
                        name: "GitHub",
                        description: t("settings.service_github_desc"),
                        url: "https://github.com/anomalyco/LumaForge",
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
                                {t("settings.service_configured")}
                              </span>
                            ) : service.badge === "configured" ? (
                              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-(--color-muted)">
                                {t("settings.service_optional")}
                              </span>
                            ) : (
                              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-(--color-muted)">
                                {t("settings.service_external")}
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
                          {t("settings.visit")}
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
