import { downloadAndInstallPackage } from "../../services/tauri";
import { saveProviderStatusAfterInstall, saveProviderStatusAuthError, type ProviderStatusOptions } from "../../services/providerStatusService";
import { getEffectiveProviderAuthHeaders } from "../../services/providerSearch";
import { showError, showWarning, showSuccess } from "../../components/toast/GameToast";
import type { AppSettings } from "../../types/settings";
import type { PackageGame, PackageSource } from "../../types/package";
import type { DownloadJob } from "../../types/download";
import type { SourceAvailabilityGameEntry } from "../../services/sourceAvailabilityCacheService";

export type DownloadFromSourceDeps = {
  settings: AppSettings;
  addJob: (input: {
    appId: string;
    gameTitle: string;
    providerId: string;
    providerName: string;
    fileType: DownloadJob["fileType"];
    downloadUrl?: string;
  }) => DownloadJob;
  updateJob: (jobId: string, update: {
    status?: DownloadJob["status"];
    progress?: number;
    bytesRead?: number;
    totalBytes?: number;
    error?: string;
  }) => void;
  libraryRefresh: () => Promise<void>;
  refreshInstalledScripts?: () => void;
  mountedRef: { current: boolean };
  updateSourceAvailability?: (appId: string, entry: SourceAvailabilityGameEntry) => Promise<void>;
};

/**
 * Canonical download-from-source flow.
 * Store-canonical behavior. Both Store.tsx and GameDetails.tsx use this.
 *
 * Pre-resolve `game` before calling — appId is always available.
 */
export async function downloadFromSource(
  game: PackageGame,
  source: PackageSource,
  deps: DownloadFromSourceDeps,
): Promise<{ success: boolean; error?: string }> {
  const { settings, addJob, updateJob, libraryRefresh, refreshInstalledScripts, mountedRef, updateSourceAvailability } = deps;

  if (!mountedRef.current) return { success: false, error: "unmounted" };

  if (!source.available) {
    showWarning("Selecciona una fuente disponible antes de descargar.", {
      title: "Fuente requerida",
    });
    return { success: false, error: "source-not-available" };
  }

  if (!source.downloadUrl) {
    showError("Esta fuente no tiene una URL de descarga válida.", {
      title: "URL inválida",
    });
    return { success: false, error: "no-download-url" };
  }

  if (!settings.luaPath || !settings.depotcachePath) {
    showWarning("Configura o detecta las rutas de Steam antes de instalar.", {
      title: "Rutas requeridas",
    });
    return { success: false, error: "missing-settings" };
  }

  // Check HubcapDB API key before attempting download
  const isHubcapProvider = source.providerId === "hubcapdb" || source.providerName === "HubcapDB";
  if (isHubcapProvider) {
    const hubcapSettings = settings.providers?.hubcapdb;
    if (!hubcapSettings?.apiKey) {
      console.log(`[HUBCAP][DOWNLOAD_AUTH] appid=${game.appId} provider=HubcapDB hasApiKey=false authMode=bearer action=blocked`);
      await saveProviderStatusAuthError(game.appId, source.providerId, "auth-required", "missing-api-key");
      showWarning("HubcapDB API key required.", { title: "Auth required" });
      return { success: false, error: "hubcap-missing-api-key" };
    }
  }

  // Rebuild auth headers from settings at request time
  const effectiveHeaders = source.authHeaders ?? getEffectiveProviderAuthHeaders(source.providerId, settings);
  const sourceHadHeaders = Boolean(source.authHeaders);
  const rebuiltHeaders = !sourceHadHeaders && Boolean(effectiveHeaders);
  if (isHubcapProvider) {
    console.log(
      `[HUBCAP][DOWNLOAD_AUTH] appid=${game.appId} provider=HubcapDB hasApiKey=true` +
      ` authMode=bearer sourceHadHeaders=${sourceHadHeaders} rebuiltHeaders=${rebuiltHeaders}`
    );
  }

  const job = addJob({
    appId: game.appId,
    gameTitle: game.title,
    providerId: source.providerId,
    providerName: source.providerName,
    fileType: source.fileType,
    downloadUrl: source.downloadUrl,
  });

  try {
    const result = await downloadAndInstallPackage({
      jobId: job.id,
      downloadUrl: source.downloadUrl,
      luaTarget: settings.luaPath,
      depotcacheTarget: settings.depotcachePath,
      createBackups: settings.createBackups,
      headers: effectiveHeaders,
      tempFolder: settings.tempFolder,
    });

    if (!mountedRef.current) {
      console.log(`[STORE][ASYNC_CANCELLED] appid=${game.appId} stage=after-download`);
      return { success: false, error: "unmounted" };
    }

    updateJob(job.id, {
      status: "done",
      progress: 100,
      bytesRead: result.bytes_read,
      totalBytes: result.total_bytes,
    });

    showSuccess(result.message, {
      title: "Paquete instalado",
    });

    // Refresh local installed-scripts state (Store.tsx owns this; GameDetails.tsx skips)
    if (refreshInstalledScripts) {
      refreshInstalledScripts();
    }

    // Save provider-status local snapshot after successful install
    const hubcapConfig = (settings.providers?.hubcapdb?.baseUrl && settings.providers?.hubcapdb?.apiKey)
      ? { baseUrl: settings.providers.hubcapdb.baseUrl, apiKey: settings.providers.hubcapdb.apiKey }
      : undefined;
    const providerOpts: ProviderStatusOptions = {
      luaDir: settings.luaPath || undefined,
      steamRoot: settings.steamRoot || undefined,
    };
    await saveProviderStatusAfterInstall(game.appId, source.providerId, hubcapConfig, providerOpts);

    if (!mountedRef.current) return { success: false, error: "unmounted" };

    // Auto-register newly installed Lua package with library games context
    console.log(`[LUA][REGISTER_PACKAGE] appid=${game.appId} provider=${source.providerName} title="${game.title}"`);
    libraryRefresh().then(() => {
      if (!mountedRef.current) return;
      console.log(`[LIBRARY][GAME_UPSERT] appid=${game.appId} action=refresh`);
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[LIBRARY][GAME_UPSERT] appid=${game.appId} error="${msg}"`);
    });

    return { success: true };
  } catch (error) {
    if (!mountedRef.current) {
      console.log(`[STORE][ASYNC_CANCELLED] appid=${game.appId} stage=error`);
      return { success: false, error: "unmounted" };
    }

    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "No se pudo instalar el paquete.";

    updateJob(job.id, {
      status: "failed",
      progress: 0,
      error: message,
    });

    // Parse HTTP status code from Rust error message
    const statusMatch = message.match(/Status:\s*(\d+)/);
    const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

    if (statusCode === 401) {
      console.log(`[PACKAGE][DOWNLOAD_AUTH_ERROR] appid=${game.appId} provider=${source.providerName} status=401 reason=unauthorized`);
      await saveProviderStatusAuthError(game.appId, source.providerId, "auth-required", "unauthorized");
      showError(
        source.providerName === "HubcapDB"
          ? "HubcapDB rejected the request. Check your API key."
          : `${source.providerName} rechazó la descarga. Verifica la API key o permisos. (HTTP 401)`,
        { title: "Descarga fallida" },
      );
    } else if (statusCode === 403) {
      console.log(`[PACKAGE][DOWNLOAD_AUTH_ERROR] appid=${game.appId} provider=${source.providerName} status=403 reason=forbidden`);
      await saveProviderStatusAuthError(game.appId, source.providerId, "auth-required", "forbidden");
      showError(
        "Your HubcapDB account does not have access to this package.",
        { title: "Acceso denegado" },
      );
    } else if (statusCode === 429) {
      console.log(`[PACKAGE][DOWNLOAD_RATE_LIMITED] appid=${game.appId} provider=${source.providerName} status=429`);
      await saveProviderStatusAuthError(game.appId, source.providerId, "rate-limited", "rate-limited");
      showError(
        "HubcapDB rate limit reached. Try again later.",
        { title: "Rate limited" },
      );
    } else if (updateSourceAvailability) {
      // Non-auth errors: update source availability (Store.tsx path)
      await updateSourceAvailability(game.appId, {
        appId: game.appId,
        title: game.title,
        status: "error",
        luaReady: false,
        availableSources: game.sources.filter((s) => s.available).map((s) => ({
          id: s.providerId,
          name: s.providerName,
          type: s.fileType,
          status: "ready",
          packageUrl: s.downloadUrl,
          updatedAt: Math.floor(Date.now() / 1000),
        })),
        sourceCount: game.sources.filter((s) => s.available).length,
        totalProviderCount: game.sources.length,
        updatedAt: Math.floor(Date.now() / 1000),
      });
    }

    // Show error toast for all non-auth errors (auth errors already show above)
    if (statusCode !== 401 && statusCode !== 403 && statusCode !== 429) {
      showError(message, {
        title: "Instalación fallida",
      });
    }

    return { success: false, error: message };
  }
}
