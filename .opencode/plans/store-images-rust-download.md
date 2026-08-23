# Plan: Store images via Rust download + asset:// protocol

## Problem
Store browse/discover card images are loaded as raw HTTPS CDN URLs. Steam's Akamai CDN doesn't send CORS headers → WebView blocks image display. Browse cards show placeholders.

## Solution
Download Store images via Rust `reqwest` (bypasses CORS), save to local disk, serve via `asset://` protocol.

## Architecture

```
PackageCard src URL
  → resolveStoreImage(appId, role) 
  → checks in-memory cache (Map<appId, assetUrl>)
  → if miss: Rust command downloads image to <appData>/store/images/{appId}_{role}.jpg
  → returns asset:// URL via convertFileSrc
  → <img src={asset://...}>
```

## Files to change

### 1. New Rust command: `download_store_image` (game_cache.rs)
- `pub async fn download_store_image(url: String, app_id: String, role: String) -> Result<String, String>`
- Downloads via async `reqwest::Client`
- Saves to `<appData>/store/images/{appId}_{role}.jpg`
- Returns `asset://` URL via `convertFileSrc`
- Reuses existing `safe_single_download` pattern but simpler (no hash dedup needed for Store)

### 2. New TS service: `storeImageDownloader.ts`
- `resolveStoreImageUrl(appId, role, httpsUrl)` — checks in-memory cache, calls Rust if miss
- Module-level `Map<string, string>` cache (appId:role → assetUrl)
- Called from PackageCard before rendering

### 3. Modified: `PackageCard.tsx`
- Before rendering `<img>`, call `resolveStoreImageUrl(appId, "capsule", cdnUrl)`
- Use returned `asset://` URL as `src` instead of raw HTTPS URL
- Fallback chain stays the same but each URL goes through the downloader

### 4. Modified: `StoreDiscoverHeroCarousel.tsx` (if needed)
- Same pattern for hero carousel images

## Expected result
- All Store card images load via Rust download → local disk → asset:// protocol
- No CORS errors
- Images persist across sessions (cached on disk)
- Faster subsequent loads (no network re-fetch)
