import { Cloud, ExternalLink, RefreshCw, Loader2, CheckCircle2, AlertCircle, Trash2, Plus, List, FileText, Download, Rss } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import type { DebridProviderConfig } from "../../types/settings";
import { checkProviderStatus } from "../../services/debridProviderService";
import { getHydraSources, addHydraSource, removeHydraSource, toggleHydraSource, importRepackFeed, fetchAndImportHydraSource, refreshAllHydraSources, getImportedFeeds, removeImportedFeed } from "../../services/hydraSourceService";
import { refreshDebridGames } from "../../services/debridGameStore";
import type { HydraSourceConfig, ImportedFeedSummary } from "../../types/hydraSource";
import { showSuccess, showError } from "../toast/GameToast";
import { openExternalUrl } from "../../services/externalLinks";

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
  const [feedContents, setFeedContents] = useState("");
  const [importingFeed, setImportingFeed] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [importedFeeds, setImportedFeeds] = useState<ImportedFeedSummary[]>([]);
  const [confirmingDeleteFeedName, setConfirmingDeleteFeedName] = useState<string | null>(null);

  const loadImportedFeeds = useCallback(async () => {
    try {
      const feeds = await getImportedFeeds(true);
      setImportedFeeds(feeds);
    } catch (err) {
      setImportedFeeds([]);
    }
  }, []);

  // Load Hydra sources on mount
  useEffect(() => {
    getHydraSources().then(setHydraSources).catch(() => {});
    loadImportedFeeds();
  }, [loadImportedFeeds]);

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
      setConfirmingDeleteId(null);
      const sources = await getHydraSources(true);
      setHydraSources(sources);
      showSuccess("Hydra source removed");
      await refreshDebridGames();
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

  const handleRefreshSource = useCallback(async (source: HydraSourceConfig) => {
    setRefreshingId(source.id);
    try {
      const result = await fetchAndImportHydraSource(source.id, source.url, source.name);
      showSuccess(
        `Source refreshed: ${result.importedCount} nuevos, ${result.updatedCount} actualizados (${result.totalCount} total)`,
      );
      const sources = await getHydraSources(true);
      setHydraSources(sources);
      await refreshDebridGames();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to refresh source");
      const sources = await getHydraSources(true);
      setHydraSources(sources);
    } finally {
      setRefreshingId(null);
    }
  }, []);

  const handleRefreshAll = useCallback(async () => {
    setRefreshingAll(true);
    try {
      const results = await refreshAllHydraSources();
      const imported = results.reduce((sum, r) => sum + (r.importedCount || 0), 0);
      const updated = results.reduce((sum, r) => sum + (r.updatedCount || 0), 0);
      showSuccess(`Refresh all: ${imported} nuevos, ${updated} actualizados (${results.length} fuentes)`);
      const sources = await getHydraSources(true);
      setHydraSources(sources);
      await refreshDebridGames();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to refresh sources");
    } finally {
      setRefreshingAll(false);
    }
  }, []);

  const handleImportFeed = useCallback(async () => {
    if (!feedContents.trim()) return;

    setImportingFeed(true);
    try {
      const result = await importRepackFeed(feedContents.trim());
      showSuccess(
        `Feed importado: ${result.importedCount} nuevos, ${result.updatedCount} actualizados`,
      );
      setFeedContents("");
      await refreshDebridGames();
      await loadImportedFeeds();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to import feed");
    } finally {
      setImportingFeed(false);
    }
  }, [feedContents, loadImportedFeeds]);

  const handleRemoveFeed = useCallback(
    async (name: string) => {
      try {
        await removeImportedFeed(name);
        setConfirmingDeleteFeedName(null);
        showSuccess("Feed importado eliminado");
        await loadImportedFeeds();
        await refreshDebridGames();
      } catch (err) {
        showError(err instanceof Error ? err.message : "Failed to remove feed");
      }
    },
    [loadImportedFeeds],
  );

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

              <button
                type="button"
                onClick={() => openExternalUrl(provider.docUrl)}
                className="mt-1 inline-flex items-center gap-1 text-[10px] text-(--color-muted) underline transition hover:text-(--color-accent)"
              >
                <ExternalLink className="h-3 w-3" />
                Get API key
              </button>
            </div>
          );
        })}
      </div>

      {/* Hydra Sources section */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <List className="h-4 w-4 text-cyan-400" />
            <h4 className="text-sm font-medium text-(--color-text)">Hydra Sources</h4>
          </div>
          {hydraSources.length > 0 && (
            <button
              type="button"
              onClick={handleRefreshAll}
              disabled={refreshingAll}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:opacity-50"
              title="Fetch new content from all enabled sources"
            >
              {refreshingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Refresh all
            </button>
          )}
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
          <div className="space-y-3">
            {hydraSources.map((source) => {
              const isRefreshing = refreshingId === source.id;
              const isConfirmingDelete = confirmingDeleteId === source.id;

              return (
                <div
                  key={source.id}
                  className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => handleToggleSource(source.id, !source.enabled)}
                        className={`mt-0.5 h-5 w-5 shrink-0 rounded-md border ${
                          source.enabled
                            ? "border-cyan-400 bg-cyan-500/20"
                            : "border-(--surface-active-border) bg-white/5"
                        }`}
                        title={source.enabled ? "Disable source" : "Enable source"}
                      >
                        {source.enabled && <CheckCircle2 className="h-4 w-4 text-cyan-400" />}
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-(--color-text)">{source.name}</p>
                          {!source.enabled && (
                            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-(--color-muted)">
                              Disabled
                            </span>
                          )}
                        </div>
                        <p className="truncate text-[10px] text-(--color-muted) max-w-[360px]">
                          {source.url}
                        </p>
                        {source.lastError && (
                          <p className="text-[10px] text-red-400">{source.lastError}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {source.gameCount !== undefined && (
                        <span className="text-xs text-(--color-muted)">{source.gameCount} games</span>
                      )}
                      {source.lastFetchedAt && (
                        <span className="text-[10px] text-(--color-muted)">
                          {new Date(source.lastFetchedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-2 border-t border-(--surface-active-border)/50 pt-3">
                    <button
                      type="button"
                      onClick={() => handleRefreshSource(source)}
                      disabled={isRefreshing}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:opacity-50"
                      title="Fetch new content from this source"
                    >
                      {isRefreshing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Actualizar
                    </button>
                    {isConfirmingDelete ? (
                      <button
                        type="button"
                        onClick={() => handleRemoveSource(source.id)}
                        className="flex h-8 items-center gap-1.5 rounded-lg bg-red-500/15 px-3 text-xs font-medium text-red-400 transition hover:bg-red-500/25"
                      >
                        <AlertCircle className="h-3.5 w-3.5" />
                        ¿Eliminar?
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteId(source.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-red-500/10 hover:text-red-400"
                        title="Remove source"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Imported feeds section */}
      <div className="mt-6">
        <div className="mb-1 flex items-center gap-2">
          <Rss className="h-4 w-4 text-cyan-400" />
          <h4 className="text-sm font-medium text-(--color-text)">Feeds importados</h4>
        </div>
        <p className="mb-3 text-xs leading-5 text-(--color-muted)">
          Feeds pegados con "Importar feed". No tienen URL de refresco; bórralos para
          quitar sus juegos del catálogo.
        </p>

        {importedFeeds.length === 0 ? (
          <p className="text-xs text-(--color-muted)">
            No hay feeds importados. Usa "Importar feed repack" abajo para pegar un feed JSON.
          </p>
        ) : (
          <div className="space-y-3">
            {importedFeeds.map((feed) => {
              const isConfirmingDelete = confirmingDeleteFeedName === feed.name;

              return (
                <div
                  key={feed.name}
                  className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-(--color-text)">{feed.name}</p>
                      {feed.lastUpdated && (
                        <p className="text-[10px] text-(--color-muted)">
                          Actualizado: {new Date(feed.lastUpdated).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-(--color-muted)">
                        {feed.gameCount} games
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-2 border-t border-(--surface-active-border)/50 pt-3">
                    {isConfirmingDelete ? (
                      <button
                        type="button"
                        onClick={() => handleRemoveFeed(feed.name)}
                        className="flex h-8 items-center gap-1.5 rounded-lg bg-red-500/15 px-3 text-xs font-medium text-red-400 transition hover:bg-red-500/25"
                      >
                        <AlertCircle className="h-3.5 w-3.5" />
                        ¿Eliminar?
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteFeedName(feed.name)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-red-500/10 hover:text-red-400"
                        title="Remove imported feed"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <FileText className="h-4 w-4 text-cyan-400" />
          <h4 className="text-sm font-medium text-(--color-text)">Importar feed repack</h4>
        </div>
        <p className="mb-2 text-xs leading-5 text-(--color-muted)">
          Pega el JSON scrapeado (fitgirl/steamrip) o un artefacto Hydra. Los enlaces de
          descarga del feed se conservan intactos para el instalador Debrid.
        </p>
        <textarea
          value={feedContents}
          onChange={(e) => setFeedContents(e.target.value)}
          placeholder='{"name":"SteamRip","downloads":[{"title":"...","fileSize":"33 GB","uris":["https://gofile.io/d/..."]}]}'
          rows={4}
          className="w-full resize-y rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 font-mono text-xs text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-cyan-400"
        />
        <button
          type="button"
          onClick={handleImportFeed}
          disabled={importingFeed || !feedContents.trim()}
          className="mt-2 flex h-10 items-center gap-2 rounded-xl bg-cyan-500/20 px-4 text-sm font-medium text-cyan-400 transition hover:bg-cyan-500/30 disabled:opacity-50"
        >
          {importingFeed ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Importar
        </button>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-(--color-muted)">
        <ExternalLink className="h-3 w-3" />
        <button
          type="button"
          onClick={() => openExternalUrl("https://library.hydra.wiki/sources/")}
          className="underline transition hover:text-(--color-accent)"
        >
          Get Hydra Source
        </button>
      </div>
    </div>
  );
}
