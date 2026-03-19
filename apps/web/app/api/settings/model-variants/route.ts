import { nanoid } from "nanoid";
import {
  createModelVariantInputSchema,
  deleteModelVariantInputSchema,
  getAllVariants,
  isBuiltInVariant,
  MODEL_VARIANT_ID_PREFIX,
  modelVariantSchema,
  type ModelVariant,
  type JsonValue,
  updateModelVariantInputSchema,
} from "@/lib/model-variants";
import {
  getUserPreferences,
  updateUserPreferences,
} from "@/lib/db/user-preferences";
import { getServerSession } from "@/lib/session/get-server-session";

const PROVIDER_OPTIONS_MAX_BYTES = 16 * 1024;

function providerOptionsSizeInBytes(
  providerOptions: Record<string, JsonValue>,
): number {
  const payload = JSON.stringify(providerOptions);
  return new TextEncoder().encode(payload).length;
}

function isProviderOptionsTooLarge(
  providerOptions: Record<string, JsonValue>,
): boolean {
  return (
    providerOptionsSizeInBytes(providerOptions) > PROVIDER_OPTIONS_MAX_BYTES
  );
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return jsonError("Not authenticated", 401);
  }

  const preferences = await getUserPreferences(session.user.id);
  return Response.json({
    modelVariants: getAllVariants(preferences.modelVariants),
  });
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return jsonError("Not authenticated", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const parsedBody = createModelVariantInputSchema.safeParse(body);
  if (!parsedBody.success) {
    return jsonError("Invalid model variant payload", 400);
  }

  if (isProviderOptionsTooLarge(parsedBody.data.providerOptions)) {
    return jsonError("Provider options must be 16 KB or smaller", 400);
  }

  try {
    // NOTE: This read-modify-write flow can drop concurrent updates (e.g. multiple tabs).
    // It's acceptable for now, but should be hardened later with optimistic concurrency
    // or an atomic database update.
    const preferences = await getUserPreferences(session.user.id);
    const nextVariant: ModelVariant = modelVariantSchema.parse({
      id: `${MODEL_VARIANT_ID_PREFIX}${nanoid()}`,
      ...parsedBody.data,
    });

    const updatedPreferences = await updateUserPreferences(session.user.id, {
      modelVariants: [...preferences.modelVariants, nextVariant],
    });

    return Response.json({
      modelVariants: getAllVariants(updatedPreferences.modelVariants),
    });
  } catch (error) {
    console.error("Failed to create model variant:", error);
    return jsonError("Failed to create model variant", 500);
  }
}

export async function PATCH(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return jsonError("Not authenticated", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const parsedBody = updateModelVariantInputSchema.safeParse(body);
  if (!parsedBody.success) {
    return jsonError("Invalid model variant payload", 400);
  }

  if (isBuiltInVariant(parsedBody.data.id)) {
    return jsonError("Built-in variants cannot be modified", 403);
  }

  try {
    const preferences = await getUserPreferences(session.user.id);
    const variantIndex = preferences.modelVariants.findIndex(
      (variant) => variant.id === parsedBody.data.id,
    );

    if (variantIndex === -1) {
      return jsonError("Model variant not found", 404);
    }

    const existingVariant = preferences.modelVariants[variantIndex];
    if (!existingVariant) {
      return jsonError("Model variant not found", 404);
    }

    const updatedVariant = modelVariantSchema.parse({
      ...existingVariant,
      ...parsedBody.data,
    });

    if (isProviderOptionsTooLarge(updatedVariant.providerOptions)) {
      return jsonError("Provider options must be 16 KB or smaller", 400);
    }

    const nextVariants = [...preferences.modelVariants];
    nextVariants[variantIndex] = updatedVariant;

    const updatedPreferences = await updateUserPreferences(session.user.id, {
      modelVariants: nextVariants,
    });

    return Response.json({
      modelVariants: getAllVariants(updatedPreferences.modelVariants),
    });
  } catch (error) {
    console.error("Failed to update model variant:", error);
    return jsonError("Failed to update model variant", 500);
  }
}

export async function DELETE(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return jsonError("Not authenticated", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const parsedBody = deleteModelVariantInputSchema.safeParse(body);
  if (!parsedBody.success) {
    return jsonError("Invalid model variant payload", 400);
  }

  if (isBuiltInVariant(parsedBody.data.id)) {
    return jsonError("Built-in variants cannot be deleted", 403);
  }

  try {
    const preferences = await getUserPreferences(session.user.id);
    const nextVariants = preferences.modelVariants.filter(
      (variant) => variant.id !== parsedBody.data.id,
    );

    if (nextVariants.length === preferences.modelVariants.length) {
      return jsonError("Model variant not found", 404);
    }

    const updatedPreferences = await updateUserPreferences(session.user.id, {
      modelVariants: nextVariants,
    });

    return Response.json({
      modelVariants: getAllVariants(updatedPreferences.modelVariants),
    });
  } catch (error) {
    console.error("Failed to delete model variant:", error);
    return jsonError("Failed to delete model variant", 500);
  }
}
