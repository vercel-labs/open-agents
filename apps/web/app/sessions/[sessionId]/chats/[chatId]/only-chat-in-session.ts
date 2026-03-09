type ChatSummaryLike = {
  id: string;
};

export function getInitialIsOnlyChatInSession(
  sessionChats: readonly ChatSummaryLike[],
  chatId: string,
): boolean {
  return sessionChats.length === 1 && sessionChats[0]?.id === chatId;
}
