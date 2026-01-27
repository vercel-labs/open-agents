import { type NextRequest } from "next/server";
import { startDeviceFlow, cleanupExpiredTokens } from "@/lib/db/cli-tokens";

export async function POST(req: NextRequest) {
  try {
    // Clean up expired pending tokens opportunistically (non-blocking)
    cleanupExpiredTokens().catch(() => {
      // Ignore cleanup errors
    });

    // Get the base URL for verification URI
    const origin = req.nextUrl.origin;

    const result = await startDeviceFlow(origin);

    return Response.json({
      device_code: result.deviceCode,
      user_code: result.userCode,
      verification_uri: result.verificationUri,
      verification_uri_complete: result.verificationUriComplete,
      expires_in: result.expiresIn,
      interval: result.interval,
    });
  } catch (error) {
    console.error("Failed to start device flow:", error);
    return Response.json(
      { error: "Failed to start device flow" },
      { status: 500 },
    );
  }
}
