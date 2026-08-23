import { PartyPopper, Check, Settings } from "lucide-react";
import { useSettings } from "../../context/SettingsContext";
import WizardStep from "./WizardStep";

type Props = {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  onLaunch: () => void;
};

export default function WizardReady({ currentStep, totalSteps, onBack, onLaunch }: Props) {
  const { settings } = useSettings();

  const configuredItems = [
    { label: "Theme & appearance", done: true },
    { label: "Steam detection", done: !!settings.steamRoot },
    { label: "Steam Web API key", done: !!settings.steamWebApiKey },
    { label: "HubcapDB provider", done: !!settings.providers.hubcapdb?.apiKey },
    { label: "Ryuu provider", done: !!settings.providers.ryuu?.apiKey },
    { label: "SteamGridDB artwork", done: !!settings.steamGridDbApiKey },
    { label: "IGDB metadata", done: !!(settings.igdbClientId && settings.igdbClientSecret) },
    { label: "RAWG metadata", done: !!settings.rawgApiKey },
  ];

  const configuredCount = configuredItems.filter((i) => i.done).length;

  return (
    <WizardStep
      icon={<PartyPopper className="h-8 w-8" />}
      title="You're All Set!"
      description="Here's what you configured. You can always change these in Settings later."
      currentStep={currentStep}
      totalSteps={totalSteps}
      onBack={onBack}
      onContinue={onLaunch}
      continueLabel="Launch LumaForge"
    >
      {/* Summary card */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-(--color-text)">Configuration Summary</p>
          <span className="text-xs text-(--color-muted)">
            {configuredCount}/{configuredItems.length} configured
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
          You can re-run this wizard anytime from{" "}
          <span className="font-medium text-(--color-text)">Settings → Startup & More → Run Setup Wizard</span>.
          All configuration is stored locally on your machine.
        </p>
      </div>
    </WizardStep>
  );
}
