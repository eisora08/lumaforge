import { Zap, ExternalLink, Check } from "lucide-react";
import { useSettings } from "../../context/SettingsContext";
import type { ApiProviderId } from "../../types/provider";
import WizardStep from "./WizardStep";

type Props = {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
};

const PROVIDERS = [
  {
    id: "hubcapdb" as const,
    name: "HubcapDB",
    description: "Primary package source for manifests, Lua files, and game packages.",
    apiKeyUrl: "https://hubcapmanifest.com/api-keys/stats",
    subKey: "hubcapdb" as ApiProviderId,
  },
  {
    id: "ryuu" as const,
    name: "Ryuu",
    description: "Alternative package source with Lua scripts and ZIP downloads.",
    apiKeyUrl: "https://generator.ryuu.lol/api",
    subKey: "ryuu" as ApiProviderId,
  },
];

export default function WizardProviders({ currentStep, totalSteps, onBack, onContinue, onSkip }: Props) {
  const { settings, updateSetting } = useSettings();

  return (
    <WizardStep
      icon={<Zap className="h-8 w-8" />}
      title="Package Providers"
      description="Add API keys for game package sources. These power game downloads and Lua scripts."
      currentStep={currentStep}
      totalSteps={totalSteps}
      onBack={onBack}
      onContinue={onContinue}
      onSkip={onSkip}
    >
      {PROVIDERS.map((provider) => {
        const apiKey = settings.providers[provider.subKey]?.apiKey ?? "";
        const hasKey = apiKey.length > 0;

        return (
          <div
            key={provider.id}
            className={`rounded-2xl border p-4 transition ${
              hasKey
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-white/[0.06] bg-white/[0.02]"
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    hasKey ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-(--color-muted)"
                  }`}
                >
                  {hasKey ? <Check className="h-5 w-5" /> : <Zap className="h-5 w-5" />}
                </div>
                <div>
                  <p className="text-sm font-medium text-(--color-text)">{provider.name}</p>
                  {hasKey && (
                    <p className="text-[10px] text-emerald-400">Configured</p>
                  )}
                </div>
              </div>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-(--color-muted)">
              {provider.description}
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) =>
                  updateSetting("providers", {
                    ...settings.providers,
                    [provider.subKey]: {
                      ...settings.providers[provider.subKey],
                      apiKey: e.target.value,
                    },
                  })
                }
                placeholder={`Enter ${provider.name} API key`}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-(--color-text) placeholder-(--color-muted) outline-none transition focus:border-(--color-accent)/50 focus:ring-1 focus:ring-(--color-accent)/30"
              />
            </div>
            <a
              href={provider.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-(--color-accent) transition hover:brightness-110"
            >
              <ExternalLink className="h-3 w-3" />
              Get API key at {provider.name}
            </a>
          </div>
        );
      })}
    </WizardStep>
  );
}
