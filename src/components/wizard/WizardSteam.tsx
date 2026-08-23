import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderSearch, Key, ExternalLink, Check, AlertTriangle } from "lucide-react";
import { useSettings } from "../../context/SettingsContext";
import { detectSteamPaths } from "../../services/tauri";
import WizardStep from "./WizardStep";

type Props = {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
};

export default function WizardSteam({ currentStep, totalSteps, onBack, onContinue, onSkip }: Props) {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const [detecting, setDetecting] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (!settings.steamRoot) {
      setDetecting(true);
      detectSteamPaths()
        .then((paths) => {
          if (paths) {
            updateSetting("steamRoot", paths.steam_root);
            updateSetting("luaPath", paths.lua_path);
            updateSetting("depotcachePath", paths.depotcache_path);
          }
        })
        .catch(() => {})
        .finally(() => setDetecting(false));
    }
  }, []);

  const hasSteam = !!settings.steamRoot;

  return (
    <WizardStep
      icon={<FolderSearch className="h-8 w-8" />}
      title={t("wizard.steam_title")}
      description={t("wizard.steam_desc")}
      currentStep={currentStep}
      totalSteps={totalSteps}
      onBack={onBack}
      onContinue={onContinue}
      onSkip={onSkip}
    >
      {/* Steam detection status */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-center gap-3">
          {hasSteam ? (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <Check className="h-5 w-5" />
            </div>
          ) : detecting ? (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent" />
            </div>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-(--color-text)">
              {hasSteam ? t("wizard.steam_detected") : detecting ? t("wizard.steam_detecting") : t("wizard.steam_not_found")}
            </p>
            {hasSteam && (
              <p className="mt-0.5 truncate text-xs text-(--color-muted)">
                {settings.steamRoot}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Steam Web API Key */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="mb-3 flex items-center gap-2">
          <Key className="h-4 w-4 text-(--color-muted)" />
          <p className="text-sm font-medium text-(--color-text)">{t("wizard.steam_web_api_key")}</p>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-(--color-muted)">{t("wizard.steam_optional")}</span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-(--color-muted)">
          {t("wizard.steam_api_desc")}
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? "text" : "password"}
              value={settings.steamWebApiKey}
              onChange={(e) => updateSetting("steamWebApiKey", e.target.value)}
              placeholder={t("wizard.steam_api_placeholder")}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-(--color-text) placeholder-(--color-muted) outline-none transition focus:border-(--color-accent)/50 focus:ring-1 focus:ring-(--color-accent)/30"
            />
          </div>
          <button
            onClick={() => setShowKey(!showKey)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-(--color-muted) transition hover:bg-white/8"
          >
            {showKey ? t("wizard.steam_api_hide") : t("wizard.steam_api_show")}
          </button>
        </div>
        <a
          href="https://steamcommunity.com/dev/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-(--color-accent) transition hover:brightness-110"
        >
          <ExternalLink className="h-3 w-3" />
          {t("wizard.steam_api_link")}
        </a>
      </div>

      {/* SteamID64 */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="mb-3 flex items-center gap-2">
          <Key className="h-4 w-4 text-(--color-muted)" />
          <p className="text-sm font-medium text-(--color-text)">{t("wizard.steam_id64")}</p>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-(--color-muted)">{t("wizard.steam_optional")}</span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-(--color-muted)">
          {t("wizard.steam_id64_desc")}
        </p>
        <input
          type="text"
          value={settings.steamId64}
          onChange={(e) => updateSetting("steamId64", e.target.value)}
          placeholder="76561198000000000"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-(--color-text) placeholder-(--color-muted) outline-none transition focus:border-(--color-accent)/50 focus:ring-1 focus:ring-(--color-accent)/30"
        />
      </div>
    </WizardStep>
  );
}
