import { pollForToken } from "@/lib/db/cli-tokens";

interface TokenRequestBody {
  device_code: string;
  grant_type?: string;
}

export async function POST(req: Request) {
  let body: TokenRequestBody;
  try {
    body = (await req.json()) as TokenRequestBody;
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const { device_code } = body;

  if (!device_code) {
    return Response.json(
      {
        error: "invalid_request",
        error_description: "device_code is required",
      },
      { status: 400 },
    );
  }

  try {
    const result = await pollForToken(device_code);

    switch (result.status) {
      case "pending":
        // OAuth 2.0 Device Flow standard response for pending authorization
        return Response.json(
          { error: "authorization_pending" },
          { status: 400 },
        );

      case "expired":
        return Response.json(
          {
            error: "expired_token",
            error_description: "Device code has expired",
          },
          { status: 400 },
        );

      case "active":
        return Response.json({
          access_token: result.accessToken,
          token_type: "Bearer",
          expires_in: result.expiresAt
            ? Math.floor((result.expiresAt.getTime() - Date.now()) / 1000)
            : null,
        });

      case "error":
        return Response.json(
          { error: "access_denied", error_description: result.error },
          { status: 400 },
        );
    }
  } catch (error) {
    console.error("Failed to poll for token:", error);
    return Response.json(
      { error: "server_error", error_description: "Failed to process request" },
      { status: 500 },
    );
  }
}
