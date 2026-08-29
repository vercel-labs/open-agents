import { countChatsBySessionId } from "@/lib/db/sessions";
import { MAX_CHATS_PER_SESSION } from "@/lib/sandbox/config";

type ChatCapacityResult =
  | { ok: true }
  | {
      ok: false;
      response: Response;
    };

/**
 * Guard chat creation against the per-session chat cap. The count-then-insert
 * check is advisory (a concurrent request can race past it); the harness
 * bridge port pool, which `MAX_CHATS_PER_SESSION` mirrors, is the real
 * enforcement.
 */
export async function requireChatCapacity(
  sessionId: string,
): Promise<ChatCapacityResult> {
  const chatCount = await countChatsBySessionId(sessionId);
  if (chatCount >= MAX_CHATS_PER_SESSION) {
    return {
      ok: false,
      response: Response.json(
        {
          error: `This session already has the maximum of ${MAX_CHATS_PER_SESSION} chats`,
        },
        { status: 400 },
      ),
    };
  }

  return { ok: true };
}
