import type { SteamAppMetadata, SteamMovie } from "../types/gameMetadata";
import type { StoreMediaItem, StoreMediaSource, StoreScreenshotMedia, StoreTrailerMedia } from "../types/store";

function isPlayable(m: SteamMovie): boolean {
  return !!(m.mp4_max || m.mp4_480 || m.webm_max || m.webm_480 || m.hls || m.hls_h264 || m.dash || m.dash_h264 || m.dash_av1);
}

function bestPlaybackUrl(m: SteamMovie): { mp4?: string; webm?: string; hls?: string; hls_h264?: string; dash?: string; dash_h264?: string; dash_av1?: string } {
  return {
    mp4: m.mp4_max || m.mp4_480 || undefined,
    webm: m.webm_max || m.webm_480 || undefined,
    hls: m.hls || undefined,
    hls_h264: m.hls_h264 || undefined,
    dash: m.dash || undefined,
    dash_h264: m.dash_h264 || undefined,
    dash_av1: m.dash_av1 || undefined,
  };
}

function getPlayableFormat(urls: { mp4?: string; webm?: string; hls_h264?: string; dash_h264?: string; dash_av1?: string; hls?: string; dash?: string }): { src: string; type: string } | null {
  if (urls.mp4) return { src: urls.mp4, type: "video/mp4" };
  if (urls.webm) return { src: urls.webm, type: "video/webm" };
  if (urls.hls_h264) return { src: urls.hls_h264, type: "application/x-mpegURL" };
  if (urls.dash_h264) return { src: urls.dash_h264, type: "application/dash+xml" };
  if (urls.dash_av1) return { src: urls.dash_av1, type: "application/dash+xml" };
  if (urls.hls) return { src: urls.hls, type: "application/x-mpegURL" };
  if (urls.dash) return { src: urls.dash, type: "application/dash+xml" };
  return null;
}

const IGNORED_FALLBACK_KEYS = new Set([
  "header_image",
  "background_image",
  "hero_image",
  "capsule_image",
  "capsule_image_v5",
  "wide_cover_image",
  "library_header_image",
  "library_hero_image",
  "library_logo_image",
]);

function extractHtmlVideos(html: string, source: StoreMediaSource): StoreTrailerMedia[] {
  const videos: StoreTrailerMedia[] = [];
  const videoRegex = /<video[\s\S]*?<\/video>/gi;
  let match: RegExpExecArray | null;
  while ((match = videoRegex.exec(html)) !== null) {
    const block = match[0];
    const poster = block.match(/poster=["']([^"']+)["']/)?.[1];
    const mp4Match = block.match(/<source[^>]+src=["']([^"']+)["'][^>]*type=["']video\/mp4["']/i);
    const webmMatch = block.match(/<source[^>]+src=["']([^"']+)["'][^>]*type=["']video\/webm["']/i);
    const sourceMatch = block.match(/<source[^>]+src=["']([^"']+)["']/i);
    const mp4 = mp4Match?.[1];
    const webm = webmMatch?.[1];
    const fallbackSrc = sourceMatch?.[1];
    if (mp4 || webm || fallbackSrc) {
      const id = `html-${mp4 || webm || fallbackSrc}`;
      const videoName = source === "html-about" ? "About the Game" : "Detailed Description";
      videos.push({
        type: "trailer",
        id,
        name: `${videoName} ${videos.length + 1}`,
        poster,
        mp4: mp4 || undefined,
        webm: webm || undefined,
        source,
      });
    }
  }
  return videos;
}

function deduplicateMedia(items: StoreMediaItem[]): StoreMediaItem[] {
  const seen = new Set<string>();
  const kept: StoreMediaItem[] = [];
  for (const item of items) {
    if (item.type === "trailer") {
      const key = item.mp4 || item.webm || item.hls || item.hls_h264 || item.dash || item.dash_h264 || item.dash_av1 || item.id;
      if (seen.has(key)) {
        console.log(`[STORE][TRAILER_DEDUPE_KEY] name="${item.name || ""}" source=${item.source} key=${key} kept=false`);
        continue;
      }
      seen.add(key);
      console.log(`[STORE][TRAILER_DEDUPE_KEY] name="${item.name || ""}" source=${item.source} key=${key} kept=true`);
      kept.push(item);
    } else {
      const key = item.image || item.thumbnail || item.id;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(item);
    }
  }
  return kept;
}

function buildScreenshots(meta: SteamAppMetadata): StoreScreenshotMedia[] {
  const screenshots = meta.screenshots ?? [];
  return screenshots.map((url, idx) => {
    const thumbnail = url.includes("images.igdb.com")
      ? url.replace("/t_screenshot_big/", "/t_thumb/")
      : url.replace(/\/[^/]+\.jpg$/, "/") + `${url.match(/ss_[\da-f]+/)?.[0] || idx}_thumb.jpg`;
    return {
      type: "screenshot",
      id: `ss-${idx}`,
      thumbnail,
      image: url,
      source: "steam-screenshots" as const,
    };
  });
}

function buildSteamMovies(meta: SteamAppMetadata, mediaLanguage?: string, mediaRegion?: string): StoreTrailerMedia[] {
  const movies = meta.movies ?? [];
  console.log(`[STORE][MOVIES_RAW] appid=${meta.app_id} count=${movies.length} names=${movies.map(m => `"${m.name}"`).join(", ")} language=${mediaLanguage || "default"}`);
  for (const m of movies) {
    const fmt = getPlayableFormat(bestPlaybackUrl(m));
    console.log(`[STORE][TRAILER_RAW_MOVIE] appid=${meta.app_id} id=${m.id} name="${m.name}" keys=${fmt ? fmt.type : "none"}`);
  }
  const playable = movies.filter(isPlayable);
  if (playable.length < movies.length) {
    for (const m of movies) {
      if (!isPlayable(m)) {
        console.log(`[STORE][MOVIE_DROPPED] appid=${meta.app_id} id=${m.id} name="${m.name}" reason=no-playable-format`);
      }
    }
  }
  let primary: SteamMovie | undefined;
  const rest: SteamMovie[] = [];
  for (const m of playable) {
    if (m.highlight) {
      if (!primary) { primary = m; continue; }
    }
    rest.push(m);
  }
  const ordered = primary ? [primary, ...rest] : rest;
  const trailers: StoreTrailerMedia[] = [];
  for (const m of ordered) {
    const urls = bestPlaybackUrl(m);
    const fmt = getPlayableFormat(urls);
    console.log(`[STORE][TRAILER_STEAM_MOVIE] appid=${meta.app_id} name="${m.name}" mp4=${!!urls.mp4} webm=${!!urls.webm} hls=${!!urls.hls} hls_h264=${!!urls.hls_h264} dash=${!!urls.dash} dash_h264=${!!urls.dash_h264} dash_av1=${!!urls.dash_av1} format=${fmt ? fmt.type : "none"}`);
    trailers.push({
      type: "trailer",
      id: `steam-movie-${m.id}`,
      name: m.name,
      thumbnail: m.thumbnail || undefined,
      poster: m.thumbnail || undefined,
      mp4: urls.mp4,
      webm: urls.webm,
      hls: urls.hls,
      hls_h264: urls.hls_h264,
      dash: urls.dash,
      dash_h264: urls.dash_h264,
      dash_av1: urls.dash_av1,
      source: "steam-movies",
      mediaLanguage,
      mediaRegion,
    });
  }
  return trailers;
}

export function buildStoreMedia(meta?: SteamAppMetadata | null, mediaLanguage?: string, mediaRegion?: string): StoreMediaItem[] {
  if (!meta) return [];

  const ignoredFields: string[] = [];
  for (const key of IGNORED_FALLBACK_KEYS) {
    if ((meta as any)[key]) {
      ignoredFields.push(key);
      console.log(`[STORE][MEDIA_IGNORE] appid=${meta.app_id} field=${key} reason=not-gallery-media`);
    }
  }

  // Step 1: Steam movies (primary ordered)
  const steamMovies = buildSteamMovies(meta, mediaLanguage, mediaRegion);

  // Step 2: HTML video fallback — ONLY if Steam movies are empty
  const htmlAboutVideos = meta.about_the_game
    ? extractHtmlVideos(meta.about_the_game, "html-about")
    : [];
  const htmlDetailedVideos = meta.detailed_description
    ? extractHtmlVideos(meta.detailed_description, "html-detailed-description")
    : [];
  const allHtmlVideos = [...htmlAboutVideos, ...htmlDetailedVideos];

  // Deduplicate HTML videos against Steam movies by actual URL
  const steamUrls = new Set<string>();
  for (const t of steamMovies) {
    if (t.mp4) steamUrls.add(t.mp4);
    if (t.webm) steamUrls.add(t.webm);
    if (t.hls) steamUrls.add(t.hls);
    if (t.hls_h264) steamUrls.add(t.hls_h264);
    if (t.dash) steamUrls.add(t.dash);
    if (t.dash_h264) steamUrls.add(t.dash_h264);
    if (t.dash_av1) steamUrls.add(t.dash_av1);
  }
  const uniqueHtmlVideos = allHtmlVideos.filter(
    (v) => !(v.mp4 && steamUrls.has(v.mp4)) && !(v.webm && steamUrls.has(v.webm))
  );

  console.log(
    `[STORE][TRAILER_PARSE] appid=${meta.app_id} steamMovies=${steamMovies.length} htmlAboutVideos=${htmlAboutVideos.length} htmlDetailedVideos=${htmlDetailedVideos.length} total=${steamMovies.length + uniqueHtmlVideos.length}`
  );

  // Step 3: Screenshots
  const screenshots = buildScreenshots(meta);
  console.log(`[STORE][SCREENSHOT_BUILD] appid=${meta.app_id} screenshots=${screenshots.length}`);

  // Step 4: Build ordered list
  const items: StoreMediaItem[] = [];

  // Steam movies always first
  if (steamMovies.length > 0) {
    items.push(...steamMovies);
  }

  // HTML videos only as fallback when no Steam movies exist
  if (steamMovies.length === 0 && uniqueHtmlVideos.length > 0) {
    console.log(`[STORE][HTML_FALLBACK] appid=${meta.app_id} reason=no-steam-movies count=${uniqueHtmlVideos.length}`);
    items.push(...uniqueHtmlVideos);
  }

  // Screenshots after all trailers
  if (screenshots.length > 0) {
    items.push(...screenshots);
  }

  // Deduplicate
  const before = items.length;
  const deduped = deduplicateMedia(items);
  const after = deduped.length;
  if (before !== after) {
    console.log(`[STORE][MEDIA_DEDUPE] appid=${meta.app_id} before=${before} after=${after}`);
  }

  const trailerCount = deduped.filter((i) => i.type === "trailer").length;
  const screenshotCount = deduped.filter((i) => i.type === "screenshot").length;
  console.log(
    `[STORE][MEDIA_BUILD] appid=${meta.app_id} trailers=${trailerCount} screenshots=${screenshotCount} ignoredFallbackImages=${ignoredFields.length}`
  );

  return deduped;
}

export function getStoreMediaBadgeLabel(items: StoreMediaItem[]): string {
  const hasTrailers = items.some((i) => i.type === "trailer");
  return hasTrailers ? "Trailer / Screenshots" : "Screenshots";
}
