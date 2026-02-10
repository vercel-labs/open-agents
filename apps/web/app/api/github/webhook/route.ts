import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import {
  deleteInstallationByInstallationId,
  getInstallationsByInstallationId,
  updateInstallationsByInstallationId,
  upsertInstallation,
} from "@/lib/db/installations";

const installationWebhookSchema = z.object({
  action: z.string(),
  installation: z.object({
    id: z.number(),
    repository_selection: z.enum(["all", "selected"]).optional(),
    html_url: z.string().url().nullable().optional(),
    account: z
      .object({
        login: z.string(),
        type: z.string(),
      })
      .optional(),
  }),
});

function normalizeAccountType(type: string): "User" | "Organization" {
  return type === "Organization" ? "Organization" : "User";
}

function verifySignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): boolean {
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  const expected = Buffer.from(`sha256=${digest}`);
  const provided = Buffer.from(signatureHeader);

  if (expected.length !== provided.length) {
    return false;
  }

  return timingSafeEqual(expected, provided);
}

export async function POST(req: Request): Promise<Response> {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return Response.json(
      { error: "GITHUB_WEBHOOK_SECRET is not configured" },
      { status: 500 },
    );
  }

  const event = req.headers.get("x-github-event");
  const signature = req.headers.get("x-hub-signature-256");

  if (!event || !signature) {
    return Response.json({ error: "Missing webhook headers" }, { status: 400 });
  }

  const payloadText = await req.text();
  if (!verifySignature(payloadText, signature, webhookSecret)) {
    return Response.json(
      { error: "Invalid webhook signature" },
      { status: 401 },
    );
  }

  if (event === "ping") {
    return Response.json({ ok: true });
  }

  if (event !== "installation" && event !== "installation_repositories") {
    return Response.json({ ok: true, ignored: true, event });
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payloadText);
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const parsed = installationWebhookSchema.safeParse(parsedPayload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  const installationId = parsed.data.installation.id;
  const repositorySelection = parsed.data.installation.repository_selection;
  const account = parsed.data.installation.account;
  const installationUrl = parsed.data.installation.html_url ?? null;

  if (event === "installation" && parsed.data.action === "deleted") {
    const deleted = await deleteInstallationByInstallationId(installationId);
    return Response.json({ ok: true, deleted });
  }

  if (!repositorySelection && !account) {
    return Response.json({ ok: true, ignored: true, reason: "no-updates" });
  }

  const existing = await getInstallationsByInstallationId(installationId);

  if (
    existing.length > 0 &&
    account &&
    repositorySelection &&
    (event === "installation" || event === "installation_repositories")
  ) {
    for (const row of existing) {
      await upsertInstallation({
        userId: row.userId,
        installationId,
        accountLogin: account.login,
        accountType: normalizeAccountType(account.type),
        repositorySelection,
        installationUrl,
      });
    }

    return Response.json({ ok: true, updatedUsers: existing.length });
  }

  const updated = await updateInstallationsByInstallationId(installationId, {
    ...(repositorySelection ? { repositorySelection } : {}),
    ...(installationUrl ? { installationUrl } : {}),
  });

  return Response.json({ ok: true, updatedUsers: updated });
}
