import { gateway } from "ai";
import type { AvailableModel } from "@/lib/models";

// Server-side cache for available models
let cachedModels: AvailableModel[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function GET() {
  const now = Date.now();

  // Return cached models if still valid
  if (cachedModels && now - cacheTimestamp < CACHE_TTL_MS) {
    return Response.json({ models: cachedModels });
  }

  // Fetch fresh models
  const response = await gateway.getAvailableModels();
  cachedModels = response.models;
  cacheTimestamp = now;

  return Response.json({ models: cachedModels });
}
