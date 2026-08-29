import type { Chat } from "@/lib/db/schema";

/**
 * The chat fields a public shared page is allowed to render.
 *
 * Every prop `SharedChatContent` receives is serialized into the RSC payload of
 * a page that needs no session to read, so this is an allowlist rather than an
 * omit-list: a new `chats` column reaches the shared page only by being added
 * here on purpose. Handing over the row itself is what leaked
 * `harnessSessionState` — an opaque external-harness resume blob that only the
 * workflow reads — to anyone holding a share link.
 */
export type PublicSharedChat = {
  id: string;
  title: string;
};

/**
 * Project a chat row down to what a public shared page may render. The
 * argument is the full row so the projection happens in one place, at the
 * boundary, instead of at every call site.
 */
export function toPublicSharedChat(chat: Chat): PublicSharedChat {
  return {
    id: chat.id,
    title: chat.title,
  };
}
