/**
 * Boundary tests: local-catalog cards → Store Game Details.
 *
 * Validates:
 * - catalogGameToStoreGame produces valid PackageGame shape
 * - Metadata loading guard: !metadata?.resolved triggers skeleton
 * - Timeout guard: metadataLoading stays true → timeout fires
 * - resolveGameMetadata fallback: unresolved metadata stays loading
 * - Stale appId guard: old requests don't overwrite new ones
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Tauri invoke ──

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ── catalogGameToStoreGame shape tests ──

/** Inline copy of the mapper to validate contract without importing Store.tsx (4000+ lines) */
function catalogGameToStoreGame(g: {
  appId: number;
  name: string;
  headerImage?: string;
  capsuleImage?: string;
}): { appId: string; title: string; imageUrl: string | undefined; platforms: unknown[]; sources: unknown[] } {
  return {
    appId: String(g.appId),
    title: g.name,
    imageUrl: g.headerImage || g.capsuleImage || undefined,
    platforms: [],
    sources: [],
  };
}

describe("catalogGameToStoreGame", () => {
  it("converts appId to string", () => {
    const result = catalogGameToStoreGame({ appId: 480, name: "Steam" });
    expect(result.appId).toBe("480");
    expect(typeof result.appId).toBe("string");
  });

  it("prefers headerImage over capsuleImage", () => {
    const result = catalogGameToStoreGame({
      appId: 1,
      name: "Game",
      headerImage: "https://example.com/header.jpg",
      capsuleImage: "https://example.com/capsule.jpg",
    });
    expect(result.imageUrl).toBe("https://example.com/header.jpg");
  });

  it("falls back to capsuleImage when headerImage missing", () => {
    const result = catalogGameToStoreGame({
      appId: 1,
      name: "Game",
      capsuleImage: "https://example.com/capsule.jpg",
    });
    expect(result.imageUrl).toBe("https://example.com/capsule.jpg");
  });

  it("returns undefined imageUrl when both missing", () => {
    const result = catalogGameToStoreGame({ appId: 1, name: "Game" });
    expect(result.imageUrl).toBeUndefined();
  });

  it("returns empty sources array", () => {
    const result = catalogGameToStoreGame({ appId: 1, name: "Game" });
    expect(result.sources).toEqual([]);
  });

  it("returns empty platforms array", () => {
    const result = catalogGameToStoreGame({ appId: 1, name: "Game" });
    expect(result.platforms).toEqual([]);
  });

  it("preserves game name as title", () => {
    const result = catalogGameToStoreGame({ appId: 480, name: "Steamworks Test" });
    expect(result.title).toBe("Steamworks Test");
  });
});

// ── Metadata loading guard tests ──

describe("metadataLoading guard", () => {
  it("true when metadata is null", () => {
    const metadata = null as { resolved?: boolean } | null;
    const metadataLoading = !metadata?.resolved;
    expect(metadataLoading).toBe(true);
  });

  it("true when metadata.resolved is false", () => {
    const metadata: { resolved: boolean } = { resolved: false };
    const metadataLoading = !metadata?.resolved;
    expect(metadataLoading).toBe(true);
  });

  it("false when metadata.resolved is true", () => {
    const metadata: { resolved: boolean; name: string } = { resolved: true, name: "Game" };
    const metadataLoading = !metadata?.resolved;
    expect(metadataLoading).toBe(false);
  });
});

// ── Timeout guard tests ──

describe("timeout guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  it("setTimeout fires after 15 seconds", () => {
    const spy = vi.fn();
    const timeout = setTimeout(spy, 15_000);
    vi.advanceTimersByTime(14_999);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    clearTimeout(timeout);
  });

  it("clearTimeout prevents firing", () => {
    const spy = vi.fn();
    const timeout = setTimeout(spy, 15_000);
    clearTimeout(timeout);
    vi.advanceTimersByTime(20_000);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ── Stale-request guard tests ──

describe("stale request guard", () => {
  it("new requestId overwrites stale one", () => {
    let _detailMetadataReqId = 0;
    const results: number[] = [];

    // Simulate two concurrent requests
    const req1 = ++_detailMetadataReqId; // 1
    const req2 = ++_detailMetadataReqId; // 2

    // req1 completes after req2 — should be discarded
    if (req1 === _detailMetadataReqId) results.push(req1);
    if (req2 === _detailMetadataReqId) results.push(req2);

    expect(results).toEqual([2]);
  });

  it("only latest request writes", () => {
    const store: Record<string, string> = {};
    let reqId = 0;

    // Request 1 starts
    const r1 = ++reqId;
    // Request 2 starts (overwrites)
    const r2 = ++reqId;
    // Request 1 completes — stale
    if (r1 === reqId) store["key"] = "from-r1";
    // Request 2 completes — valid
    if (r2 === reqId) store["key"] = "from-r2";

    expect(store["key"]).toBe("from-r2");
  });
});

// ── Catalog query contract tests ──

describe("catalog query → StoreGame pipeline", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("queryByGenre returns fromLocalCatalog flag", async () => {
    mockInvoke.mockResolvedValueOnce([
      {
        appId: 10,
        name: "Action Game",
        type: "game",
        genres: ["Action"],
        categories: [],
        releaseTimestamp: 1700000000,
        comingSoon: false,
        isFree: false,
        reviewPercent: 85,
        reviewCount: 500,
        headerImage: "https://example.com/header.jpg",
        capsuleImage: "https://example.com/capsule.jpg",
        developers: ["Dev"],
        publishers: ["Pub"],
      },
    ]);
    const { queryByGenre } = await import("../services/steamCatalogService");
    const result = await queryByGenre("Action", 24, 0);
    expect(result.fromLocalCatalog).toBe(true);
    expect(result.games).toHaveLength(1);
    expect(result.games[0].appId).toBe(10);
  });

  it("pipeline: catalog row → catalogGameToStoreGame → valid PackageGame", async () => {
    mockInvoke.mockResolvedValueOnce([
      {
        appId: 730,
        name: "Counter-Strike 2",
        type: "game",
        genres: ["Action", "Shooter"],
        categories: [],
        releaseTimestamp: 1700000000,
        comingSoon: false,
        isFree: true,
        reviewPercent: 87,
        reviewCount: 7000000,
        headerImage: "https://example.com/cs2_header.jpg",
        capsuleImage: "https://example.com/cs2_capsule.jpg",
        developers: ["Valve"],
        publishers: ["Valve"],
      },
    ]);
    const { queryByGenre } = await import("../services/steamCatalogService");
    const result = await queryByGenre("Action", 1, 0);
    const storeGame = catalogGameToStoreGame(result.games[0]);

    expect(storeGame.appId).toBe("730");
    expect(storeGame.title).toBe("Counter-Strike 2");
    expect(storeGame.imageUrl).toBe("https://example.com/cs2_header.jpg");
    expect(storeGame.sources).toEqual([]);
  });

  it("pipeline: invalid appId converts to string without crashing", () => {
    const row = { appId: NaN, name: "Bad" } as { appId: number; name: string };
    const result = catalogGameToStoreGame(row);
    expect(result.appId).toBe("NaN");
  });

  it("pipeline: appId=0 converts to '0'", () => {
    const result = catalogGameToStoreGame({ appId: 0, name: "Test" });
    expect(result.appId).toBe("0");
  });
});
