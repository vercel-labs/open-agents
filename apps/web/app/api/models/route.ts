const AI_GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function GET() {
  try {
    const response = await fetch(AI_GATEWAY_MODELS_URL);
    if (!response.ok) {
      return Response.json(
        { error: `Failed to fetch available models (${response.status})` },
        { status: 500 },
      );
    }

    const payload: unknown = await response.json();
    const data = isRecord(payload) ? payload.data : undefined;
    if (!Array.isArray(data)) {
      return Response.json(
        { error: "Invalid models response" },
        { status: 500 },
      );
    }

    return Response.json(
      { models: data },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    console.error("Failed to fetch available models:", error);
    return Response.json(
      { error: "Failed to fetch available models" },
      { status: 500 },
    );
  }
}
