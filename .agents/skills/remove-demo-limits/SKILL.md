---
name: remove-demo-limits
description: Removes Open Harness hosted demo restrictions from a fork. Use when a maintainer wants to remove managed-template trial caps, hosted deployment gating, or "deploy your own" limits. Triggers on "remove demo limits", "remove trial limits", "remove hosted restrictions", "open this up for my fork", "remove managed template restrictions".
---

Remove the managed-template hosted access restrictions with the smallest coherent change.

## Goal
Make the fork behave like a normal self-hosted deployment:
- no hosted email-domain allowlist
- no deploy-your-own redirect for signed-in users
- no hosted-only restriction errors
- no dead helper code or stale tests

## Inspect first
Read these files before editing:
- `apps/web/lib/managed-template-access.ts`
- `apps/web/app/api/sessions/route.ts`
- `apps/web/app/api/chat/route.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]/route.ts`
- `apps/web/app/api/sessions/route.test.ts`
- `apps/web/app/api/chat/route.test.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]/route.test.ts`

Then search for these identifiers and strings to catch older or newer variants:
- `shouldRedirectManagedTemplateUser`
- `MANAGED_TEMPLATE_`
- `deploy-your-own`
- `open-agents.dev`
- `vercel.com`
- `This hosted deployment only supports approved email domains`

## Required changes
1. Remove guards that redirect or block signed-in users for managed-template access.
2. If auth/session helpers still block non-allowed emails on hosted deployments, remove that restriction too.
3. Delete `apps/web/lib/managed-template-access.ts` if it becomes unused; otherwise simplify it so no dead exports remain.
4. Remove or update tests that assert hosted-only auth gating.
5. Do not add feature flags, env toggles, or new dependencies. Prefer deleting the restriction code outright.
6. Keep unrelated auth, session ownership, and sandbox behavior unchanged.

## Verification
This repo uses Bun. After the edits:
- run `bun run ci`
- if a failure is pre-existing, say that clearly and separate it from your changes

## Output
Report:
- which restrictions were removed
- which files changed
- verification result
