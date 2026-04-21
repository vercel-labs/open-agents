import { checkBotId } from "botid/server";
import { connectSandbox } from "@open-agents/sandbox";
import { gateway, generateText } from "ai";
import { botIdConfig } from "@/lib/botid";
import { getSessionById } from "@/lib/db/sessions";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

export const maxDuration = 30;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const botVerification = await checkBotId(botIdConfig);
  if (botVerification.isBot) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  const { sessionId } = await params;
  const dbSession = await getSessionById(sessionId);
  if (!dbSession || dbSession.userId !== session.user.id) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  if (!isSandboxActive(dbSession.sandboxState)) {
    return Response.json({ error: "No active sandbox" }, { status: 400 });
  }

  const sandbox = await connectSandbox(dbSession.sandboxState);
  const cwd = sandbox.workingDirectory;

  // Get the diff for commit message generation
  const diffResult = await sandbox.exec(
    "git diff HEAD --stat && echo '---DIFF---' && git diff HEAD",
    cwd,
    30000,
  );

  const diff = diffResult.stdout;
  if (!diff.trim() || !diff.includes("---DIFF---")) {
    return Response.json({ message: "chore: update repository changes" });
  }

  const result = await generateText({
    model: gateway("anthropic/claude-haiku-4.5"),
    prompt: `Generate a concise git commit message for these changes. Use conventional commit format (e.g., "feat:", "fix:", "refactor:"). One line only, max 72 characters.

Session context: ${dbSession.title}

Diff:
${diff.slice(0, 8000)}

Respond with ONLY the commit message, nothing else.`,
  });

  const generated = result.text.trim().split("\n")[0]?.trim();
  const message =
    generated && generated.length > 0
      ? generated.slice(0, 72)
      : "chore: update repository changes";

  return Response.json({ message });
}
