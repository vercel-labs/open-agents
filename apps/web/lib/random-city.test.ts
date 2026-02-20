import { describe, expect, test } from "bun:test";
import { getRandomCityName } from "./random-city";

describe("getRandomCityName", () => {
  test("returns a non-empty string when no names are used", () => {
    const result = getRandomCityName(new Set());
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("returned name is not in the usedNames set", () => {
    const used = new Set(["Tokyo", "Paris", "London"]);
    const result = getRandomCityName(used);
    expect(used.has(result)).toBe(false);
  });

  test("avoids all used names when many are excluded", () => {
    // Use all cities except one - pick the last city ("Wellington") and exclude all but it.
    // We can't reference the private list, so instead test statistically with a large used set
    // built by calling the function many times.
    const used = new Set<string>();
    // Collect 50 unique results to ensure deduplication is working across calls
    for (let i = 0; i < 50; i++) {
      const name = getRandomCityName(used);
      expect(used.has(name)).toBe(false);
      used.add(name);
    }
    expect(used.size).toBe(50);
  });

  test("falls back to numbered suffix when all cities are exhausted", () => {
    // Build a set containing every possible city by exhausting them all
    const used = new Set<string>();
    // The city list has ~196 entries. Drain them all.
    for (let i = 0; i < 250; i++) {
      const name = getRandomCityName(used);
      used.add(name);
    }

    // After all base cities are used, subsequent picks should have a numeric suffix
    const overflow = getRandomCityName(used);
    // The fallback format is "<City> <number>", e.g. "Tokyo 2"
    expect(/ \d+$/.test(overflow)).toBe(true);
  });

  test("numbered suffix increments to avoid already-used suffixed names", () => {
    // Exhaust base cities then force collision on suffixed names
    const used = new Set<string>();
    for (let i = 0; i < 250; i++) {
      used.add(getRandomCityName(used));
    }

    // Each successive call must return a name not already in `used`
    for (let i = 0; i < 5; i++) {
      const overflow = getRandomCityName(used);
      expect(used.has(overflow)).toBe(false);
      // All overflow names should carry a numeric suffix
      expect(/ \d+$/.test(overflow)).toBe(true);
      used.add(overflow);
    }
  });

  test("does not mutate the usedNames set", () => {
    const used = new Set(["Tokyo", "Paris"]);
    const sizeBefore = used.size;
    getRandomCityName(used);
    expect(used.size).toBe(sizeBefore);
  });
});
