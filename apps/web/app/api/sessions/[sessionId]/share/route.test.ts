import { describe, expect, test } from "bun:test";

const routeModulePromise = import("./route");

describe("/api/sessions/[sessionId]/share (deprecated)", () => {
  test("POST returns 410 with deprecation guidance", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST();
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(410);
    expect(body.error).toContain(
      "/api/sessions/:sessionId/chats/:chatId/share",
    );
  });

  test("DELETE returns 410 with deprecation guidance", async () => {
    const { DELETE } = await routeModulePromise;

    const response = await DELETE();
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(410);
    expect(body.error).toContain(
      "/api/sessions/:sessionId/chats/:chatId/share",
    );
  });
});
