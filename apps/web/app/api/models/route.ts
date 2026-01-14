import { gateway } from "ai";

export async function GET() {
  try {
    const response = await gateway.getAvailableModels();

    return Response.json(
      { models: response.models },
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
