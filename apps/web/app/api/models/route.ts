import { filterModelsForSession } from "@/lib/model-access";
import { fetchAvailableLanguageModelsWithContext } from "@/lib/models-with-context";
import { getServerSession } from "@/lib/session/get-server-session";

const CACHE_CONTROL = "private, no-store";

export async function GET(req: Request) {
  try {
    const [session, models] = await Promise.all([
      getServerSession(),
      fetchAvailableLanguageModelsWithContext(),
    ]);

    return Response.json(
      { models: filterModelsForSession(models, session, req.url) },
      {
        headers: {
          "Cache-Control": CACHE_CONTROL,
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
