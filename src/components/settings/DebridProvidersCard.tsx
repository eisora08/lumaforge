import { Cloud, ExternalLink, RefreshCw, Loader2, CheckCircle2, AlertCircle, Trash2, Plus, List } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import type { DebridProviderConfig } from "../../types/settings";
import { checkProviderStatus } from "../../services/debridProviderService";
import { getHydraSources, addHydraSource, removeHydraSource, toggleHydraSource } from "../../services/hydraSourceService";
import type { HydraSourceConfig } from "../../types/hydraSource";
import { showSuccess, showError } from "../toast/GameToast";

const PROVIDERS = [
  { id: "torbox" as const, label: "TorBox", color: "text-blue-400", docUrl: "https://torbox.app/settings" },
  { id: "realdebrid" as const, label: "Real-Debrid", color: "text-red-400", docUrl: "https://real-debrid.com/apitoken" },
  { id: "alldebrid" as const, label: "AllDebrid", color: "text-amber-400", docUrl: "https://alldebrid.com/apikeys" },
  { id: "premiumize" as const, label: "Premiumize", color: "text-emerald-400", docUrl: "https://www.premiumize.me/account" },
];

type ProviderStatusState = Record<string, "idle" | "testing" | "valid" | "invalid" | "error">;

type DebridProvidersCardProps = {
  config: DebridProviderConfig;
  onChange: (patch: { debridProviders?: DebridProviderConfig }) => void;
};

export default function DebridProvidersCard({ config, onChange }: DebridProvidersCardProps) {
  const [statuses, setStatuses] = useState<ProviderStatusState>({});
  const [statusMessages, setStatusMessages] = useState<Record<string, string>>({});
  const [hydraSources, setHydraSources] = useState<HydraSourceConfig[]>([]);
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [newSourceName, setNewSourceName] = useState("");
  const [addingSource, setAddingSource] = useState(false);

  // Load Hydra sources on mount
  useEffect(() => {
    getHydraSources().then(setHydraSources).catch(() => {});
  }, []);

  const handleTestProvider = useCallback(async (providerId: string, apiKey: string) => {
    if (!apiKey.trim()) {
      setStatuses((prev) => ({ ...prev, [providerId]: "error" }));
      setStatusMessages((prev) => ({ ...prev, [providerId]: "No API key configured" }));
      return;
    }

    setStatuses((prev) => ({ ...prev, [providerId]: "testing" }));
    setStatusMessages((prev) => ({ ...prev, [providerId]: "" }));

    const result = await checkProviderStatus(providerId as any, apiKey);

    if (result.valid) {
      setStatuses((prev) => ({ ...prev, [providerId]: "valid" }));
      setStatusMessages((prev) => ({
        ...prev,
        [providerId]: `${result.accountName || result.accountEmail || "Connected"} · ${result.premiumUntil ? "Premium" : "OK"}`,
      }));
    } else {
      setStatuses((prev) => ({ ...prev, [providerId]: "invalid" }));
      setStatusMessages((prev) => ({
        ...prev,
        [providerId]: result.error || "Invalid API key",
      }));
    }

    setTimeout(() => {
      setStatuses((prev) => ({ ...prev, [providerId]: "idle" }));
    }, 5000);
  }, []);

  const handleAddHydraSource = useCallback(async () => {
    if (!newSourceUrl.trim()) return;

    setAddingSource(true);
    try {
      const name = newSourceName.trim() || newSourceUrl.trim();
      await addHydraSource(name, newSourceUrl.trim());
      showSuccess("Hydra source added successfully");
      setNewSourceUrl("");
      setNewSourceName("");
      const sources = await getHydraSources(true);
      setHydraSources(sources);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to add source");
    } finally {
      setAddingSource(false);
    }
  }, [newSourceUrl, newSourceName]);

  const handleRemoveSource = useCallback(async (id: string) => {
    try {
      await removeHydraSource(id);
      const sources = await getHydraSources(true);
      setHydraSources(sources);
      showSuccess("Hydra source removed");
    } catch (err) {
      showError("Failed to remove source");
    }
  }, []);

  const handleToggleSource = useCallback(async (id: string, enabled: boolean) => {
    try {
      await toggleHydraSource(id, enabled);
      const sources = await getHydraSources(true);
      setHydraSources(sources);
    } catch (err) {
      showError("Failed to toggle source");
    }
  }, []);

  const handleKeyChange = useCallback(
    (providerId: string, value: string) => {
      onChange({
        debridProviders: { ...config, [providerId === "torbox" ? "torboxApiKey" : providerId === "realdebrid" ? "realDebridApiKey" : providerId === "alldebrid" ? "allDebridApiKey" : "premiumizeApiKey"]: value },
      });
    },
    [config, onChange],
  );

  const getApiKey = (providerId: string): string => {
    switch (providerId) {
      case "torbox": return config.torboxApiKey;
      case "realdebrid": return config.realDebridApiKey;
      case "alldebrid": return config.allDebridApiKey;
      case "premiumize": return config.premiumizeApiKey;
      default: return "";
    }
  };

  return (
    <div className="lf-surface rounded-2xl border p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-cyan-400" />
            <h3 className="font-semibold text-(--color-text)">Debrid Providers</h3>
          </div>
          <p className="mt-1 text-xs leading-5 text-(--color-muted)">
            API keys for debrid services. Configure at least one to download repacks.
          </p>
        </div>
      </div>

      {/* Per-provider API keys */}
      <div className="space-y-4">
        {PROVIDERS.map((provider) => {
          const apiKey = getApiKey(provider.id);
          const status = statuses[provider.id] || "idle";
          const message = statusMessages[provider.id] || "";

          return (
            <div key={provider.id} className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className={`text-sm font-medium ${provider.color}`}>{provider.label}</span>
                {apiKey.trim() && (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
                    Configured
                  </span>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => handleKeyChange(provider.id, e.target.value)}
                  placeholder={`${provider.label} API Key`}
                  className="h-10 flex-1 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-cyan-400"
                />
                <button
                  type="button"
                  onClick={() => handleTestProvider(provider.id, apiKey)}
                  disabled={status === "testing"}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-(--surface-active-border) bg-white/5 text-(--color-muted) transition hover:bg-white/10 disabled:opacity-50"
                  title={`Test ${provider.label} connection`}
                >
                  {status === "testing" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : status === "valid" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : status === "invalid" ? (
                    <AlertCircle className="h-4 w-4 text-red-400" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </button>
              </div>

              {message && (
                <p
                  className={`mt-1 text-[10px] ${
                    status === "valid" ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {message}
                </p>
              )}

              <a
                href={provider.docUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[10px] text-(--color-muted) underline transition hover:text-(--color-accent)"
              >
                <ExternalLink className="h-3 w-3" />
                Get API key
              </a>
            </div>
          );
        })}
      </div>

      {/* Hydra Sources section */}
      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <List className="h-4 w-4 text-cyan-400" />
          <h4 className="text-sm font-medium text-(--color-text)">Hydra Sources</h4>
        </div>

        <div className="mb-3 flex gap-2">
          <input
            value={newSourceName}
            onChange={(e) => setNewSourceName(e.target.value)}
            placeholder="Source name (optional)"
            className="h-10 w-1/3 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-cyan-400"
          />
          <input
            value={newSourceUrl}
            onChange={(e) => setNewSourceUrl(e.target.value)}
            placeholder="https://example.com/hydra-repacks.json"
            className="h-10 flex-1 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-cyan-400"
          />
          <button
            type="button"
            onClick={handleAddHydraSource}
            disabled={addingSource || !newSourceUrl.trim()}
            className="flex h-10 items-center gap-2 rounded-xl bg-cyan-500/20 px-4 text-sm font-medium text-cyan-400 transition hover:bg-cyan-500/30 disabled:opacity-50"
          >
            {addingSource ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add
          </button>
        </div>

        {hydraSources.length === 0 ? (
          <p className="text-xs text-(--color-muted)">
            No Hydra sources configured. Add a URL above to populate the repack catalog.
          </p>
        ) : (
          <div className="space-y-2">
            {hydraSources.map((source) => (
              <div
                key={source.id}
                className="flex items-center justify-between rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleToggleSource(source.id, !source.enabled)}
                    className={`h-5 w-5 rounded-md border ${
                      source.enabled
                        ? "border-cyan-400 bg-cyan-500/20"
                        : "border-(--surface-active-border) bg-white/5"
                    }`}
                  >
                    {source.enabled && (
                      <CheckCircle2 className="h-4 w-4 text-cyan-400" />
                    )}
                  </button>
                  <div>
                    <p className="text-sm font-medium text-(--color-text)">
                      {source.name}
                    </p>
                    <p className="text-[10px] text-(--color-muted) truncate max-w-[400px]">
                      {source.url}
                    </p>
                    {source.lastError && (
                      <p className="text-[10px] text-red-400">{source.lastError}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {source.gameCount !== undefined && (
                    <span className="text-xs text-(--color-muted)">
                      {source.gameCount} games
                    </span>
                  )}
                  {source.lastFetchedAt && (
                    <span className="text-[10px] text-(--color-muted)">
                      {new Date(source.lastFetchedAt).toLocaleDateString()}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveSource(source.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-red-500/10 hover:text-red-400"
                    title="Remove source"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-(--color-muted)">
        <ExternalLink className="h-3 w-3" />
        <a
          href="https://hydra.luffy.pp.ua"
          target="_blank"
          rel="noopener noreferrer"
          className="underline transition hover:text-(--color-accent)"
        >
          Hydra Debrid Documentation
        </a>
        <span className="text-(--surface-active-border)">·</span>
        <a
          href="https://github.com/OpenByteDev/hydra"
          target="_blank"
          rel="noopener noreferrer"
          className="underline transition hover:text-(--color-accent)"
        >
          Hydra on GitHub
        </a>
      </div>
    </div>
  );
}
