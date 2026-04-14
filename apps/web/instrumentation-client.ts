import { initBotId } from "botid/client/core";

/**
 * Vercel BotID client-side initialization.
 *
 * Declares which routes require bot-detection challenge headers so the
 * server-side `checkBotId()` calls in each handler can verify the request.
 *
 * @see https://vercel.com/docs/botid/get-started
 */
initBotId({
  protect: [
    // AI text-generation endpoints
    { path: "/api/chat", method: "POST" },
    { path: "/api/generate-pr", method: "POST" },
    { path: "/api/generate-title", method: "POST" },
    { path: "/api/sessions/*/generate-commit-message", method: "POST" },

    // Resource-intensive endpoints
    { path: "/api/sandbox", method: "POST" },
    { path: "/api/transcribe", method: "POST" },
  ],
});
