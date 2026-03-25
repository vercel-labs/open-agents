const PERSONAL_EMAIL_DOMAINS = new Set([
  "aol.com",
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mac.com",
  "me.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
]);

const VERIFIED_USAGE_LEADERBOARD_DOMAINS = new Set(["vercel.com"]);

/**
 * Returns the email domain when the user is eligible for the internal
 * leaderboard, or `null` otherwise. This is a pure function with no DB
 * dependencies so it can be safely used on both server and client.
 */
export function getUsageLeaderboardDomain(
  email: string | null | undefined,
): string | null {
  if (!email) {
    return null;
  }

  const trimmedEmail = email.trim().toLowerCase();
  const atIndex = trimmedEmail.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmedEmail.length - 1) {
    return null;
  }

  const domain = trimmedEmail.slice(atIndex + 1);
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) {
    return null;
  }

  if (!VERIFIED_USAGE_LEADERBOARD_DOMAINS.has(domain)) {
    return null;
  }

  return domain;
}
