const USERNAME_FALLBACK = "user";

function getNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getEmailLocalPart(email: string): string | null {
  const localPart = email.split("@", 1)[0]?.trim();
  return localPart ? localPart : null;
}

export function normalizeAuthUsername(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");

  return normalized || USERNAME_FALLBACK;
}

export function deriveAuthUsername(user: Record<string, unknown>): string {
  const explicitUsername = getNonEmptyString(user.username);
  if (explicitUsername) {
    return normalizeAuthUsername(explicitUsername);
  }

  const preferredUsername =
    getNonEmptyString(user.preferredUsername) ??
    getNonEmptyString(user.preferred_username);
  if (preferredUsername) {
    return normalizeAuthUsername(preferredUsername);
  }

  const email = getNonEmptyString(user.email);
  if (email) {
    const localPart = getEmailLocalPart(email);
    if (localPart) {
      return normalizeAuthUsername(localPart);
    }
  }

  const name = getNonEmptyString(user.name);
  if (name) {
    return normalizeAuthUsername(name);
  }

  const id = getNonEmptyString(user.id);
  if (id) {
    return normalizeAuthUsername(`user-${id.slice(0, 12)}`);
  }

  return USERNAME_FALLBACK;
}
