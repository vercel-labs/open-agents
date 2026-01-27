import { verifyUserCode } from "@/lib/db/cli-tokens";
import { getServerSession } from "@/lib/session/get-server-session";

interface VerifyRequestBody {
  user_code: string;
  device_name?: string;
}

export async function POST(req: Request) {
  // Require authenticated session
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: VerifyRequestBody;
  try {
    body = (await req.json()) as VerifyRequestBody;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { user_code, device_name } = body;

  if (!user_code) {
    return Response.json({ error: "user_code is required" }, { status: 400 });
  }

  try {
    const result = await verifyUserCode(
      user_code,
      session.user.id,
      device_name,
    );

    if (!result.success) {
      return Response.json({ error: result.error }, { status: 400 });
    }

    return Response.json({
      success: true,
      device_name: result.deviceName,
    });
  } catch (error) {
    console.error("Failed to verify code:", error);
    return Response.json({ error: "Failed to verify code" }, { status: 500 });
  }
}
