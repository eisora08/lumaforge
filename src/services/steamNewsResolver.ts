import type { SteamNewsItem } from "../types/gameActivity";

const CACHE_KEY = "lumaforge-steam-news-cache-v1";
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;

type SteamApiNewsItem = {
  gid: string;
  title: string;
  url: string;
  is_external_url: boolean;
  author: string;
  contents: string;
  feedlabel: string;
  date: number;
  feedname: string;
  feed_type: number;
  appid: number;
};

type SteamApiResponse = {
  appnews: {
    appid: number;
    newsitems: SteamApiNewsItem[];
    count: number;
  };
};

type CacheShape = Record<
  string,
  {
    savedAt: number;
    items: SteamNewsItem[];
  }
>;

function loadCache(): CacheShape {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as CacheShape;
  } catch {
    return {};
  }
}

function saveCache(cache: CacheShape) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage full */
  }
}

function extractThumbnail(contents: string): string | undefined {
  const imgMatch = contents.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch) return imgMatch[1];
  const bbImgMatch = contents.match(/\[img[^\]]*\]([^\[]+)\[\/img\]/i);
  if (bbImgMatch) return bbImgMatch[1];
  const bbParamMatch = contents.match(/\[img[= ]([^\]]+)\]/i);
  if (bbParamMatch) return bbParamMatch[1];
  const urlMatch = contents.match(/https?:\/\/[^\s"'<]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s"'<]*)?/i);
  if (urlMatch) return urlMatch[0];
  return undefined;
}

function sanitizeSteamContent(html: string): string {
  let text = html
    .replace(/<[^>]*>/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#\d+;/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).replace(/\s+\S*$/, "") + "…";
}

function deriveCategory(feedLabel: string, _feedName: string): string {
  const label = (feedLabel + " " + _feedName).toLowerCase();
  if (/major|big/i.test(label)) return "MAJOR UPDATE";
  if (/patch|update|hotfix|fix|release note/i.test(label)) return "UPDATE";
  if (/event|season|tournament/i.test(label)) return "EVENT";
  return "NEWS";
}

export async function resolveSteamGameNews(
  appId: string | number
): Promise<{ items: SteamNewsItem[]; stale: boolean }> {
  const appIdStr = String(appId);
  const cache = loadCache();
  const cached = cache[appIdStr];

  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return { items: cached.items, stale: false };
  }

  try {
    const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=10&maxlength=800&format=json`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Steam news API returned ${response.status}`);
    }

    const data = (await response.json()) as SteamApiResponse;
    const rawItems = data.appnews?.newsitems ?? [];

    const items: SteamNewsItem[] = rawItems.map((raw) => {
      const summary = truncateText(sanitizeSteamContent(raw.contents), 500);
      return {
        gid: raw.gid,
        title: sanitizeSteamContent(raw.title),
        url: raw.url,
        isExternalUrl: raw.is_external_url,
        author: raw.author,
        contents: raw.contents,
        summary,
        feedLabel: raw.feedlabel,
        date: raw.date * 1000,
        feedName: raw.feedname,
        category: deriveCategory(raw.feedlabel, raw.feedname),
        appId: appIdStr,
        thumbnail: extractThumbnail(raw.contents),
      };
    });

    cache[appIdStr] = { savedAt: Date.now(), items };
    saveCache(cache);

    return { items, stale: false };
  } catch (err) {
    if (cached) {
      return { items: cached.items, stale: true };
    }
    throw err;
  }
}
