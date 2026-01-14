import { gateway } from "ai";

export async function GET() {
  const response = await gateway.getAvailableModels();

  return Response.json(
    { models: response.models },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
