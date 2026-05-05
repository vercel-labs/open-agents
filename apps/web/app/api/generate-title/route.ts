import { checkBotProtection } from "@/lib/botid";
import { gateway, generateText } from "ai";
import { z } from "zod";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getServerSession } from "@/lib/session/get-server-session";

/**
 * Generates a short, descriptive session title from a user message using AI.
 *
 * Can be called directly as a POST endpoint or used internally via
 * `generateSessionTitle()` for non-blocking server-side usage.
 */
export async function generateSessionTitle(
  message: string,
): Promise<string | null> {
  const trimmed = message.trim().slice(0, 2000);
  if (trimmed.length === 0) return null;

  try {
    const result = await generateText({
      model: gateway("anthropic/claude-haiku-4.5"),
      prompt: `You are a developer tool that names coding sessions. Generate a concise title (max 5 words) for a coding session based on the user's first message below. The title should help the user quickly identify what this session is about at a glance. Do NOT use quotes or punctuation around the title. Respond with ONLY the title, nothing else.

User message:
${trimmed}`,
    });

    const title = result.text.trim().split("\n")[0]?.trim();
    if (title && title.length > 0) {
      return title.slice(0, 60);
    }
    return null;
  } catch (error) {
    console.error("[generate-title] Failed to generate title:", error);
    return null;
  }
}

const generateTitleRequestSchema = z.object({
  message: z.string().trim().min(1),
});

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const botVerification = await checkBotProtection();
  if (botVerification.isBot) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  const limited = checkRateLimit({
    key: rateLimitKey(["generate-title", session.user.id]),
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsedBody = generateTitleRequestSchema.safeParse(body);

  if (!parsedBody.success) {
    return Response.json(
      { error: "Missing required field: message" },
      { status: 400 },
    );
  }

  const { message } = parsedBody.data;

  const title = await generateSessionTitle(message);

  if (!title) {
    return Response.json(
      { error: "Failed to generate title" },
      { status: 500 },
    );
  }

  return Response.json({ title });
}
