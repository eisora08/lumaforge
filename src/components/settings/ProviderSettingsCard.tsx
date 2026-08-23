import {
  KeyRound,
  Link,
  Plug,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";

import {
  ApiProviderDefinition,
  ApiProviderUserSettings,
} from "../../types/provider";
import { openExternalUrl } from "../../services/externalLinks";

type ProviderSettingsCardProps = {
  provider: ApiProviderDefinition;
  settings: ApiProviderUserSettings;
  onChange: (settings: ApiProviderUserSettings) => void;
  badgeContent?: React.ReactNode;
};

export default function ProviderSettingsCard({
  provider,
  settings,
  onChange,
  badgeContent,
}: ProviderSettingsCardProps) {

  function updateField<K extends keyof ApiProviderUserSettings>(
    key: K,
    value: ApiProviderUserSettings[K]
  ) {
    onChange
      ({
        ...settings,
        [key]: value,
      });
  }

  return (
    <div className="lf-surface rounded-2xl border p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-(--color-accent)" />

            <h3 className="font-semibold text-(--color-text)">
              {provider.name}
            </h3>
          </div>

          <p className="mt-1 text-xs leading-5 text-(--color-muted)">
            {provider.description}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {badgeContent}
          <button
            type="button"
            onClick={() => updateField("enabled", !settings.enabled)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${settings.enabled ? "bg-(--color-accent)" : "bg-white/10"
              }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${settings.enabled ? "left-6" : "left-1"
                }`}
            />
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <label className="block">
          <div className="mb-2 flex items-center gap-2">
            <Link className="h-4 w-4 text-(--color-muted)" />

            <span className="text-sm font-medium text-(--color-text)">
              Base URL
            </span>
          </div>

          <input
            value={settings.baseUrl}
            onChange={(event) => updateField("baseUrl", event.target.value)}
            placeholder={provider.baseUrl || "https://api.example.com"}
            className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
          />
        </label>

        {provider.requiresApiKey && (
          <label className="block">
            <div className="mb-2 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-(--color-muted)" />

              <span className="text-sm font-medium text-(--color-text)">
                API Key
              </span>
            </div>

            <input
              type="password"
              value={settings.apiKey}
              onChange={(event) => updateField("apiKey", event.target.value)}
              placeholder="No configurada"
              className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
            />
            {provider.apiKeyUrl && (
              <button
                type="button"
                onClick={() => openExternalUrl(provider.apiKeyUrl!)}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-(--color-accent) hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Get API Key
              </button>
            )}
          </label>
        )}

        <div>
          <div className="mb-2 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-(--color-muted)" />

            <span className="text-sm font-medium text-(--color-text)">
              Capacidades
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {provider.capabilities.map((capability) => (
              <span
                key={capability}
                className="rounded-full border border-(--surface-active-border) bg-white/5 px-3 py-1 text-xs text-(--color-muted)"
              >
                {capability}
              </span>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-(--color-text)">
            Tipos soportados
          </p>

          <div className="flex flex-wrap gap-2">
            {provider.supportedFileTypes.map((fileType) => (
              <span
                key={fileType}
                className="rounded-full bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)"
              >
                .{fileType}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
