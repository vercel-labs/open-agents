import { nanoid } from "nanoid";
import { z } from "zod";
import {
  getUserPreferences,
  updateUserPreferences,
} from "@/lib/db/user-preferences";
import {
  MODEL_VARIANT_ID_PREFIX,
  modelVariantCreateInputSchema,
  modelVariantDeleteInputSchema,
  modelVariantUpdateInputSchema,
} from "@/lib/model-variants";
import { getServerSession } from "@/lib/session/get-server-session";

const MAX_PROVIDER_OPTIONS_BYTES = 16 * 1024;

function estimateJsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateProviderOptionsSize(
  providerOptions: Record<string, unknown>,
): string | null {
  const payloadLength = estimateJsonByteLength(providerOptions);
  if (payloadLength > MAX_PROVIDER_OPTIONS_BYTES) {
    return `Provider options must be ${MAX_PROVIDER_OPTIONS_BYTES} bytes or less`;
  }

  return null;
}

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const preferences = await getUserPreferences(session.user.id);
  return Response.json({ modelVariants: preferences.modelVariants });
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = modelVariantCreateInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid model variant payload" },
      { status: 400 },
    );
  }

  if (!isPlainObject(parsed.data.providerOptions)) {
    return Response.json(
      { error: "providerOptions must be a JSON object" },
      { status: 400 },
    );
  }

  const sizeError = validateProviderOptionsSize(parsed.data.providerOptions);
  if (sizeError) {
    return Response.json({ error: sizeError }, { status: 400 });
  }

  const preferences = await getUserPreferences(session.user.id);
  const now = new Date().toISOString();
  const createdVariant = {
    id: `${MODEL_VARIANT_ID_PREFIX}${nanoid(12)}`,
    name: parsed.data.name,
    baseModelId: parsed.data.baseModelId,
    providerOptions: parsed.data.providerOptions,
    createdAt: now,
    updatedAt: now,
  };

  const nextVariants = [...preferences.modelVariants, createdVariant];
  const updatedPreferences = await updateUserPreferences(session.user.id, {
    modelVariants: nextVariants,
  });

  return Response.json({
    modelVariant: createdVariant,
    modelVariants: updatedPreferences.modelVariants,
  });
}

export async function PATCH(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = modelVariantUpdateInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid model variant payload" },
      { status: 400 },
    );
  }

  const updateInput = parsed.data;
  if (
    updateInput.name === undefined &&
    updateInput.baseModelId === undefined &&
    updateInput.providerOptions === undefined
  ) {
    return Response.json(
      { error: "At least one field must be updated" },
      { status: 400 },
    );
  }

  if (
    updateInput.providerOptions !== undefined &&
    !isPlainObject(updateInput.providerOptions)
  ) {
    return Response.json(
      { error: "providerOptions must be a JSON object" },
      { status: 400 },
    );
  }

  if (updateInput.providerOptions) {
    const sizeError = validateProviderOptionsSize(updateInput.providerOptions);
    if (sizeError) {
      return Response.json({ error: sizeError }, { status: 400 });
    }
  }

  const preferences = await getUserPreferences(session.user.id);
  const variantIndex = preferences.modelVariants.findIndex(
    (variant) => variant.id === updateInput.id,
  );

  if (variantIndex < 0) {
    return Response.json({ error: "Model variant not found" }, { status: 404 });
  }

  const currentVariant = preferences.modelVariants[variantIndex];
  const updatedVariant = {
    ...currentVariant,
    ...(updateInput.name !== undefined ? { name: updateInput.name } : {}),
    ...(updateInput.baseModelId !== undefined
      ? { baseModelId: updateInput.baseModelId }
      : {}),
    ...(updateInput.providerOptions !== undefined
      ? { providerOptions: updateInput.providerOptions }
      : {}),
    updatedAt: new Date().toISOString(),
  };

  const nextVariants = [...preferences.modelVariants];
  nextVariants[variantIndex] = updatedVariant;

  const updatedPreferences = await updateUserPreferences(session.user.id, {
    modelVariants: nextVariants,
  });

  return Response.json({
    modelVariant: updatedVariant,
    modelVariants: updatedPreferences.modelVariants,
  });
}

const deleteRequestSchema = z.object({
  id: modelVariantDeleteInputSchema.shape.id,
});

export async function DELETE(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = deleteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid model variant payload" },
      { status: 400 },
    );
  }

  const preferences = await getUserPreferences(session.user.id);
  const nextVariants = preferences.modelVariants.filter(
    (variant) => variant.id !== parsed.data.id,
  );

  if (nextVariants.length === preferences.modelVariants.length) {
    return Response.json({ error: "Model variant not found" }, { status: 404 });
  }

  const updatedPreferences = await updateUserPreferences(session.user.id, {
    modelVariants: nextVariants,
  });

  return Response.json({ modelVariants: updatedPreferences.modelVariants });
}
