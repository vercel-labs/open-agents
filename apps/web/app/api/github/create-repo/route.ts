import { getServerSession } from "@/lib/session/get-server-session";

// Allow up to 2 minutes for git operations
export const maxDuration = 120;

export async function POST(req: Request) {
  // 1. Validate session
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  return Response.json(
    {
      error:
        "Creating repositories from Open Agents is temporarily disabled. Create the repository on GitHub first, then connect it to a session.",
    },
    { status: 501 },
  );
}
