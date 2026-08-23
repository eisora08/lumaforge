import { Database, ExternalLink, Check } from "lucide-react";
import { useSettings } from "../../context/SettingsContext";
import WizardStep from "./WizardStep";

type Props = {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
};

export default function WizardMetadata({ currentStep, totalSteps, onBack, onContinue, onSkip }: Props) {
  const { settings, updateSetting } = useSettings();

  const sgdbConfigured = !!settings.steamGridDbApiKey;
  const igdbConfigured = !!settings.igdbClientId && !!settings.igdbClientSecret;
  const rawgConfigured = !!settings.rawgApiKey;

  return (
    <WizardStep
      icon={<Database className="h-8 w-8" />}
      title="Artwork & Metadata"
      description="Enhance your library with beautiful artwork and rich game metadata from these providers."
      currentStep={currentStep}
      totalSteps={totalSteps}
      onBack={onBack}
      onContinue={onContinue}
      onSkip={onSkip}
    >
      {/* SteamGridDB */}
      <div className={`rounded-2xl border p-4 transition ${
        sgdbConfigured ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/[0.06] bg-white/[0.02]"
      }`}>
        <div className="mb-2 flex items-center gap-2">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            sgdbConfigured ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-(--color-muted)"
          }`}>
            {sgdbConfigured ? <Check className="h-4 w-4" /> : <Database className="h-4 w-4" />}
          </div>
          <p className="text-sm font-medium text-(--color-text)">SteamGridDB</p>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-(--color-muted)">Recommended</span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-(--color-muted)">
          Curated cover art, hero images, logos, and icons for your game library.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={settings.steamGridDbApiKey}
            onChange={(e) => {
              updateSetting("steamGridDbApiKey", e.target.value);
              if (e.target.value && !settings.steamGridDbArtworkEnabled) {
                updateSetting("steamGridDbArtworkEnabled", true);
              }
            }}
            placeholder="Enter SteamGridDB API key"
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-(--color-text) placeholder-(--color-muted) outline-none transition focus:border-(--color-accent)/50 focus:ring-1 focus:ring-(--color-accent)/30"
          />
        </div>
        <a
          href="https://www.steamgriddb.com/profile/api-key"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-(--color-accent) transition hover:brightness-110"
        >
          <ExternalLink className="h-3 w-3" />
          Get API key at steamgriddb.com
        </a>
      </div>

      {/* IGDB */}
      <div className={`rounded-2xl border p-4 transition ${
        igdbConfigured ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/[0.06] bg-white/[0.02]"
      }`}>
        <div className="mb-2 flex items-center gap-2">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            igdbConfigured ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-(--color-muted)"
          }`}>
            {igdbConfigured ? <Check className="h-4 w-4" /> : <Database className="h-4 w-4" />}
          </div>
          <p className="text-sm font-medium text-(--color-text)">IGDB / Twitch</p>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-(--color-muted)">Optional</span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-(--color-muted)">
          Rich game metadata — descriptions, genres, release dates, and cover art. Requires Twitch OAuth credentials.
        </p>
        <div className="space-y-2">
          <input
            type="text"
            value={settings.igdbClientId}
            onChange={(e) => updateSetting("igdbClientId", e.target.value)}
            placeholder="Twitch Client ID"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-(--color-text) placeholder-(--color-muted) outline-none transition focus:border-(--color-accent)/50 focus:ring-1 focus:ring-(--color-accent)/30"
          />
          <input
            type="password"
            value={settings.igdbClientSecret}
            onChange={(e) => updateSetting("igdbClientSecret", e.target.value)}
            placeholder="Twitch Client Secret"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-(--color-text) placeholder-(--color-muted) outline-none transition focus:border-(--color-accent)/50 focus:ring-1 focus:ring-(--color-accent)/30"
          />
        </div>
        <a
          href="https://dev.twitch.tv/console/apps"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-(--color-accent) transition hover:brightness-110"
        >
          <ExternalLink className="h-3 w-3" />
          Get credentials at dev.twitch.tv
        </a>
      </div>

      {/* RAWG */}
      <div className={`rounded-2xl border p-4 transition ${
        rawgConfigured ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/[0.06] bg-white/[0.02]"
      }`}>
        <div className="mb-2 flex items-center gap-2">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            rawgConfigured ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-(--color-muted)"
          }`}>
            {rawgConfigured ? <Check className="h-4 w-4" /> : <Database className="h-4 w-4" />}
          </div>
          <p className="text-sm font-medium text-(--color-text)">RAWG</p>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-(--color-muted)">Optional</span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-(--color-muted)">
          Background artwork and metadata enrichment for Store discovery sections.
        </p>
        <input
          type="password"
          value={settings.rawgApiKey}
          onChange={(e) => updateSetting("rawgApiKey", e.target.value)}
          placeholder="Enter RAWG API key"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-(--color-text) placeholder-(--color-muted) outline-none transition focus:border-(--color-accent)/50 focus:ring-1 focus:ring-(--color-accent)/30"
        />
        <a
          href="https://rawg.io/apitkeys"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-(--color-accent) transition hover:brightness-110"
        >
          <ExternalLink className="h-3 w-3" />
          Get API key at rawg.io
        </a>
      </div>
    </WizardStep>
  );
}
