import { beforeEach, describe, expect, mock, test } from "bun:test";

const generateTextCalls: Array<{ prompt: string }> = [];

let currentSession: { user: { id: string } } | null = {
  user: { id: "user-1" },
};

let generateTextResult: { text: string } | Error = {
  text: "Generated session title",
};

mock.module("ai", () => ({
  gateway: (modelId: string) => modelId,
  generateText: async (input: { prompt: string }) => {
    generateTextCalls.push(input);

    if (generateTextResult instanceof Error) {
      throw generateTextResult;
    }

    return generateTextResult;
  },
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

const routeModulePromise = import("./route");

function createJsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/generate-title", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/generate-title", () => {
  beforeEach(() => {
    currentSession = { user: { id: "user-1" } };
    generateTextResult = { text: "Generated session title" };
    generateTextCalls.length = 0;
  });

  test("returns 401 when user is not authenticated", async () => {
    currentSession = null;
    const { POST } = await routeModulePromise;

    const response = await POST(createJsonRequest({ message: "hello" }));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("Not authenticated");
  });

  test("returns 400 for invalid JSON", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/generate-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid JSON body");
  });

  test("returns 400 when message is missing or blank", async () => {
    const { POST } = await routeModulePromise;

    const missingResponse = await POST(createJsonRequest({}));
    const missingBody = (await missingResponse.json()) as { error: string };

    expect(missingResponse.status).toBe(400);
    expect(missingBody.error).toBe("Missing required field: message");

    const blankResponse = await POST(createJsonRequest({ message: "   " }));
    const blankBody = (await blankResponse.json()) as { error: string };

    expect(blankResponse.status).toBe(400);
    expect(blankBody.error).toBe("Missing required field: message");
  });

  test("returns generated title when request is valid", async () => {
    generateTextResult = {
      text: "  Fix API Validation\nIgnore this line",
    };

    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({ message: "  hello world  " }),
    );
    const body = (await response.json()) as { title: string };

    expect(response.status).toBe(200);
    expect(body.title).toBe("Fix API Validation");
    expect(generateTextCalls).toHaveLength(1);
    expect(generateTextCalls[0]?.prompt).toContain("hello world");
  });

  test("returns 500 when title generation fails", async () => {
    generateTextResult = new Error("failed");
    const { POST } = await routeModulePromise;

    const response = await POST(createJsonRequest({ message: "hello" }));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to generate title");
  });
});
