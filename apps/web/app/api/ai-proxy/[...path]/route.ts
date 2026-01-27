import { verifyAccessToken } from "@/lib/db/cli-tokens";

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v3/ai";

// Allow streaming responses up to 5 minutes
export const maxDuration = 300;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const endpoint = path.join("/");

  // Extract and validate Bearer token
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json(
      { error: "Missing or invalid authorization header" },
      { status: 401 },
    );
  }

  const token = authHeader.slice(7);

  // Verify the token
  const verification = await verifyAccessToken(token);
  if (!verification.valid) {
    return Response.json(
      { error: verification.error || "Invalid token" },
      { status: 401 },
    );
  }

  // Forward headers (exclude hop-by-hop and our auth)
  const forwardHeaders = new Headers();
  for (const [key, value] of req.headers.entries()) {
    // Skip hop-by-hop headers and our internal auth
    if (
      [
        "host",
        "connection",
        "authorization",
        "content-length",
        "transfer-encoding",
        "x-forwarded-for",
        "x-forwarded-host",
        "x-forwarded-port",
        "x-forwarded-proto",
      ].includes(key.toLowerCase())
    ) {
      continue;
    }
    forwardHeaders.set(key, value);
  }

  const gatewayToken = process.env.VERCEL_OIDC_TOKEN;
  if (!gatewayToken) {
    return Response.json(
      { error: "Missing VERCEL_OIDC_TOKEN configuration" },
      { status: 500 },
    );
  }

  // Add the real gateway auth (OIDC token for Vercel AI Gateway)
  forwardHeaders.set("Authorization", `Bearer ${gatewayToken}`);

  try {
    // Proxy the request to the real AI Gateway
    const response = await fetch(`${AI_GATEWAY_URL}/${endpoint}`, {
      method: "POST",
      headers: forwardHeaders,
      body: req.body,
      // @ts-expect-error - duplex is needed for streaming request bodies
      duplex: "half",
      signal: req.signal,
    });

    // Return the response as-is (streaming)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    // Silently handle aborted requests (user cancelled)
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "ResponseAborted")
    ) {
      return new Response(null, { status: 499 });
    }
    throw error;
  }
}
