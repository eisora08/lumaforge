/**
 * RepackMatch — token-aware repack title matching regression tests.
 *
 * The SQL fuzzy query is a plain substring `LIKE` ordered by title length ASC,
 * which mounted unrelated repacks ("Portal" → SPORTAL, "Star" → Stardiver,
 * "Hades" → Hades II first). These tests pin the whole-word token matcher so
 * the Store "Repacks" aside stops showing wrong games.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeRepackTitle,
  scoreRepackMatch,
  rankRepackMatches,
} from "../services/repackMatch";

describe("normalizeRepackTitle", () => {
  it("mirrors the Rust normalization: lowercase, strip non-alnum/non-space", () => {
    expect(normalizeRepackTitle("Half-Life 2: Episode One")).toBe("halflife 2 episode one");
    expect(normalizeRepackTitle("S.T.A.L.K.E.R. 2")).toBe("stalker 2");
    expect(normalizeRepackTitle("  Portal\tCollection  ")).toBe("portal collection");
  });
});

describe("scoreRepackMatch — whole-word token boundary", () => {
  it("rejects a query token that is a substring of another word", () => {
    // "portal" is NOT a whole word in "sportal".
    expect(scoreRepackMatch("Portal", "SPORTAL")).toBeNull();
    // "star" is NOT a whole word in "stardiver".
    expect(scoreRepackMatch("Star", "Stardiver")).toBeNull();
  });

  it("accepts a query token as a whole word", () => {
    expect(scoreRepackMatch("Portal", "Portal Collection")).not.toBeNull();
    expect(scoreRepackMatch("Star", "Bounty Star")).not.toBeNull();
  });

  it("requires ALL query tokens when the query has multiple words", () => {
    // "star wars" must not match a title missing "wars".
    expect(scoreRepackMatch("Star Wars", "Bounty Star")).toBeNull();
    expect(scoreRepackMatch("Star Wars", "Star Wars Jedi: Survivor")).not.toBeNull();
  });

  it("ignores single-character tokens (version noise)", () => {
    // "Resident Evil 2" should still match "Resident Evil" (the "2" token is dropped).
    expect(scoreRepackMatch("Resident Evil 2", "Resident Evil")).not.toBeNull();
    // But "Resident Evil" must not match "Resident Evil 4" unless queried with it.
    expect(scoreRepackMatch("Resident Evil", "Resident Evil 4")).not.toBeNull();
  });

  it("returns null for an empty/meaningless query", () => {
    expect(scoreRepackMatch("a", "Some Game")).toBeNull();
    expect(scoreRepackMatch("", "Some Game")).toBeNull();
  });
});

describe("scoreRepackMatch — ranking", () => {
  it("ranks exact > prefix > partial, shorter titles first", () => {
    const exact = scoreRepackMatch("Hades", "Hades")!;
    const prefix = scoreRepackMatch("Hades", "Hades II")!;
    const partial = scoreRepackMatch("Hades", "Multiplayer Hades Coop")!;
    expect(exact).toBeLessThan(prefix);
    expect(prefix).toBeLessThan(partial);
  });

  it("prefers the shortest title within the same tier (mirrors SQL length ASC)", () => {
    // Both are prefix tier; shorter title wins the tiebreak.
    const plain = scoreRepackMatch("Hades", "Hades Free Download")!;
    const sequel = scoreRepackMatch("Hades", "Hades II")!;
    expect(sequel).toBeLessThan(plain);
  });
});

describe("rankRepackMatches", () => {
  const pool = [
    { title: "SPORTAL" },
    { title: "Tiny Robots: Portal Escape" },
    { title: "Portal Collection" },
    { title: "Portal Defect" },
    { title: "Grand Emprise 2: Portals Apart" },
  ];

  it("discards substring-inside-word matches and sorts by rank", () => {
    const results = rankRepackMatches("Portal", pool, 10).map((r) => r.title);
    expect(results).not.toContain("SPORTAL");
    // "Portals Apart" — "portal" is not a whole word in "portals" → rejected.
    expect(results).not.toContain("Grand Emprise 2: Portals Apart");
    // Prefix-tier titles sort before partial-tier ones.
    expect(results[0]).toBe("Portal Defect");
    expect(results[1]).toBe("Portal Collection");
    expect(results[2]).toBe("Tiny Robots: Portal Escape");
  });

  it("respects the limit", () => {
    const results = rankRepackMatches("Portal", pool, 2);
    expect(results).toHaveLength(2);
  });
});
