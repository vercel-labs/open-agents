import type { Session } from "@/lib/session/types";

const ALLOWED_VERCEL_EMAIL_DOMAIN = "vercel.com";
const MANAGED_TEMPLATE_HOSTS = new Set([
  "open-agents.dev",
  "www.open-agents.dev",
]);
const LOCAL_DEVELOPMENT_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const MANAGED_TEMPLATE_TRIAL_MESSAGE_LIMIT = 5;
export const MANAGED_TEMPLATE_TRIAL_SESSION_LIMIT = 1;
export const MANAGED_TEMPLATE_TRIAL_MESSAGE_LIMIT_ERROR =
  "This hosted deployment has a 5 message limit. Deploy your own copy for no limit at open-agents.dev/deploy-your-own.";
export const MANAGED_TEMPLATE_TRIAL_SESSION_LIMIT_ERROR =
  "This hosted deployment includes 1 trial session for non-Vercel accounts. Deploy your own copy to start more.";
export const MANAGED_TEMPLATE_TRIAL_DELETE_MESSAGE_ERROR =
  "This hosted deployment does not allow message deletion for non-Vercel trial accounts. Deploy your own copy for full controls.";
export const MANAGED_TEMPLATE_TRIAL_CODE_EDITOR_ERROR =
  "This hosted deployment does not allow the code editor for non-Vercel trial accounts. Deploy your own copy for full controls.";
export const MANAGED_TEMPLATE_TRIAL_GITHUB_SESSION_ERROR =
  "This hosted deployment does not allow GitHub-backed sessions for non-Vercel trial accounts. Start a new chat without a repository.";

function normalizeHost(value?: string | URL) {
  const rawValue =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : value?.hostname.toLowerCase();
  if (!rawValue) {
    return null;
  }

  try {
    return new URL(
      rawValue.startsWith("http://") || rawValue.startsWith("https://")
        ? rawValue
        : `https://${rawValue}`,
    ).hostname;
  } catch {
    return null;
  }
}

export function isManagedTemplateDeployment(url: string | URL) {
  const requestHost = normalizeHost(url);
  if (requestHost && MANAGED_TEMPLATE_HOSTS.has(requestHost)) {
    return true;
  }

  if (
    process.env.NODE_ENV === "development" &&
    requestHost &&
    LOCAL_DEVELOPMENT_HOSTS.has(requestHost)
  ) {
    return true;
  }

  return [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  ]
    .map((value) => normalizeHost(value))
    .some((host) => host !== null && MANAGED_TEMPLATE_HOSTS.has(host));
}

export function hasAllowedManagedTemplateEmail(email?: string) {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  const emailDomain = normalizedEmail.split("@")[1];
  return emailDomain === ALLOWED_VERCEL_EMAIL_DOMAIN;
}

export function isManagedTemplateTrialUser(
  session: Pick<Session, "authProvider" | "user"> | null | undefined,
  url: string | URL,
) {
  return (
    session?.authProvider === "vercel" &&
    isManagedTemplateDeployment(url) &&
    !hasAllowedManagedTemplateEmail(session.user.email)
  );
}
