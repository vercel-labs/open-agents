import { gateway } from "ai";

const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

type GatewayModel = Awaited<
  ReturnType<typeof gateway.getAvailableModels>
>["models"][number];

type GatewayModelWithContext = GatewayModel & {
  context_window?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getModelsDevContextMap(data: unknown): Map<string, number> {
  const contextMap = new Map<string, number>();
  if (!isRecord(data)) {
    return contextMap;
  }

  for (const [providerKey, providerValue] of Object.entries(data)) {
    if (!isRecord(providerValue)) {
      continue;
    }

    const modelsValue = providerValue.models;
    if (!isRecord(modelsValue)) {
      continue;
    }

    for (const [modelKey, modelValue] of Object.entries(modelsValue)) {
      if (!isRecord(modelValue)) {
        continue;
      }

      const idValue = modelValue.id;
      const rawId = typeof idValue === "string" ? idValue : modelKey;
      const modelId = rawId.includes("/") ? rawId : `${providerKey}/${rawId}`;

      const limitValue = modelValue.limit;
      if (!isRecord(limitValue)) {
        continue;
      }

      const contextValue = limitValue.context;
      if (typeof contextValue !== "number" || contextValue <= 0) {
        continue;
      }

      contextMap.set(modelId, contextValue);
    }
  }

  return contextMap;
}

async function fetchModelsDevContextMap(): Promise<Map<string, number>> {
  try {
    const response = await fetch("https://models.dev/api.json");
    if (!response.ok) {
      return new Map();
    }
    const data: unknown = await response.json();
    return getModelsDevContextMap(data);
  } catch {
    return new Map();
  }
}

function addContextWindow(
  model: GatewayModel,
  contextMap: Map<string, number>,
): GatewayModelWithContext {
  const contextLimit = contextMap.get(model.id);
  if (contextLimit == null) {
    return model;
  }

  const existingContext = Reflect.get(model, "context_window");
  if (existingContext === contextLimit) {
    return model;
  }

  return { ...model, context_window: contextLimit };
}

export async function GET() {
  try {
    const [{ models }, modelsDevContextMap] = await Promise.all([
      gateway.getAvailableModels(),
      fetchModelsDevContextMap(),
    ]);
    const languageModels = models
      .filter((model) => model.modelType === "language")
      .map((model) => addContextWindow(model, modelsDevContextMap));

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
