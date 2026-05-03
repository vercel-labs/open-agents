import { afterEach, describe, expect, test } from "bun:test";
import {
  getManagedTemplateAllowedEmailDomainLabel,
  hasAllowedManagedTemplateEmail,
  shouldRedirectManagedTemplateUser,
} from "./managed-template-access";

const originalAllowedDomains =
  process.env.MANAGED_TEMPLATE_ALLOWED_EMAIL_DOMAINS;

const hostedUrl = "https://open-agents.dev/sessions";
const selfHostedUrl = "https://example.com/sessions";

const exampleSession = {
  user: {
    id: "user-1",
    username: "person",
    email: "person@example.com",
    avatar: "",
  },
};

afterEach(() => {
  if (originalAllowedDomains === undefined) {
    delete process.env.MANAGED_TEMPLATE_ALLOWED_EMAIL_DOMAINS;
    return;
  }

  process.env.MANAGED_TEMPLATE_ALLOWED_EMAIL_DOMAINS = originalAllowedDomains;
});

describe("managed template access", () => {
  test("defaults to allowing vercel.com email addresses", () => {
    delete process.env.MANAGED_TEMPLATE_ALLOWED_EMAIL_DOMAINS;

    expect(hasAllowedManagedTemplateEmail("person@vercel.com")).toBe(true);
    expect(hasAllowedManagedTemplateEmail("person@example.com")).toBe(false);
    expect(getManagedTemplateAllowedEmailDomainLabel()).toBe("@vercel.com");
  });

  test("supports comma-separated allowed email domains", () => {
    process.env.MANAGED_TEMPLATE_ALLOWED_EMAIL_DOMAINS =
      "vercel.com, example.com";

    expect(hasAllowedManagedTemplateEmail("person@vercel.com")).toBe(true);
    expect(hasAllowedManagedTemplateEmail("person@example.com")).toBe(true);
    expect(hasAllowedManagedTemplateEmail("person@acme.com")).toBe(false);
    expect(getManagedTemplateAllowedEmailDomainLabel()).toBe(
      "@vercel.com, or @example.com",
    );
  });

  test("supports star to allow every email domain", () => {
    process.env.MANAGED_TEMPLATE_ALLOWED_EMAIL_DOMAINS = "*";

    expect(hasAllowedManagedTemplateEmail("person@example.com")).toBe(true);
    expect(shouldRedirectManagedTemplateUser(exampleSession, hostedUrl)).toBe(
      false,
    );
    expect(getManagedTemplateAllowedEmailDomainLabel()).toBe(
      "all email domains",
    );
  });

  test("redirects only disallowed users on the managed deployment", () => {
    delete process.env.MANAGED_TEMPLATE_ALLOWED_EMAIL_DOMAINS;

    expect(shouldRedirectManagedTemplateUser(exampleSession, hostedUrl)).toBe(
      true,
    );
    expect(
      shouldRedirectManagedTemplateUser(exampleSession, selfHostedUrl),
    ).toBe(false);
  });
});
