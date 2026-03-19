import { getServerSession } from "@/lib/session/get-server-session";
import { getUserVercelToken } from "@/lib/vercel/token";

const VERCEL_ENV_ROUTE_BASE_URL = "https://api.vercel.com/v10/projects";

export async function GET(
  req: Request,
  context: { params: Promise<{ idOrName: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = await getUserVercelToken(session.user.id);
  if (!token) {
    return Response.json(
      { error: "Connect Vercel to load project env vars" },
      { status: 403 },
    );
  }

  const { idOrName } = await context.params;
  const upstreamUrl = new URL(
    `${VERCEL_ENV_ROUTE_BASE_URL}/${encodeURIComponent(idOrName)}/env`,
  );
  upstreamUrl.search = new URL(req.url).searchParams.toString();

  const upstreamResponse = await fetch(upstreamUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const body = await upstreamResponse.text();

  return new Response(body, {
    status: upstreamResponse.status,
    headers: {
      "content-type":
        upstreamResponse.headers.get("content-type") ?? "application/json",
    },
  });
}
