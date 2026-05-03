import type { Session } from "@/lib/session/types";

const DEFAULT_ALLOWED_MANAGED_TEMPLATE_EMAIL_DOMAIN = "vercel.com";
const MANAGED_TEMPLATE_HOSTS = new Set([
  "open-agents.dev",
  "www.open-agents.dev",
]);
const ALLOW_ALL_EMAIL_DOMAINS = "*";

type ManagedTemplateEmailDomainAccess =
  | { type: "all" }
  | { type: "domains"; domains: Set<string> };

export const MANAGED_TEMPLATE_DEPLOY_YOUR_OWN_PATH = "/deploy-your-own";
export const MANAGED_TEMPLATE_ACCESS_DENIED_ERROR =
  "This hosted deployment only supports approved email domains. Deploy your own copy to use Open Agents with your account.";

function getManagedTemplateEmailDomainAccess(): ManagedTemplateEmailDomainAccess {
  const rawValue = process.env.MANAGED_TEMPLATE_ALLOWED_EMAIL_DOMAINS;
  const normalizedDomains = (
    rawValue ?? DEFAULT_ALLOWED_MANAGED_TEMPLATE_EMAIL_DOMAIN
  )
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  if (normalizedDomains.includes(ALLOW_ALL_EMAIL_DOMAINS)) {
    return { type: "all" };
  }

  const domains = new Set(
    normalizedDomains.length > 0
      ? normalizedDomains
      : [DEFAULT_ALLOWED_MANAGED_TEMPLATE_EMAIL_DOMAIN],
  );

  return { type: "domains", domains };
}

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

  const emailParts = normalizedEmail.split("@");
  if (emailParts.length !== 2) {
    return false;
  }

  const emailDomain = emailParts[1];
  if (!emailDomain) {
    return false;
  }

  const access = getManagedTemplateEmailDomainAccess();
  if (access.type === "all") {
    return true;
  }

  return access.domains.has(emailDomain);
}

export function getManagedTemplateAllowedEmailDomainLabel() {
  const access = getManagedTemplateEmailDomainAccess();
  if (access.type === "all") {
    return "all email domains";
  }

  const domains = [...access.domains].map((domain) => `@${domain}`);
  if (domains.length === 1) {
    return domains[0];
  }

  return `${domains.slice(0, -1).join(", ")}, or ${domains[domains.length - 1]}`;
}

export function shouldRedirectManagedTemplateUser(
  session: Pick<Session, "user"> | null | undefined,
  url: string | URL,
) {
  return (
    Boolean(session?.user) &&
    isManagedTemplateDeployment(url) &&
    !hasAllowedManagedTemplateEmail(session?.user.email)
  );
}

export function getManagedTemplateAccessDeniedResponse(
  session: Pick<Session, "user"> | null | undefined,
  url: string | URL,
) {
  if (!shouldRedirectManagedTemplateUser(session, url)) {
    return null;
  }

  return Response.json(
    { error: MANAGED_TEMPLATE_ACCESS_DENIED_ERROR },
    { status: 403 },
  );
}
