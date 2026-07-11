export type ImageSearchProvider = "google" | "bing";

export type ImageSearchResult = {
  title: string;
  sourceUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  contextLink?: string;
};

export type ImageSearchResponse = {
  results: ImageSearchResult[];
  totalEstimate: number;
  nextStartIndex?: number;
};

type ProviderCredentials = {
  googleApiKey?: string;
  googleCx?: string;
  bingApiKey?: string;
};

type SearchOptions = {
  query: string;
  provider: ImageSearchProvider;
  credentials: ProviderCredentials;
  startIndex?: number;
  pageSize?: number;
  safeSearch?: boolean;
  imageSize?: "large" | "medium" | "icon" | null;
  imageType?: "photo" | "clipart" | "animated" | "transparent" | null;
};

const DEFAULT_PAGE_SIZE = 20;
const GOOGLE_BASE = "https://www.googleapis.com/customsearch/v1";
const BING_BASE = "https://api.bing.microsoft.com/v7.0/images/search";

async function searchGoogle(query: string, apiKey: string, cx: string, opts: {
  startIndex?: number;
  pageSize?: number;
  safeSearch?: boolean;
  imageSize?: string;
  imageType?: string;
}): Promise<ImageSearchResponse> {
  const params = new URLSearchParams({
    key: apiKey,
    cx,
    q: query,
    searchType: "image",
    num: String(opts.pageSize ?? DEFAULT_PAGE_SIZE),
  });
  if (opts.startIndex && opts.startIndex > 1) params.set("start", String(opts.startIndex));
  if (opts.safeSearch) params.set("safe", "active");
  if (opts.imageSize) params.set("imgSize", opts.imageSize);
  if (opts.imageType) params.set("imgType", opts.imageType);

  const url = `${GOOGLE_BASE}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Custom Search API error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();

  const results: ImageSearchResult[] = (data.items ?? []).map((item: Record<string, unknown>) => {
    const img = item.image as Record<string, unknown> | undefined;
    return {
      title: (item.title as string) ?? "",
      sourceUrl: (item.link as string) ?? "",
      thumbnailUrl: (img?.thumbnailLink as string) ?? (item.link as string) ?? "",
      width: (img?.width as number) ?? 0,
      height: (img?.height as number) ?? 0,
      contextLink: (img?.contextLink as string) ?? undefined,
    };
  });

  return {
    results,
    totalEstimate: data.searchInformation?.totalResults ? Number(data.searchInformation.totalResults) : results.length,
    nextStartIndex: results.length > 0 ? (opts.startIndex ?? 1) + results.length : undefined,
  };
}

async function searchBing(query: string, apiKey: string, opts: {
  startIndex?: number;
  pageSize?: number;
  safeSearch?: boolean;
  imageSize?: string;
  imageType?: string;
}): Promise<ImageSearchResponse> {
  const params = new URLSearchParams({
    q: query,
    count: String(opts.pageSize ?? DEFAULT_PAGE_SIZE),
  });
  if (opts.startIndex && opts.startIndex > 1) params.set("offset", String(opts.startIndex - 1));
  if (opts.imageSize) {
    if (opts.imageSize === "large") params.set("size", "Large");
    else if (opts.imageSize === "medium") params.set("size", "Medium");
    else if (opts.imageSize === "icon") params.set("size", "Small");
  }
  if (opts.imageType === "transparent") params.set("imageType", "Transparent");

  const url = `${BING_BASE}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Bing Image Search API error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();

  const results: ImageSearchResult[] = (data.value ?? []).map((item: Record<string, unknown>) => ({
    title: (item.name as string) ?? "",
    sourceUrl: (item.contentUrl as string) ?? "",
    thumbnailUrl: (item.thumbnailUrl as string) ?? (item.contentUrl as string) ?? "",
    width: (item.width as number) ?? 0,
    height: (item.height as number) ?? 0,
    contextLink: (item.hostPageUrl as string) ?? undefined,
  }));

  return {
    results,
    totalEstimate: data.totalEstimatedMatches ?? results.length,
    nextStartIndex: results.length > 0 ? (opts.startIndex ?? 1) + results.length : undefined,
  };
}

export async function searchImages(options: SearchOptions): Promise<ImageSearchResponse> {
  const { query, provider, credentials, startIndex, pageSize, safeSearch, imageSize, imageType } = options;

  if (!query.trim()) {
    return { results: [], totalEstimate: 0 };
  }

  if (provider === "google") {
    if (!credentials.googleApiKey || !credentials.googleCx) {
      throw new Error("Google Custom Search is not configured. Add API Key and Search Engine ID in Settings.");
    }
    return searchGoogle(query, credentials.googleApiKey, credentials.googleCx, {
      startIndex,
      pageSize,
      safeSearch,
      imageSize: imageSize ?? undefined,
      imageType: imageType ?? undefined,
    });
  }

  if (provider === "bing") {
    if (!credentials.bingApiKey) {
      throw new Error("Bing Image Search is not configured. Add API Key in Settings.");
    }
    return searchBing(query, credentials.bingApiKey, {
      startIndex,
      pageSize,
      safeSearch,
      imageSize: imageSize ?? undefined,
      imageType: imageType ?? undefined,
    });
  }

  return { results: [], totalEstimate: 0 };
}
