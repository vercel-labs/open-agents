import { type NextRequest } from "next/server";

export async function GET(req: NextRequest): Promise<Response> {
  const next = req.nextUrl.searchParams.get("next") ?? "/";
  const params = new URLSearchParams({ next });
  return Response.redirect(
    new URL(`/api/auth/signin/vercel?${params.toString()}`, req.url),
  );
}
