import { describe, expect, test } from "bun:test";
import { deriveAuthUsername, normalizeAuthUsername } from "./username";

describe("auth username helpers", () => {
  test("normalizes usernames for safe storage", () => {
    expect(normalizeAuthUsername(" Gioacchino Albanese! ")).toBe(
      "gioacchino-albanese",
    );
  });

  test("prefers provider username fields", () => {
    expect(
      deriveAuthUsername({
        preferred_username: "gioacchinoalbanese-2373",
        email: "gioacchinoalbanese@icloud.com",
        name: "na-test-open-agents",
      }),
    ).toBe("gioacchinoalbanese-2373");
  });

  test("falls back to email local part", () => {
    expect(
      deriveAuthUsername({
        email: "gioacchinoalbanese@icloud.com",
        name: "na-test-open-agents",
      }),
    ).toBe("gioacchinoalbanese");
  });
});
