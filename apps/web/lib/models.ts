import { gateway } from "ai";

export const DEFAULT_MODEL_ID = "anthropic/claude-haiku-4.5";

export type AvailableModel = Awaited<
  ReturnType<typeof gateway.getAvailableModels>
>["models"][number];

export function getModelDisplayName(model: AvailableModel): string {
  return model.name ?? model.id;
}
