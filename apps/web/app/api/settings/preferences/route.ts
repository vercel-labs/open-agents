import { getServerSession } from "@/lib/session/get-server-session";
import {
  getUserPreferences,
  updateUserPreferences,
} from "@/lib/db/user-preferences";
import type { SandboxType } from "@/components/sandbox-selector-compact";

interface UpdatePreferencesRequest {
  defaultModelId?: string;
  defaultSubagentModelId?: string | null;
  defaultSandboxType?: SandboxType;
  autoCommitPush?: boolean;
}

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const preferences = await getUserPreferences(session.user.id);
  return Response.json({ preferences });
}

export async function PATCH(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: UpdatePreferencesRequest;
  try {
    body = (await req.json()) as UpdatePreferencesRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate sandbox type if provided
  if (body.defaultSandboxType) {
    const validTypes = ["vercel"];
    if (!validTypes.includes(body.defaultSandboxType)) {
      return Response.json({ error: "Invalid sandbox type" }, { status: 400 });
    }
  }

  if (
    body.autoCommitPush !== undefined &&
    typeof body.autoCommitPush !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid autoCommitPush value" },
      { status: 400 },
    );
  }

  try {
    const preferences = await updateUserPreferences(session.user.id, body);
    return Response.json({ preferences });
  } catch (error) {
    console.error("Failed to update preferences:", error);
    return Response.json(
      { error: "Failed to update preferences" },
      { status: 500 },
    );
  }
}
