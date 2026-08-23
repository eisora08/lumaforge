/**
 * Contract tests for the local Steam catalog service.
 *
 * These tests mock Tauri invoke() and validate the TS service layer:
 * - Cache behavior (TTL, invalidation)
 * - Fallback when catalog unavailable
 * - Type contracts between TS service and Rust commands
 * - preFetchGenreGroups synchronization
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Tauri invoke ──

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ── Fixture data ──

function makeMeta(overrides: Partial<{ hasCatalog: boolean; catalogVersion: number; gameCount: number; checksum: string }> = {}) {
  return {
    schemaVersion: 1,
    catalogVersion: 1,
    importedAt: "2025-01-01T00:00:00Z",
    recordCount: 100,
    gameCount: 90,
    checksum: "test-checksum-abc",
    hasCatalog: true,
    ...overrides,
  };
}

function makeGame(appId: number, name: string, genres: string[] = []) {
  return {
    appId,
    name,
    type: "game",
    genres,
    categories: [],
    releaseTimestamp: 1700000000,
    comingSoon: false,
    isFree: false,
    reviewPercent: 85,
    reviewCount: 500,
    headerImage: `https://example.com/header_${appId}.jpg`,
    capsuleImage: `https://example.com/capsule_${appId}.jpg`,
    developers: ["Dev"],
    publishers: ["Pub"],
  };
}

// ── Tests ──

describe("steamCatalogService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // ── getLocalCatalogStatus ──

  describe("getLocalCatalogStatus", () => {
    it("returns available=true when catalog exists", async () => {
      mockInvoke.mockResolvedValueOnce(makeMeta());
      const { getLocalCatalogStatus } = await import("../services/steamCatalogService");
      const status = await getLocalCatalogStatus();
      expect(status.available).toBe(true);
      expect(status.gameCount).toBe(90);
      expect(status.catalogVersion).toBe(1);
      expect(status.checksum).toBe("test-checksum-abc");
      expect(mockInvoke).toHaveBeenCalledWith("get_catalog_meta");
    });

    it("returns available=false when no catalog", async () => {
      mockInvoke.mockResolvedValueOnce(makeMeta({ hasCatalog: false, gameCount: 0 }));
      const { getLocalCatalogStatus } = await import("../services/steamCatalogService");
      const status = await getLocalCatalogStatus();
      expect(status.available).toBe(false);
    });

    it("returns available=false on invoke error", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("DB locked"));
      const { getLocalCatalogStatus } = await import("../services/steamCatalogService");
      const status = await getLocalCatalogStatus();
      expect(status.available).toBe(false);
      expect(status.gameCount).toBe(0);
    });
  });

  // ── Caching ──

  describe("caching", () => {
    it("getLocalCatalogStatus caches for 5 minutes", async () => {
      vi.useFakeTimers({ now: new Date("2025-06-01T00:00:00Z") });
      mockInvoke.mockResolvedValue(makeMeta());
      const { getLocalCatalogStatus } = await import("../services/steamCatalogService");

      const s1 = await getLocalCatalogStatus();
      const s2 = await getLocalCatalogStatus();
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(s1.gameCount).toBe(s2.gameCount);

      vi.advanceTimersByTime(5 * 60 * 1000);
      mockInvoke.mockResolvedValue(makeMeta({ gameCount: 200 }));
      const s3 = await getLocalCatalogStatus();
      expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect(s3.gameCount).toBe(200);
    });
  });

  // ── importCatalogArtifact ──

  describe("importCatalogArtifact", () => {
    it("calls import_steam_catalog with correct args", async () => {
      mockInvoke.mockResolvedValueOnce(42);
      const { importCatalogArtifact } = await import("../services/steamCatalogService");
      const count = await importCatalogArtifact('{"records":[]}', "checksum123");
      expect(count).toBe(42);
      expect(mockInvoke).toHaveBeenCalledWith("import_steam_catalog", {
        artifactJson: '{"records":[]}',
        checksum: "checksum123",
      });
    });
  });

  // ── queryByGenre ──

  describe("queryByGenre", () => {
    it("returns games for a genre", async () => {
      mockInvoke.mockResolvedValueOnce([makeGame(1, "Action Game", ["Action"])]);
      const { queryByGenre } = await import("../services/steamCatalogService");
      const result = await queryByGenre("Action", 24, 0);
      expect(result.games).toHaveLength(1);
      expect(result.games[0].appId).toBe(1);
      expect(result.fromLocalCatalog).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith("query_catalog_by_genre", {
        genre: "Action",
        limit: 24,
        offset: 0,
      });
    });

    it("caches results within TTL", async () => {
      vi.useFakeTimers({ now: new Date("2025-06-01T00:00:00Z") });
      mockInvoke.mockResolvedValue([makeGame(1, "Test", ["Indie"])]);
      const { queryByGenre } = await import("../services/steamCatalogService");

      await queryByGenre("Indie", 20, 0);
      await queryByGenre("Indie", 20, 0);
      expect(mockInvoke).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5 * 60 * 1000);
      mockInvoke.mockResolvedValue([makeGame(2, "Test2", ["Indie"])]);
      await queryByGenre("Indie", 20, 0);
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });

  // ── querySearch ──

  describe("querySearch", () => {
    it("calls query_catalog_search with correct args", async () => {
      mockInvoke.mockResolvedValueOnce([makeGame(42, "Hollow Knight")]);
      const { querySearch } = await import("../services/steamCatalogService");
      const result = await querySearch("hollow", 24);
      expect(result.games[0].appId).toBe(42);
      expect(mockInvoke).toHaveBeenCalledWith("query_catalog_search", {
        query: "hollow",
        limit: 24,
      });
    });
  });

  // ── getCatalogGame ──

  describe("getCatalogGame", () => {
    it("returns single game by appId", async () => {
      mockInvoke.mockResolvedValueOnce(makeGame(555, "Cuphead"));
      const { getCatalogGame } = await import("../services/steamCatalogService");
      const game = await getCatalogGame(555);
      expect(game).not.toBeNull();
      expect(game!.appId).toBe(555);
      expect(game!.name).toBe("Cuphead");
      expect(mockInvoke).toHaveBeenCalledWith("query_catalog_game", { appId: 555 });
    });

    it("returns null when not found", async () => {
      mockInvoke.mockResolvedValueOnce(null);
      const { getCatalogGame } = await import("../services/steamCatalogService");
      const game = await getCatalogGame(99999);
      expect(game).toBeNull();
    });
  });

  // ── queryFeaturedGames ──

  describe("queryFeaturedGames", () => {
    it("returns featured games", async () => {
      const games = [makeGame(1, "Great Game"), makeGame(2, "Another Great Game")];
      mockInvoke.mockResolvedValueOnce(games);
      const { queryFeaturedGames } = await import("../services/steamCatalogService");
      const result = await queryFeaturedGames(24);
      expect(result.games).toHaveLength(2);
      expect(mockInvoke).toHaveBeenCalledWith("query_catalog_featured", { limit: 24 });
    });
  });

  // ── queryNewNoteworthyGames ──

  describe("queryNewNoteworthyGames", () => {
    it("returns new & noteworthy games", async () => {
      mockInvoke.mockResolvedValueOnce([makeGame(10, "New Release")]);
      const { queryNewNoteworthyGames } = await import("../services/steamCatalogService");
      const result = await queryNewNoteworthyGames(24);
      expect(result.games).toHaveLength(1);
      expect(result.games[0].name).toBe("New Release");
      expect(mockInvoke).toHaveBeenCalledWith("query_catalog_new_noteworthy", { limit: 24 });
    });

    it("uses separate cache from queryFeaturedGames", async () => {
      vi.useFakeTimers({ now: new Date("2025-06-01T00:00:00Z") });
      mockInvoke.mockResolvedValueOnce([makeGame(1, "Featured")]);
      const { queryFeaturedGames } = await import("../services/steamCatalogService");
      await queryFeaturedGames(10);

      mockInvoke.mockResolvedValueOnce([makeGame(2, "NewNoteworthy")]);
      const { queryNewNoteworthyGames } = await import("../services/steamCatalogService");
      const result = await queryNewNoteworthyGames(10);

      expect(result.games[0].appId).toBe(2);
      expect(result.games[0].name).toBe("NewNoteworthy");
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });

  // ── isLocalCatalogReady / preFetchGenreGroups ──

  describe("isLocalCatalogReady", () => {
    it("starts as false", async () => {
      const { isLocalCatalogReady } = await import("../services/steamCatalogService");
      expect(isLocalCatalogReady()).toBe(false);
    });
  });

  describe("preFetchGenreGroups", () => {
    it("returns false when no catalog available", async () => {
      mockInvoke.mockResolvedValueOnce(makeMeta({ hasCatalog: false }));
      const { preFetchGenreGroups, isLocalCatalogReady } = await import("../services/steamCatalogService");
      const ok = await preFetchGenreGroups(["Action"], 20);
      expect(ok).toBe(false);
      expect(isLocalCatalogReady()).toBe(false);
    });

    it("populates genre groups when catalog available", async () => {
      mockInvoke.mockResolvedValueOnce(makeMeta());
      mockInvoke.mockResolvedValueOnce([makeGame(1, "Action A", ["Action"])]);
      const { preFetchGenreGroups, getLocalGenreGroups, isLocalCatalogReady } = await import("../services/steamCatalogService");
      const ok = await preFetchGenreGroups(["Action"], 20);
      expect(ok).toBe(true);
      expect(isLocalCatalogReady()).toBe(true);
      const groups = getLocalGenreGroups();
      expect(groups).not.toBeNull();
      expect(groups!.has("Action")).toBe(true);
      expect(groups!.get("Action")).toHaveLength(1);
    });
  });
});
