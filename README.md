# Open Agents

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?project-name=open-agents&repository-name=open-agents&repository-url=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Fopen-agents&demo-title=Open+Agents&demo-description=Open-source+reference+app+for+building+and+running+background+coding+agents+on+Vercel.&demo-url=https%3A%2F%2Fopen-agents.dev%2F&env=POSTGRES_URL%2CBETTER_AUTH_SECRET%2CNEXT_PUBLIC_VERCEL_APP_CLIENT_ID%2CVERCEL_APP_CLIENT_SECRET%2CNEXT_PUBLIC_GITHUB_CLIENT_ID%2CGITHUB_CLIENT_SECRET%2CGITHUB_APP_ID%2CGITHUB_APP_PRIVATE_KEY%2CNEXT_PUBLIC_GITHUB_APP_SLUG%2CGITHUB_WEBHOOK_SECRET&envDescription=Neon+can+provide+POSTGRES_URL+automatically.+Generate+BETTER_AUTH_SECRET+yourself%2C+then+add+your+Vercel+OAuth+and+GitHub+App+credentials+for+a+full+deployment.&products=%255B%257B%2522type%2522%253A%2522integration%2522%252C%2522protocol%2522%253A%2522storage%2522%252C%2522productSlug%2522%253A%2522neon%2522%252C%2522integrationSlug%2522%253A%2522neon%2522%257D%252C%257B%2522type%2522%253A%2522integration%2522%252C%2522protocol%2522%253A%2522storage%2522%252C%2522productSlug%2522%253A%2522upstash-kv%2522%252C%2522integrationSlug%2522%253A%2522upstash%2522%257D%255D&skippable-integrations=1)

Open Agents is an open-source reference app for building and running background coding agents on Vercel. It includes the web UI, the agent runtime, sandbox orchestration, and the GitHub integration needed to go from prompt to code changes without keeping your laptop involved.

The repo is meant to be forked and adapted, not treated as a black box.

## What it is

Open Agents is a three-layer system:

```text
Web -> Agent workflow -> Sandbox VM
```

- The web app handles auth, sessions, chat, and streaming UI.
- The agent runs as a durable workflow on Vercel.
- The sandbox is the execution environment: filesystem, shell, git, dev servers, and preview ports.

### The key architectural decision: the agent is not the sandbox

The agent does not run inside the VM. It runs outside the sandbox and interacts with it through tools like file reads, edits, search, and shell commands.

That separation is the main point of the project:

- agent execution is not tied to a single request lifecycle
- sandbox lifecycle can hibernate and resume independently
- model/provider choices and sandbox implementation can evolve separately
- the VM stays a plain execution environment instead of becoming the control plane

## Current capabilities

- chat-driven coding agent with file, search, shell, task, skill, and web tools
- durable multi-step execution with Workflow SDK-backed runs, streaming, and cancellation
- isolated Vercel sandboxes with snapshot-based resume
- repo cloning and branch work inside the sandbox
- optional auto-commit, push, and PR creation after a successful run
- session sharing via read-only links
- optional voice input via ElevenLabs transcription

## Runtime notes

A few details that matter for understanding the current implementation:

- Chat requests start a workflow run instead of executing the agent inline.
- Each agent turn can continue across many persisted workflow steps.
- Active runs can be resumed by reconnecting to the stream for the existing workflow.
- Sandboxes use a base snapshot, expose ports `3000`, `5173`, `4321`, and `8000`, and hibernate after inactivity.
- Auto-commit and auto-PR are supported, but they are preference-driven features, not always-on behavior.

## Environment variables

See `apps/web/.env.example` for the full list. Summary:

### Minimum runtime

```env
POSTGRES_URL=
BETTER_AUTH_SECRET=
```

### Required for sign-in (Vercel OAuth)

```env
NEXT_PUBLIC_VERCEL_APP_CLIENT_ID=
VERCEL_APP_CLIENT_SECRET=
```

### Required for GitHub repo access, pushes, and PRs

```env
NEXT_PUBLIC_GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
NEXT_PUBLIC_GITHUB_APP_SLUG=
GITHUB_WEBHOOK_SECRET=
```

### Optional

```env
REDIS_URL=                                      # skills metadata cache (falls back to in-memory)
KV_URL=                                         # Vercel KV cache (falls back to in-memory)
VERCEL_PROJECT_PRODUCTION_URL=                  # canonical production URL
NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL=      # public canonical production URL
VERCEL_SANDBOX_BASE_SNAPSHOT_ID=                # override default sandbox snapshot
ELEVENLABS_API_KEY=                             # voice transcription
```

## Deploy your own copy on Vercel

1. Fork this repo.
2. Import the repo into Vercel. Neon Postgres is auto-provisioned if you use the deploy button above.
3. Generate a secret for session signing:

   ```bash
   openssl rand -base64 32   # BETTER_AUTH_SECRET
   ```

4. Add env vars in Vercel project settings:

   ```env
   POSTGRES_URL=
   BETTER_AUTH_SECRET=
   ```

5. Deploy once to get a stable production URL.
6. Create a Vercel OAuth app with callback URL:

   ```text
   https://YOUR_DOMAIN/api/auth/callback/vercel
   ```

7. Add these env vars and redeploy:

   ```env
   NEXT_PUBLIC_VERCEL_APP_CLIENT_ID=
   VERCEL_APP_CLIENT_SECRET=
   ```

8. If you want the full GitHub-enabled coding-agent flow, create a GitHub App using:

   - Homepage URL: `https://YOUR_DOMAIN`
   - Callback URL: `https://YOUR_DOMAIN/api/auth/callback/github`
   - Setup URL: `https://YOUR_DOMAIN/api/github/app/callback`

   In the GitHub App settings:
   - use the GitHub App's Client ID and Client Secret for `NEXT_PUBLIC_GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
   - make the app public if you want org installs to work cleanly

9. Add the GitHub App env vars and redeploy.
10. Optionally add Redis/KV and the canonical production URL vars.

## Local setup

1. Install dependencies:

   ```bash
   bun install
   ```

2. Create your local env file:

   ```bash
   cp apps/web/.env.example apps/web/.env
   ```

3. Fill in the required values in `apps/web/.env`.
4. Start the app:

   ```bash
   bun run web
   ```

If you already have a linked Vercel project, you can pull env vars locally with `vc env pull`.

## OAuth and integration setup

### Vercel OAuth

Authentication is handled by [Better Auth](https://www.better-auth.com/) with Vercel and GitHub as social providers. All auth routes are served from the `/api/auth/[...all]` catchall.

Create a Vercel OAuth app and use this callback:

```text
https://YOUR_DOMAIN/api/auth/callback/vercel
```

For local development, use:

```text
http://localhost:3000/api/auth/callback/vercel
```

Then set:

```env
NEXT_PUBLIC_VERCEL_APP_CLIENT_ID=...
VERCEL_APP_CLIENT_SECRET=...
```

### GitHub App

You do not need a separate GitHub OAuth app. Open Agents uses the GitHub App's OAuth credentials as a Better Auth social provider, plus the App's installation tokens for repo access.

Create a GitHub App for installation-based repo access and configure:

- Homepage URL: `https://YOUR_DOMAIN`
- Callback URL: `https://YOUR_DOMAIN/api/auth/callback/github`
- Setup URL: `https://YOUR_DOMAIN/api/github/app/callback`
- make the app public if you want org installs to work cleanly

For local development, use `http://localhost:3000` as the homepage URL, `http://localhost:3000/api/auth/callback/github` as the callback URL, and `http://localhost:3000/api/github/app/callback` as the setup URL.

Then set:

```env
NEXT_PUBLIC_GITHUB_CLIENT_ID=...   # GitHub App Client ID
GITHUB_CLIENT_SECRET=...           # GitHub App Client Secret
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY=...
NEXT_PUBLIC_GITHUB_APP_SLUG=...
GITHUB_WEBHOOK_SECRET=...
```

`GITHUB_APP_PRIVATE_KEY` can be stored as the PEM contents with escaped newlines or as a base64-encoded PEM.

## Useful commands

```bash
bun run web                # run dev server
bun run check              # lint + format check
bun run fix                # lint + format fix
bun run typecheck          # typecheck all packages
bun run ci                 # full CI: check, typecheck, tests, migration check
bun run sandbox:snapshot-base  # refresh sandbox base snapshot
```

## Repo layout

```text
apps/web         Next.js app, workflows, auth, chat UI
packages/agent   agent implementation, tools, subagents, skills
packages/sandbox sandbox abstraction and Vercel sandbox integration
packages/shared  shared utilities
```
