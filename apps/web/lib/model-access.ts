import type { UserPreferencesData } from "@/lib/db/user-preferences";
import type { ModelVariant } from "@/lib/model-variants";
import type { Session } from "@/lib/session/types";

type SessionLike = Pick<Session, "authProvider" | "user"> | null | undefined;

export function filterModelsForSession<T extends { id: string }>(
  models: T[],
  _session: SessionLike,
  _url: string | URL,
): T[] {
  return models;
}

export function filterModelVariantsForSession(
  modelVariants: ModelVariant[],
  _session: SessionLike,
  _url: string | URL,
): ModelVariant[] {
  return modelVariants;
}

export function sanitizeSelectedModelIdForSession(
  modelId: string | null | undefined,
  _modelVariants: ModelVariant[],
  _session: SessionLike,
  _url: string | URL,
): string | null | undefined {
  return modelId;
}

export function sanitizeUserPreferencesForSession(
  preferences: UserPreferencesData,
  _session: SessionLike,
  _url: string | URL,
): UserPreferencesData {
  return preferences;
}
