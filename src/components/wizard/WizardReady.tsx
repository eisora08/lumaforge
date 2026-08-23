import { PartyPopper, Check, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../context/SettingsContext";
import WizardStep from "./WizardStep";

type Props = {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  onLaunch: () => void;
};

export default function WizardReady({ currentStep, totalSteps, onBack, onLaunch }: Props) {
  const { t } = useTranslation();
  const { settings } = useSettings();

  const configuredItems = [
    { label: t("wizard.ready_theme"), done: true },
    { label: t("wizard.ready_steam_detect"), done: !!settings.steamRoot },
    { label: t("wizard.ready_steam_api"), done: !!settings.steamWebApiKey },
    { label: t("wizard.ready_hubcap"), done: !!settings.providers.hubcapdb?.apiKey },
    { label: t("wizard.ready_ryuu"), done: !!settings.providers.ryuu?.apiKey },
    { label: t("wizard.ready_sgdb"), done: !!settings.steamGridDbApiKey },
    { label: t("wizard.ready_igdb"), done: !!(settings.igdbClientId && settings.igdbClientSecret) },
    { label: t("wizard.ready_rawg"), done: !!settings.rawgApiKey },
  ];

  const configuredCount = configuredItems.filter((i) => i.done).length;

  return (
    <WizardStep
      icon={<PartyPopper className="h-8 w-8" />}
      title={t("wizard.ready_title")}
      description={t("wizard.ready_desc")}
      currentStep={currentStep}
      totalSteps={totalSteps}
      onBack={onBack}
      onContinue={onLaunch}
      continueLabel={t("wizard.ready_launch")}
    >
      {/* Summary card */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-(--color-text)">{t("wizard.ready_summary")}</p>
          <span className="text-xs text-(--color-muted)">
            {t("wizard.ready_configured", { count: configuredCount, total: configuredItems.length })}
          </span>
        </div>
        <div className="space-y-2">
          {configuredItems.map((item) => (
            <div key={item.label} className="flex items-center gap-2.5">
              <div
                className={`flex h-5 w-5 items-center justify-center rounded-full ${
                  item.done
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-white/5 text-(--color-muted)"
                }`}
              >
                {item.done ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                )}
              </div>
              <span
                className={`text-xs ${
                  item.done ? "text-(--color-text)" : "text-(--color-muted)"
                }`}
              >
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Tip */}
      <div className="flex items-start gap-3 rounded-2xl border border-(--color-accent)/20 bg-(--color-accent)/5 p-4">
        <Settings className="mt-0.5 h-4 w-4 shrink-0 text-(--color-accent)" />
        <p className="text-xs leading-relaxed text-(--color-muted)">
          {t("wizard.ready_tip")}
        </p>
      </div>
    </WizardStep>
  );
}
