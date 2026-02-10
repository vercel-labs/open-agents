# GitHub App Migration for Per-Repository Access Control

## Problem

The app uses a GitHub OAuth App with the `repo` scope, granting **full access to all repositories**. Users have no way to limit which repos the app can access. We want users to choose between "all repositories" or "only select repositories" during setup.

## Approach

Migrate from a GitHub OAuth App to a **GitHub App**. GitHub Apps have built-in installation-level repository selection. During installation, GitHub natively shows "All repositories" vs "Only select repositories". Users can modify access anytime from GitHub Settings > Applications > Configure.

This is the same pattern used by Vercel, Netlify, Railway, etc.

### Key concept: two token types

- **User access token** (from OAuth) — for user profile, email. Low-privilege. Same OAuth flow as today, just with the GitHub App's client ID.
- **Installation access token** — generated server-side using the App's private key + installation ID. Scoped to repos where the app is installed. Short-lived (1 hour, auto-refreshed by `@octokit/auth-app`). Used for all repo operations.

---

## Phase 1: Foundation (non-breaking, additive only)

### 1.1 New environment variables

**File:** `apps/web/.env.example`

```
GITHUB_APP_ID=                     # Numeric App ID
GITHUB_APP_PRIVATE_KEY=            # PEM private key (base64-encoded for env var safety)
NEXT_PUBLIC_GITHUB_APP_SLUG=       # App slug for install URL (e.g. "open-harness")
GITHUB_WEBHOOK_SECRET=             # Webhook signature verification
```

Keep existing `NEXT_PUBLIC_GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` — GitHub Apps have their own client ID/secret for OAuth.

### 1.2 Add dependency

```bash
cd apps/web && bun add @octokit/auth-app
```

### 1.3 Database: `github_installations` table

**File:** `apps/web/lib/db/schema.ts`

```typescript
export const githubInstallations = pgTable("github_installations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  installationId: integer("installation_id").notNull(),
  accountLogin: text("account_login").notNull(),        // GitHub username or org name
  accountType: text("account_type", {
    enum: ["User", "Organization"],
  }).notNull(),
  repositorySelection: text("repository_selection", {
    enum: ["all", "selected"],
  }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("github_installations_installation_id_idx").on(table.installationId),
  uniqueIndex("github_installations_user_account_idx").on(table.userId, table.accountLogin),
]);
```

Generate migration: `cd apps/web && bunx drizzle-kit generate`

### 1.4 Installation DB operations

**New file:** `apps/web/lib/db/installations.ts`

- `upsertInstallation(data)` — create or update
- `getInstallationsByUserId(userId)` — list all for a user
- `getInstallationByAccountLogin(userId, accountLogin)` — find for a specific account
- `deleteInstallationByInstallationId(installationId)` — remove (uninstall)

### 1.5 GitHub App auth utility

**New file:** `apps/web/lib/github/app-auth.ts`

```typescript
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

// Get a short-lived installation token string
export async function getInstallationToken(installationId: number): Promise<string> {
  const auth = createAppAuth({
    appId: process.env.GITHUB_APP_ID!,
    privateKey: Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY!, "base64").toString("utf-8"),
    installationId,
  });
  const { token } = await auth({ type: "installation", installationId });
  return token;
}

// Get an Octokit instance for a specific installation
export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  // ... uses createAppAuth strategy with Octokit
}

// Get an Octokit instance authenticated as the App itself
export function getAppOctokit(): Octokit {
  // ... for listing installations, managing the app
}
```

`@octokit/auth-app` handles token caching and auto-refresh internally.

### 1.6 Token resolution utility

**New file:** `apps/web/lib/github/get-repo-token.ts`

```typescript
export async function getRepoToken(
  userId: string,
  owner: string,
): Promise<{ token: string; type: "installation" | "user" }> {
  // 1. Look up installation for this owner
  const installation = await getInstallationByAccountLogin(userId, owner);
  if (installation) {
    const token = await getInstallationToken(installation.installationId);
    return { token, type: "installation" };
  }

  // 2. Fall back to user token (backward compat during migration)
  const userToken = await getUserGitHubToken();
  if (userToken) {
    return { token: userToken, type: "user" };
  }

  throw new Error("No token available for repository access");
}
```

The fallback ensures existing OAuth users keep working while they install the GitHub App.

---

## Phase 2: Auth Flow & Installation Management

### 2.1 Update OAuth sign-in

**File:** `apps/web/app/api/auth/signin/github/route.ts`

Remove the `scope: "repo,read:org,read:user,user:email"` parameter. GitHub App OAuth doesn't use scopes — permissions are defined at the App level.

### 2.2 Update OAuth callback — sync installations

**File:** `apps/web/app/api/auth/github/callback/route.ts`

After user upsert, sync their GitHub App installations:

```typescript
const installationsRes = await fetch("https://api.github.com/user/installations", {
  headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github.v3+json" },
});
if (installationsRes.ok) {
  const data = await installationsRes.json();
  for (const inst of data.installations) {
    await upsertInstallation({
      userId,
      installationId: inst.id,
      accountLogin: inst.account.login,
      accountType: inst.account.type,
      repositorySelection: inst.repository_selection,
    });
  }
}
```

### 2.3 GitHub App installation callback

**New file:** `apps/web/app/api/github/app/callback/route.ts`

Handles redirect after user installs the GitHub App. GitHub redirects to the App's `setup_url` with `installation_id` query param. This route syncs the new installation to DB and redirects back to the app.

### 2.4 Webhook handler

**New file:** `apps/web/app/api/github/webhook/route.ts`

Handles:
- `installation.created` — upsert installation in DB
- `installation.deleted` — delete installation from DB
- `installation_repositories` — update `repositorySelection`

Verifies webhook signature with `GITHUB_WEBHOOK_SECRET`.

### 2.5 Installations API routes

**New file:** `apps/web/app/api/github/installations/route.ts`
- `GET` — returns user's installations from DB

**New file:** `apps/web/app/api/github/installations/repos/route.ts`
- `GET ?installation_id=123&query=...` — lists repos via installation token

---

## Phase 3: Migrate Repo Operations to Installation Tokens

All these files currently call `getUserGitHubToken()`. Switch to `getRepoToken(userId, owner)` for repo-scoped operations.

### 3.1 Files to update

| File | Current | New |
|------|---------|-----|
| `app/api/github/repos/route.ts` | `getUserGitHubToken()` | `getRepoToken(userId, owner)` |
| `app/api/github/branches/route.ts` | `getUserGitHubToken()` | `getRepoToken(userId, owner)` |
| `app/api/sandbox/route.ts` | `getUserGitHubToken()` | `getRepoToken(userId, owner)` — parse owner from `repoUrl` |
| `app/api/chat/route.ts` | `getUserGitHubToken()` | `getRepoToken(userId, sessionRecord.repoOwner)` |
| `lib/github/client.ts` | `getOctokit()` uses user token | Accept explicit token param |
| `app/api/github/create-repo/route.ts` | `getUserGitHubToken()` | `getRepoToken(userId, owner)` |

### 3.2 User-only routes (no change needed)

These stay on the user access token:
- `app/api/github/user/route.ts` — user profile
- `app/api/github/orgs/route.ts` — user's org memberships
- `app/api/auth/signout/route.ts` — token revocation

### 3.3 Installation token refresh in sandboxes

Installation tokens expire after 1 hour. For long-running sandboxes, the token embedded in git remote URLs goes stale.

**Mitigation:** Every chat turn (in `app/api/chat/route.ts`) already reconnects to the sandbox. After `connectSandbox()`, refresh the remote URL with a fresh token:

```typescript
if (sessionRecord.repoOwner && sessionRecord.repoName) {
  const { token } = await getRepoToken(userId, sessionRecord.repoOwner);
  const authUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  await sandbox.exec(`git remote set-url origin "${authUrl}"`, sandbox.workingDirectory, 5000);
}
```

This is lightweight and ensures every interaction has a valid token.

---

## Phase 4: UI Updates

### 4.1 Repo selector — installation-based accounts

**File:** `apps/web/components/repo-selector-compact.tsx`

Replace `fetchOwners()` (which calls `/api/github/user` + `/api/github/orgs`) with a fetch to `/api/github/installations`. Each installation represents an account where the app is installed.

The "Account" section becomes a list of installed accounts. Selecting one fetches repos via `/api/github/installations/repos?installation_id=...`.

### 4.2 "Install GitHub App" CTA

When no installations exist, or at the bottom of the account list, show:
- "Add GitHub account" link → `https://github.com/apps/{NEXT_PUBLIC_GITHUB_APP_SLUG}/installations/new`

### 4.3 "Manage access" link

Add a "Manage repository access" link that opens GitHub's app configuration page for the selected installation.

---

## Files Changed Summary

| File | Change |
|------|--------|
| `apps/web/.env.example` | Add 4 new env vars |
| `apps/web/package.json` | Add `@octokit/auth-app` |
| `apps/web/lib/db/schema.ts` | Add `githubInstallations` table |
| `apps/web/lib/db/installations.ts` | **New** — installation CRUD |
| `apps/web/lib/github/app-auth.ts` | **New** — JWT + installation token generation |
| `apps/web/lib/github/get-repo-token.ts` | **New** — token resolution with fallback |
| `apps/web/app/api/auth/signin/github/route.ts` | Remove `scope` param |
| `apps/web/app/api/auth/github/callback/route.ts` | Add installation sync after login |
| `apps/web/app/api/github/app/callback/route.ts` | **New** — post-install redirect handler |
| `apps/web/app/api/github/webhook/route.ts` | **New** — webhook handler |
| `apps/web/app/api/github/installations/route.ts` | **New** — list installations |
| `apps/web/app/api/github/installations/repos/route.ts` | **New** — list installation repos |
| `apps/web/app/api/github/repos/route.ts` | Use `getRepoToken()` |
| `apps/web/app/api/github/branches/route.ts` | Use `getRepoToken()` |
| `apps/web/app/api/sandbox/route.ts` | Use `getRepoToken()` |
| `apps/web/app/api/chat/route.ts` | Use `getRepoToken()` + refresh remote URL |
| `apps/web/lib/github/client.ts` | Accept token param in Octokit functions |
| `apps/web/app/api/github/create-repo/route.ts` | Use installation token |
| `apps/web/components/repo-selector-compact.tsx` | Installation-based account list + install CTA |

## CLI Impact

No changes needed. The CLI authenticates via device flow against the web app's own token system. The web app resolves the appropriate token server-side — transparent to the CLI.

## Prerequisites

Before implementation, create a GitHub App on GitHub.com:
1. Go to GitHub Settings > Developer settings > GitHub Apps > New GitHub App
2. Set permissions: `Contents: Read & Write`, `Pull requests: Read & Write`, `Metadata: Read`
3. Enable OAuth: check "Request user authorization (OAuth) during installation"
4. Set `setup_url` to `{YOUR_APP_URL}/api/github/app/callback`
5. Set `webhook_url` to `{YOUR_APP_URL}/api/github/webhook`
6. Generate a private key and note the App ID, Client ID, Client Secret

## Verification

1. Sign in — verify installations synced to DB
2. Install app on a test account with "Only select repositories"
3. Open repo selector — verify only granted repos appear
4. Create a session with a granted repo — verify clone works
5. Send chat messages — verify sandbox operations work with installation token
6. Try accessing a non-granted repo — verify it's not listed
7. Go to GitHub Settings > Applications > Configure — add a repo, refresh, verify it appears
8. Test sign-out and re-sign-in — verify installations persist
