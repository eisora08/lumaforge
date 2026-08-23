import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

// In-memory cache: "appId:role" → asset:// URL
const _cache = new Map<string, string>();

/**
 * Resolve a Store image URL by downloading via Rust (bypasses CORS).
 * Returns an asset:// URL that the WebView can load without CORS issues.
 * Falls back to the original HTTPS URL if download fails.
 */
export async function resolveStoreImageUrl(
  appId: string,
  role: string,
  httpsUrl: string,
): Promise<string> {
  if (!httpsUrl) return httpsUrl;

  // Already an asset or data URL — return as-is
  if (httpsUrl.startsWith("asset://") || httpsUrl.startsWith("data:") || httpsUrl.startsWith("file://")) {
    return httpsUrl;
  }

  const key = `${appId}:${role}`;
  const cached = _cache.get(key);
  if (cached) return cached;

  try {
    // Rust returns absolute path, convert to asset:// URL
    const localPath: string = await invoke("download_store_image", {
      url: httpsUrl,
      appId,
      role,
    });
    const assetUrl = convertFileSrc(localPath, "asset");
    _cache.set(key, assetUrl);
    return assetUrl;
  } catch {
    // Download failed — return the original HTTPS URL as fallback
    return httpsUrl;
  }
}
