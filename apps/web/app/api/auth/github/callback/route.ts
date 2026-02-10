import { type NextRequest } from "next/server";

export async function GET(req: NextRequest): Promise<Response> {
  return Response.redirect(new URL("/", req.url));
}
