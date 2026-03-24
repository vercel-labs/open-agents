import { describe, expect, test } from "bun:test";
import { TERMINAL_SERVER_SCRIPT } from "./server-script";

describe("TERMINAL_SERVER_SCRIPT", () => {
  test("serves any file under /dist so Ghostty support chunks can load", () => {
    expect(TERMINAL_SERVER_SCRIPT).toContain(
      'url.pathname.startsWith("/dist/")',
    );
    expect(TERMINAL_SERVER_SCRIPT).toContain("resolvedDistPath");
    expect(TERMINAL_SERVER_SCRIPT).not.toContain(
      'url.pathname === "/dist/ghostty-web.js"',
    );
  });

  test("includes a versioned health response so stale terminal servers can be restarted", () => {
    expect(TERMINAL_SERVER_SCRIPT).toContain("SERVER_VERSION");
    expect(TERMINAL_SERVER_SCRIPT).toContain(
      "sendJson(res, 200, { ok: true, version: SERVER_VERSION })",
    );
  });
});
