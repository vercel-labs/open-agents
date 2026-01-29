import { gateway } from "ai";

const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

type GatewayModel = Awaited<
  ReturnType<typeof gateway.getAvailableModels>
>["models"][number];

function isLanguageModel(model: GatewayModel): boolean {
  return model.modelType === "language" || model.modelType == null;
}

export async function GET() {
  try {
    const { models } = await gateway.getAvailableModels();
    const languageModels = models.filter(isLanguageModel);

    return Response.json(
      { models: languageModels },
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
