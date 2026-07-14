import { memo, useEffect, useMemo, useRef, useState } from "react";
import { countRender, isInteractionBusy } from "../../services/perfCounters";

const DEBUG_IMG_FAIL = false;

// Truncate URL for logging while preserving the filename (last path segment).
function logUrl(url: string | undefined | null, maxLen = 120): string {
  if (!url) return "(none)";
  if (url.length <= maxLen) return url;
  const lastSlash = url.lastIndexOf("/");
  const filename = lastSlash >= 0 ? url.slice(lastSlash + 1) : url;
  const prefix = url.slice(0, Math.max(0, maxLen - filename.length - 3));
  return `${prefix}...${filename}`;
}

import {
  Download,
  Flame,
  Gamepad2,
  Link2,
  Rocket,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";

import type { PackageGame, PackageSource } from "../../types/package";
import type { SteamAppMetadata } from "../../types/gameMetadata";
import type { SteamReviewSummary } from "../../types/gameReview";
import { useSettings } from "../../context/SettingsContext";
import { useDownloadQueue } from "../../hooks/useDownloadQueue";
import { downloadAndInstallPackage } from "../../services/tauri";
import { getEffectiveProviderAuthHeaders } from "../../services/providerSearch";
import { getBestAvailableSource } from "../../utils/sourceHelpers";
import { useHoverPrefetch } from "../../hooks/useHoverPrefetch";

import {
  showError,
  showSuccess,
  showWarning,
} from "../toast/GameToast";

import { saveProviderStatusAfterInstall, saveProviderStatusAuthError, type ProviderStatusOptions } from "../../services/providerStatusService";

import StoreSourceSelectorModal from "../store/StoreSourceSelectorModal";

type StoreBadge = {
  type: string;
  label: string;
};

const BADGE_ICON_MAP: Record<string, typeof Sparkles> = {
  trending: Flame,
  "top-rated": Star,
  popular: Zap,
  recommended: Sparkles,
  new: Rocket,
  "has-sources": Link2,
};

type PackageCardProps = {
  game: PackageGame;
  storeMetadata?: SteamAppMetadata;
  reviewSummary?: SteamReviewSummary;
  badges?: StoreBadge[];
  onInstallComplete?: () => void;
  variant?: "landscape" | "poster";
  onOpenGame?: (game: PackageGame) => void;
  onDownload?: (game: PackageGame) => void;
  onOpenDetails?: (game: PackageGame) => void;
  onOpenSourceSelector?: (game: PackageGame) => void;
  onDownloadSource?: (game: PackageGame, source: PackageSource) => void;
};

/** Steam CDN fallback URLs for known image roles. */
function getSteamCdnUrls(appId: string, variant?: "landscape" | "poster"): string[] {
  const id = parseInt(appId, 10);
  if (!id || isNaN(id) || id <= 0) return [];
  const base = `https://cdn.akamai.steamstatic.com/steam/apps/${id}`;
  if (variant === "poster") {
    return [
      `${base}/library_600x900.jpg`,
      `${base}/capsule_616x353.jpg`,
      `${base}/header.jpg`,
    ];
  }
  return [
    `${base}/capsule_616x353.jpg`,
    `${base}/header.jpg`,
    `${base}/library_600x900.jpg`,
  ];
}

/** Return all candidate image URLs in priority order for fallback. */
function getBestCardImageChain(
  game: PackageGame,
  metadata?: SteamAppMetadata,
  variant?: "landscape" | "poster",
): string[] {
  const candidates = variant === "poster"
    ? [metadata?.capsule_image_v5, metadata?.capsule_image, game.imageUrl, metadata?.header_image]
    : [metadata?.header_image, game.imageUrl, metadata?.capsule_image, metadata?.capsule_image_v5];
  const metadataUrls = candidates.filter((u): u is string => typeof u === "string");
  const cdnUrls = getSteamCdnUrls(game.appId, variant);
  // Append CDN URLs as last-resort fallbacks, deduplicating against metadata URLs
  const allUrls = [...metadataUrls];
  for (const url of cdnUrls) {
    if (!allUrls.includes(url)) allUrls.push(url);
  }
  return allUrls;
}

/** Custom comparator for React.memo — compares only visible props. */
function arePackageCardPropsEqual(
  a: PackageCardProps,
  b: PackageCardProps,
): boolean {
  // Game identity (stable key)
  if (a.game.appId !== b.game.appId) return false;
  // Game display fields
  if (a.game.title !== b.game.title) return false;
  if (a.game.imageUrl !== b.game.imageUrl) return false;
  const aSources = a.game.sources.filter((s) => s.available).length;
  const bSources = b.game.sources.filter((s) => s.available).length;
  if (aSources !== bSources) return false;
  // Variant
  if (a.variant !== b.variant) return false;
  // Badges fingerprint
  const aBadges = a.badges?.map((b) => `${b.type}:${b.label}`).join(",") ?? "";
  const bBadges = b.badges?.map((b) => `${b.type}:${b.label}`).join(",") ?? "";
  if (aBadges !== bBadges) return false;
  // Handler identity (stable if callbacks are useCallback-ed)
  if (a.onInstallComplete !== b.onInstallComplete) return false;
  if (a.onOpenDetails !== b.onOpenDetails) return false;
  if (a.onOpenSourceSelector !== b.onOpenSourceSelector) return false;
  if (a.onDownload !== b.onDownload) return false;
  if (a.onOpenGame !== b.onOpenGame) return false;
  if (a.onDownloadSource !== b.onDownloadSource) return false;
  // Store metadata relevant display fields
  const aMeta = a.storeMetadata;
  const bMeta = b.storeMetadata;
  if ((aMeta === undefined) !== (bMeta === undefined)) return false;
  if (aMeta && bMeta) {
    if (aMeta.name !== bMeta.name) return false;
    if (aMeta.developer !== bMeta.developer) return false;
    if (aMeta.header_image !== bMeta.header_image) return false;
    if (aMeta.capsule_image !== bMeta.capsule_image) return false;
    if (aMeta.capsule_image_v5 !== bMeta.capsule_image_v5) return false;
    const aPlats = aMeta.platforms?.slice().sort().join(",") ?? "";
    const bPlats = bMeta.platforms?.slice().sort().join(",") ?? "";
    if (aPlats !== bPlats) return false;
  }
  // Review summary — only check if reviewSummary is fully undefined vs present
  // (the component doesn't currently render reviewSummary fields, so skip deep compare)
  return true;
}

function getStoreTitle(game: PackageGame, metadata?: SteamAppMetadata) {
  return metadata?.name || game.title;
}

function getStoreDeveloper(game: PackageGame, metadata?: SteamAppMetadata) {
  return metadata?.developer || game.developer || "Developer unknown";
}

function CardImage({
  src,
  alt,
  objectClass,
  onError,
}: {
  src: string;
  alt: string;
  objectClass: string;
  onError: () => void;
}) {
  return (
    <img
      src={src}
      alt={alt}
      className={`h-full w-full transition duration-500 ${objectClass}`}
      loading="lazy"
      onError={onError}
    />
  );
}

function PackageCardRaw({
  game,
  storeMetadata,
  badges,
  onInstallComplete,
  variant = "landscape",
  onOpenGame,
  onDownload,
  onOpenDetails,
  onOpenSourceSelector,
  onDownloadSource,
}: PackageCardProps) {
  countRender("PackageCard");
  const { settings } = useSettings();
  const { addJob, updateJob } = useDownloadQueue();

  const [sourceSelectorOpen, setSourceSelectorOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageFallbackIndex, setImageFallbackIndex] = useState(0);
  const { onMouseEnter, onMouseLeave } = useHoverPrefetch(game.appId);

  const _mountedRef = useRef(true);
  useEffect(() => {
    _mountedRef.current = true;
    return () => { _mountedRef.current = false; };
  }, []);

  const availableSources = game.sources.filter((source) => source.available);
  const bestSource = useMemo(() => getBestAvailableSource(game), [game]);

  const displayTitle = getStoreTitle(game, storeMetadata);
  const displayDeveloper = getStoreDeveloper(game, storeMetadata);
  const imageFallbackChain = useMemo(
    () => getBestCardImageChain(game, storeMetadata, variant),
    [game, storeMetadata, variant],
  );
  const displayImageUrl: string | undefined = imageFallbackChain[imageFallbackIndex];
  const hasMoreFallbacks = imageFallbackIndex + 1 < imageFallbackChain.length;

  const hasLuaReady = availableSources.length > 0;

  function handleOpenDetails(event?: React.MouseEvent) {
    event?.stopPropagation();

    if (onOpenDetails) {
      onOpenDetails(game);
    } else if (onOpenGame) {
      onOpenGame(game);
    }
  }

  function handleSourceButton(event?: React.MouseEvent) {
    event?.stopPropagation();

    if (onOpenSourceSelector) {
      onOpenSourceSelector(game);
    } else {
      setSourceSelectorOpen(true);
    }
  }

  function handleDownloadAction(event?: React.MouseEvent) {
    event?.stopPropagation();

    if (onDownload) {
      onDownload(game);
      return;
    }

    const source = bestSource;

    if (!source || !source.available) {
      showWarning("No hay fuentes disponibles para este juego.", {
        title: "Sin fuentes",
      });
      return;
    }

    internalDownload(source);
  }

  async function internalDownload(source: PackageSource) {
    if (!_mountedRef.current) return;

    if (!source.downloadUrl) {
      showError("Esta fuente no tiene una URL de descarga válida.", {
        title: "URL inválida",
      });
      return;
    }

    if (!settings.luaPath || !settings.depotcachePath) {
      showWarning("Configura o detecta las rutas de Steam antes de instalar.", {
        title: "Rutas requeridas",
      });
      return;
    }

    // Check HubcapDB API key before attempting download
    const hubcapId = "hubcapdb";
    const isHubcapProvider = source.providerId === hubcapId || source.providerName === "HubcapDB";
    if (isHubcapProvider) {
      const hubcapSettings = settings.providers?.hubcapdb;
      if (!hubcapSettings?.apiKey) {
        console.log(`[HUBCAP][DOWNLOAD_AUTH] appid=${game.appId} provider=HubcapDB hasApiKey=false authMode=bearer action=blocked`);
        await saveProviderStatusAuthError(game.appId, source.providerId, "auth-required", "missing-api-key");
        showWarning("HubcapDB API key required.", { title: "Auth required" });
        return;
      }
    }

    // Rebuild auth headers from settings at request time (never from cache — overlay strips authHeaders)
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
      gameTitle: displayTitle,
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

      if (!_mountedRef.current) {
        console.log(`[CARD][ASYNC_CANCELLED] appid=${game.appId} stage=after-download`);
        return;
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

      const hubcapConfig = (settings.providers?.hubcapdb?.baseUrl && settings.providers?.hubcapdb?.apiKey)
        ? { baseUrl: settings.providers.hubcapdb.baseUrl, apiKey: settings.providers.hubcapdb.apiKey }
        : undefined;
      const providerOpts: ProviderStatusOptions = {
        luaDir: settings.luaPath || undefined,
        steamRoot: settings.steamRoot || undefined,
      };
      await saveProviderStatusAfterInstall(game.appId, source.providerId, hubcapConfig, providerOpts);

      console.log(`[LUA][INSTALL_COMPLETE] appid=${game.appId} provider=${source.providerName} title="${displayTitle}"`);
      onInstallComplete?.();
    } catch (error) {
      if (!_mountedRef.current) {
        console.log(`[CARD][ASYNC_CANCELLED] appid=${game.appId} stage=error`);
        return;
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

      const statusMatch = message.match(/Status:\s*(\d+)/);
      const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

      if (statusCode === 401) {
        console.log(`[HUBCAP][DOWNLOAD_AUTH_ERROR] appid=${game.appId} provider=${source.providerName} status=401 reason=unauthorized`);
        await saveProviderStatusAuthError(game.appId, source.providerId, "auth-required", "unauthorized");
        showError(
          source.providerName === "HubcapDB"
            ? "HubcapDB rejected the request. Check your API key."
            : `${source.providerName} rechazó la descarga. Verifica la API key o permisos. (HTTP 401)`,
          { title: "Descarga fallida" }
        );
      } else if (statusCode === 403) {
        console.log(`[HUBCAP][DOWNLOAD_AUTH_ERROR] appid=${game.appId} provider=${source.providerName} status=403 reason=forbidden`);
        await saveProviderStatusAuthError(game.appId, source.providerId, "auth-required", "forbidden");
        showError(
          "Your HubcapDB account does not have access to this package.",
          { title: "Acceso denegado" }
        );
      } else if (statusCode === 429) {
        console.log(`[HUBCAP][DOWNLOAD_AUTH_ERROR] appid=${game.appId} provider=${source.providerName} status=429 reason=rate-limited`);
        await saveProviderStatusAuthError(game.appId, source.providerId, "rate-limited", "rate-limited");
        showError(
          "HubcapDB rate limit reached. Try again later.",
          { title: "Rate limited" }
        );
      } else {
        console.log(`[CARD][PROVIDER_DOWNLOAD_FAILED] appid=${game.appId} provider=${source.providerName} status=${statusCode} title="${displayTitle}"`);
        showError(message, {
          title: "Instalación fallida",
        });
      }
    }
  }

  function handleSourceDownload(source: PackageSource) {
    if (onDownloadSource) {
      onDownloadSource(game, source);
    } else {
      internalDownload(source);
    }
  }

  const actionButtons = (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={handleOpenDetails}
        className="w-32 cursor-pointer rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/15"
      >
        Details
      </button>

      {hasLuaReady && (
        <button
          type="button"
          onClick={handleDownloadAction}
          className="flex w-32 cursor-pointer items-center justify-center gap-1 rounded-xl bg-(--color-accent) px-3 py-2 text-xs font-bold text-black transition hover:opacity-90"
        >
          <Download className="h-3 w-3" />
          Download
        </button>
      )}

      <button
        type="button"
        onClick={handleSourceButton}
        className="w-32 cursor-pointer rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-medium text-white/75 transition hover:bg-white/15 hover:text-white disabled:cursor-not-allowed"
        disabled={game.sources.length === 0}
      >
        Source
      </button>
    </div>
  );

  if (variant === "poster") {
    return (
      <>
        <article
          role="button"
          tabIndex={0}
          onClick={handleOpenDetails}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              handleOpenDetails();
            }
          }}
          className="lf-store-card group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-(--surface-active-border) bg-white/5 transition hover:bg-white/[0.04] hover:border-(--color-accent)/40 lf-press-effect"
        >
          <div className="relative w-full shrink-0 overflow-hidden">
            {displayImageUrl && !imageFailed ? (
              <CardImage
                src={displayImageUrl}
                alt={displayTitle}
                objectClass="object-cover"
                onError={() => {
                  // Phase 8: Skip fallback chain during active interaction (scroll/click)
                  if (isInteractionBusy()) {
                    if (_mountedRef.current) setImageFailed(true);
                    return;
                  }
                  if (!_mountedRef.current) {
                    if (DEBUG_IMG_FAIL) console.log(`[PACKAGE_CARD][FALLBACK_CANCEL] reason=unmounted`);
                    return;
                  }
                  if (DEBUG_IMG_FAIL) console.log(`[IMG][FAIL] appid=${game.appId} source=${logUrl(displayImageUrl)}`);
                  if (hasMoreFallbacks) {
                    const nextIdx = imageFallbackIndex + 1;
                    const nextUrl = imageFallbackChain[nextIdx];
                    if (DEBUG_IMG_FAIL) console.log(`[IMG][FALLBACK_NEXT] appid=${game.appId} nextSource=${logUrl(nextUrl)}`);
                    setImageFallbackIndex(nextIdx);
                  } else {
                    setImageFailed(true);
                  }
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-white/5">
                <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
              </div>
            )}

            {badges && badges.length > 0 && (
              <div className="pointer-events-none absolute left-2 top-2 z-10 flex gap-1.5">
                {badges.map((badge) => {
                  const Icon = BADGE_ICON_MAP[badge.type];
                  return (
                    <span
                      key={badge.type}
                      className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm"
                    >
                      {Icon && <Icon className="h-3 w-3" />}
                      {badge.label}
                    </span>
                  );
                })}
              </div>
            )}

            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/75 opacity-0 transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
              {actionButtons}
            </div>
          </div>

          <div className="flex min-h-[60px] flex-col justify-center p-2.5">
            <h3 className="lf-card-title line-clamp-2 text-sm font-semibold leading-snug text-(--color-text)">
              {displayTitle}
            </h3>

            {displayDeveloper && (
              <p className="mt-0.5 line-clamp-1 text-[11px] text-(--color-muted)">
                {displayDeveloper}
              </p>
            )}
          </div>
        </article>

        {/* Phase 11: Only render StoreSourceSelectorModal when open AND
            parent doesn't provide onOpenSourceSelector (meaning Store.tsx
            already handles modals at page level). This avoids mounting
            hundreds of closed modal components per card. */}
        {!onOpenSourceSelector && sourceSelectorOpen && (
          <StoreSourceSelectorModal
            open={sourceSelectorOpen}
            game={game}
            selectedSource={bestSource}
            onClose={() => setSourceSelectorOpen(false)}
            onDownloadSource={handleSourceDownload}
            onOpenDetails={onOpenDetails || onOpenGame}
          />
        )}
      </>
    );
  }

  return (
    <>
      <article
        role="button"
        tabIndex={0}
        onClick={handleOpenDetails}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            handleOpenDetails();
          }
        }}
        className="lf-store-card group relative aspect-video cursor-pointer overflow-hidden rounded-2xl border border-(--surface-active-border) bg-white/5 transition hover:bg-white/[0.04] hover:border-(--color-accent)/40 lf-press-effect"
      >
        {displayImageUrl && !imageFailed ? (
          <CardImage
            src={displayImageUrl}
            alt={displayTitle}
            objectClass="object-cover"
            onError={() => {
              // Phase 8: Skip fallback chain during active interaction (scroll/click)
              if (isInteractionBusy()) {
                if (_mountedRef.current) setImageFailed(true);
                return;
              }
              if (!_mountedRef.current) {
                if (DEBUG_IMG_FAIL) console.log(`[PACKAGE_CARD][FALLBACK_CANCEL] reason=unmounted`);
                return;
              }
              if (DEBUG_IMG_FAIL) console.log(`[IMG][FAIL] appid=${game.appId} source=${logUrl(displayImageUrl)}`);
              if (hasMoreFallbacks) {
                const nextIdx = imageFallbackIndex + 1;
                const nextUrl = imageFallbackChain[nextIdx];
                if (DEBUG_IMG_FAIL) console.log(`[IMG][FALLBACK_NEXT] appid=${game.appId} nextSource=${logUrl(nextUrl)}`);
                setImageFallbackIndex(nextIdx);
              } else {
                setImageFailed(true);
              }
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/5">
            <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
          </div>
        )}

        {badges && badges.length > 0 && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 flex gap-1.5">
            {badges.map((badge) => {
              const Icon = BADGE_ICON_MAP[badge.type];
              return (
                <span
                  key={badge.type}
                  className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm"
                >
                  {Icon && <Icon className="h-3 w-3" />}
                  {badge.label}
                </span>
              );
            })}
          </div>
        )}

        <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/20 to-transparent" />

        <div className="absolute bottom-0 left-0 right-0 z-10 p-4">
          <h3 className="lf-card-title line-clamp-1 text-lg font-black text-white drop-shadow">
            {displayTitle}
          </h3>
        </div>

        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/82 opacity-0 transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
          {actionButtons}
        </div>
      </article>

      {/* Phase 11: Only render StoreSourceSelectorModal when open AND parent
          doesn't handle source selector at page level. */}
      {!onOpenSourceSelector && sourceSelectorOpen && (
        <StoreSourceSelectorModal
          open={sourceSelectorOpen}
          game={game}
          selectedSource={bestSource}
          onClose={() => setSourceSelectorOpen(false)}
          onDownloadSource={handleSourceDownload}
          onOpenDetails={onOpenDetails || onOpenGame}
        />
      )}
    </>
  );
}

export default memo(PackageCardRaw, arePackageCardPropsEqual);
