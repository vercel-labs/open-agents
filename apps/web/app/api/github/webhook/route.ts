import { createHmac, timingSafeEqual } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import {
  deleteInstallationByInstallationId,
  getInstallationsByInstallationId,
  updateInstallationsByInstallationId,
  upsertInstallation,
} from "@/lib/db/installations";
import { updateSession } from "@/lib/db/sessions";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { archiveSession } from "@/lib/sandbox/archive-session";

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

const pullRequestWebhookSchema = z.object({
  action: z.string(),
  repository: z.object({
    name: z.string(),
    owner: z.object({
      login: z.string(),
    }),
  }),
  pull_request: z.object({
    number: z.number(),
    merged: z.boolean().optional(),
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

async function handlePullRequestWebhook(
  payload: z.infer<typeof pullRequestWebhookSchema>,
): Promise<Response> {
  const action = payload.action;
  if (action !== "closed" && action !== "reopened") {
    return Response.json({ ok: true, ignored: true, action });
  }

  const repoOwner = payload.repository.owner.login;
  const repoName = payload.repository.name;
  const prNumber = payload.pull_request.number;
  const prStatus =
    action === "closed"
      ? payload.pull_request.merged
        ? "merged"
        : "closed"
      : "open";

  const linkedSessions = await db.query.sessions.findMany({
    where: and(
      sql`lower(${sessions.repoOwner}) = ${repoOwner.toLowerCase()}`,
      sql`lower(${sessions.repoName}) = ${repoName.toLowerCase()}`,
      eq(sessions.prNumber, prNumber),
    ),
  });

  if (linkedSessions.length === 0) {
    return Response.json({
      ok: true,
      event: "pull_request",
      action,
      matchedSessions: 0,
      updatedSessions: 0,
      archivedSessions: 0,
    });
  }

  let updatedSessions = 0;
  let archivedSessions = 0;

  for (const sessionRecord of linkedSessions) {
    const shouldArchive =
      action === "closed" && sessionRecord.status !== "archived";

    const updatePayload: Parameters<typeof updateSession>[1] = {};

    if (sessionRecord.prStatus !== prStatus) {
      updatePayload.prStatus = prStatus;
    }

    if (shouldArchive) {
      const archived = await archiveSession(sessionRecord.id, {
        currentSession: sessionRecord,
        update: updatePayload,
        logPrefix: "[GitHub webhook]",
        scheduleBackgroundWork: after,
      });

      if (archived.session) {
        updatedSessions += 1;
      }
      if (archived.archiveTriggered) {
        archivedSessions += 1;
      }
      continue;
    }

    if (Object.keys(updatePayload).length > 0) {
      const updated = await updateSession(sessionRecord.id, updatePayload);
      if (updated) {
        updatedSessions += 1;
      }
    }
  }

  return Response.json({
    ok: true,
    event: "pull_request",
    action,
    prStatus,
    matchedSessions: linkedSessions.length,
    updatedSessions,
    archivedSessions,
  });
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

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payloadText);
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (event === "pull_request") {
    const parsed = pullRequestWebhookSchema.safeParse(parsedPayload);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid webhook payload" },
        { status: 400 },
      );
    }

    return handlePullRequestWebhook(parsed.data);
  }

  if (event !== "installation" && event !== "installation_repositories") {
    return Response.json({ ok: true, ignored: true, event });
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

  const existing = await getInstallationsByInstallationId(installationId);

  // full upsert when we have account info and existing rows to update
  if (existing.length > 0 && account) {
    for (const row of existing) {
      await upsertInstallation({
        userId: row.userId,
        installationId,
        accountLogin: account.login,
        accountType: normalizeAccountType(account.type),
        repositorySelection: repositorySelection ?? row.repositorySelection,
        installationUrl,
      });
    }

    return Response.json({ ok: true, updatedUsers: existing.length });
  }

  // partial update with whatever fields are available
  if (!repositorySelection && !installationUrl) {
    return Response.json({ ok: true, ignored: true, reason: "no-updates" });
  }

  const updated = await updateInstallationsByInstallationId(installationId, {
    ...(repositorySelection ? { repositorySelection } : {}),
    ...(installationUrl ? { installationUrl } : {}),
  });

  return Response.json({ ok: true, updatedUsers: updated });
}
