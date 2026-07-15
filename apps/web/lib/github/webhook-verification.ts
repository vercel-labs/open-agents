import "server-only";
import {
  type ConnectWebhookVerifier,
  createConnectWebhookVerifier,
} from "@vercel/connect/chat";

let verifier: ConnectWebhookVerifier | null = null;

/**
 * Verify a GitHub webhook forwarded by Vercel Connect trigger forwarding.
 *
 * Connect verifies the provider's native signature at its intake endpoint,
 * then re-POSTs the event to this project with a Vercel OIDC token as the
 * `Authorization` bearer. The verifier pins the issuer
 * (`https://oidc.vercel.com`) and matches the token's project and environment
 * claims against this deployment, failing closed when those are absent.
 *
 * Trust model: the accepted credential is "any Vercel OIDC token for this
 * project + environment" (e.g. one pulled via `vercel env pull`), not a
 * GitHub- or connector-specific signature like the old HMAC webhook secret.
 */
export async function verifyConnectWebhook(
  req: Request,
  body: string,
): Promise<boolean> {
  verifier ??= createConnectWebhookVerifier();

  try {
    return Boolean(await verifier(req, body));
  } catch {
    return false;
  }
}
