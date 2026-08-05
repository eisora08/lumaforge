import { useState, useEffect } from "react";
import { Lock, Trophy } from "lucide-react";
import AsyncImage from "./AsyncImage";

const ENABLE_VERBOSE_LOGS = false;

function logVerbose(...args: unknown[]) {
  if (ENABLE_VERBOSE_LOGS) console.log(...args);
}

type AchievementIconProps = {
  iconUrl?: string | null;
  iconGrayUrl?: string | null;
  unlocked: boolean;
  size?: "sm" | "md";
  appId?: string;
};

// Cache for file existence checks to avoid repeated Tauri invocations
const _fileExistsCache = new Map<string, boolean>();
let _fileExistsCacheLogged = false;

async function checkFileExists(path: string): Promise<boolean> {
  const cached = _fileExistsCache.get(path);
  if (cached !== undefined) return cached;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const exists = await invoke<boolean>("file_exists", { path });
    _fileExistsCache.set(path, exists);
    if (_fileExistsCache.size > 500 && !_fileExistsCacheLogged) {
      _fileExistsCacheLogged = true;
      logVerbose("[ACH][ICON] fileExistsCache evicting old entries");
      // Keep most recent 250 entries
      const entries = Array.from(_fileExistsCache.entries());
      const half = entries.slice(-250);
      _fileExistsCache.clear();
      for (const [k, v] of half) _fileExistsCache.set(k, v);
    }
    return exists;
  } catch {
    return false;
  }
}

function useResolvedUrl(url: string | null | undefined, appId?: string): { url: string | undefined; exists: boolean | null } {
  const [resolved, setResolved] = useState<{ url: string | undefined; exists: boolean | null }>({ url: undefined, exists: null });
  useEffect(() => {
    if (!url) {
      setResolved({ url: undefined, exists: false });
      return;
    }
    // Absolute Windows/Linux paths — convert to asset:// URL for WebView
    if (/^[a-zA-Z]:[\\/]/.test(url) || url.startsWith("/")) {
      let cancelled = false;
      (async () => {
        try {
          const { localPathToUrl } = await import("../../services/gameCacheService");
          const assetUrl = localPathToUrl(url);
          if (!cancelled) setResolved({ url: assetUrl ?? undefined, exists: assetUrl ? null : false });
        } catch {
          if (!cancelled) setResolved({ url: undefined, exists: false });
        }
      })();
      return () => { cancelled = true; };
    }
    // Non-local URLs (HTTP, data:, asset:, file://) — no file check needed
    if (!url.startsWith("img/") && !url.startsWith("media/")) {
      setResolved({ url, exists: null });
      return;
    }
    // Local path without appId — can't resolve, treat as missing
    if (!appId) {
      logVerbose(`[ACH][ICON_LOCAL_MISSING] appid=undefined icon=${url} fallback=placeholder reason=no-appid`);
      setResolved({ url: undefined, exists: false });
      return;
    }
    // Clear stale state immediately — prevents rendering old icon during async check
    setResolved({ url: undefined, exists: null });
    let cancelled = false;
    (async () => {
      try {
        const { resolveRelativeAchievementImagePath, localPathToUrl } = await import("../../services/gameCacheService");
        const absPath = await resolveRelativeAchievementImagePath(appId, url);
        const exists = await checkFileExists(absPath);
        if (cancelled) return;
        if (exists) {
          const finalUrl = localPathToUrl(absPath);
          if (!cancelled) setResolved({ url: finalUrl ?? url, exists: true });
        } else {
          if (!cancelled) {
            logVerbose(`[ACH][ICON_LOCAL_MISSING] appid=${appId} icon=${url} fallback=placeholder`);
            setResolved({ url: undefined, exists: false });
          }
        }
      } catch {
        if (!cancelled) setResolved({ url, exists: null });
      }
    })();
    return () => { cancelled = true; };
  }, [url, appId]);
  return resolved;
}

function logIconRender(appId: string | undefined, source: string) {
  if (ENABLE_VERBOSE_LOGS) console.log(`[ACH][ICON_RENDER] appid=${appId} source=${source}`);
}

export default function AchievementIcon({ iconUrl, iconGrayUrl, unlocked, size = "md", appId }: AchievementIconProps) {
  const dimensions = size === "sm" ? "h-7 w-7" : "h-10 w-10";
  const { url: resolvedUrl, exists: iconExists } = useResolvedUrl(iconUrl, appId);
  const { url: resolvedGrayUrl, exists: grayExists } = useResolvedUrl(iconGrayUrl, appId);

  // Track whether original URLs are local paths that need file existence confirmation
  const isLocalIcon = !!(iconUrl && (iconUrl.startsWith("img/") || iconUrl.startsWith("media/")));
  const isLocalGray = !!(iconGrayUrl && (iconGrayUrl.startsWith("img/") || iconGrayUrl.startsWith("media/")));

  // For local img/media paths: only render when file is confirmed to exist (exists === true)
  // For external URLs: render when exists !== false (null means check skipped, URL is valid)
  const canRenderIcon = resolvedUrl && (isLocalIcon ? iconExists === true : iconExists !== false);
  const canRenderGray = resolvedGrayUrl && (isLocalGray ? grayExists === true : grayExists !== false);

  // Unlocked: show colored icon (or placeholder if file missing)
  if (unlocked) {
    if (canRenderIcon) {
      logIconRender(appId, "local");
      return (
        <div className={`${dimensions} shrink-0 overflow-hidden rounded-lg bg-white/5`}>
          <AsyncImage
            src={resolvedUrl}
            alt=""
            className="h-full w-full"
            fallback={<div className="flex h-full w-full items-center justify-center text-(--color-muted)"><Trophy className="h-5 w-5" /></div>}
          />
        </div>
      );
    }
    // File doesn't exist or no URL — show placeholder
    logIconRender(appId, "placeholder");
    return (
      <div className={`${dimensions} shrink-0 overflow-hidden rounded-lg bg-white/5 flex items-center justify-center text-(--color-muted)`}>
        <Trophy className="h-5 w-5 text-emerald-400" />
      </div>
    );
  }

  // Locked: show gray icon with lock overlay (or colored grayscale, or placeholder)
  if (canRenderGray) {
    logIconRender(appId, "local");
    return (
      <div className={`${dimensions} shrink-0 overflow-hidden rounded-lg bg-white/5 relative`}>
        <AsyncImage
          src={resolvedGrayUrl}
          alt=""
          className="h-full w-full opacity-50"
          fallback={<div className="flex h-full w-full items-center justify-center text-(--color-muted)/50"><Lock className="h-5 w-5" /></div>}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <Lock className="h-4 w-4 text-white/70" />
        </div>
      </div>
    );
  }

  // No gray icon file but have colored icon: show colored with grayscale + lock
  if (canRenderIcon) {
    logIconRender(appId, "local");
    return (
      <div className={`${dimensions} shrink-0 overflow-hidden rounded-lg bg-white/5 relative`}>
        <img
          src={resolvedUrl}
          alt=""
          className="h-full w-full object-cover opacity-40 grayscale"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <Lock className="h-4 w-4 text-white/70" />
        </div>
      </div>
    );
  }

  // No image at all: show placeholder
  logIconRender(appId, "placeholder");
  return (
    <div className={`${dimensions} shrink-0 overflow-hidden rounded-lg bg-white/5 flex items-center justify-center text-(--color-muted)`}>
      {unlocked ? <Trophy className="h-5 w-5 text-emerald-400" /> : <Lock className="h-5 w-5" />}
    </div>
  );
}
