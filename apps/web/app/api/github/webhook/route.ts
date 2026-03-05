import { connectSandbox } from "@open-harness/sandbox";
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
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { canOperateOnSandbox, clearSandboxState } from "@/lib/sandbox/utils";

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

async function finalizeArchivedSessionSandbox(
  sessionId: string,
): Promise<void> {
  try {
    const archivedSession = await getSessionById(sessionId);
    if (!archivedSession || archivedSession.status !== "archived") {
      return;
    }
    if (!canOperateOnSandbox(archivedSession.sandboxState)) {
      return;
    }

    const sandbox = await connectSandbox(archivedSession.sandboxState);

    // Snapshot before stopping so the sandbox can be restored on unarchive.
    // snapshot() automatically stops the sandbox, so no separate stop() needed.
    let snapshotFields: {
      snapshotUrl?: string;
      snapshotCreatedAt?: Date;
    } = {};
    if (sandbox.snapshot) {
      try {
        const result = await sandbox.snapshot();
        snapshotFields = {
          snapshotUrl: result.snapshotId,
          snapshotCreatedAt: new Date(),
        };
      } catch (snapshotError) {
        console.error(
          `[GitHub webhook] Snapshot failed for archived session ${sessionId}, falling back to stop:`,
          snapshotError,
        );
        await sandbox.stop();
      }
    } else {
      await sandbox.stop();
    }

    await updateSession(sessionId, {
      ...snapshotFields,
      sandboxState: clearSandboxState(archivedSession.sandboxState),
      lifecycleState: "archived",
      sandboxExpiresAt: null,
      hibernateAfter: null,
      lifecycleError: null,
    });
  } catch (error) {
    console.error(
      `[GitHub webhook] Failed to stop sandbox for archived session ${sessionId}:`,
      error,
    );
  }
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

  const sessionsToFinalize: string[] = [];
  let updatedSessions = 0;

  for (const sessionRecord of linkedSessions) {
    const shouldArchive =
      action === "closed" && sessionRecord.status !== "archived";

    const updatePayload: Partial<{
      prStatus: "open" | "merged" | "closed" | null;
      status: "running" | "completed" | "failed" | "archived";
      lifecycleState: "archived" | null;
      sandboxExpiresAt: null;
      hibernateAfter: null;
    }> = {};

    if (sessionRecord.prStatus !== prStatus) {
      updatePayload.prStatus = prStatus;
    }

    if (shouldArchive) {
      updatePayload.status = "archived";
      updatePayload.lifecycleState = "archived";
      updatePayload.sandboxExpiresAt = null;
      updatePayload.hibernateAfter = null;
    }

    if (Object.keys(updatePayload).length > 0) {
      const updated = await updateSession(sessionRecord.id, updatePayload);
      if (updated) {
        updatedSessions += 1;
      }
    }

    if (shouldArchive) {
      sessionsToFinalize.push(sessionRecord.id);
    }
  }

  if (sessionsToFinalize.length > 0) {
    after(async () => {
      await Promise.all(
        sessionsToFinalize.map((sessionId) =>
          finalizeArchivedSessionSandbox(sessionId),
        ),
      );
    });
  }

  return Response.json({
    ok: true,
    event: "pull_request",
    action,
    prStatus,
    matchedSessions: linkedSessions.length,
    updatedSessions,
    archivedSessions: sessionsToFinalize.length,
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
