import { getUserFromToken } from "@/lib/db/cli-tokens";

export async function GET(req: Request) {
  // Extract Bearer token from Authorization header
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json(
      { error: "Missing or invalid authorization header" },
      { status: 401 },
    );
  }

  const token = authHeader.slice(7);

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return Response.json(
        { error: "Invalid or expired token" },
        { status: 401 },
      );
    }

    return Response.json({
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    });
  } catch (error) {
    console.error("Failed to get user from token:", error);
    return Response.json({ error: "Failed to verify token" }, { status: 500 });
  }
}
