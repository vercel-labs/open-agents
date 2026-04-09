# Open Harness

Open Harness is an open-source reference app for building and running background coding agents on Vercel. It includes the web UI, the agent runtime, sandbox orchestration, and the GitHub integration needed to go from prompt to code changes without keeping your laptop involved.

The repo is meant to be forked and adapted, not treated as a black box.

## What it is

Open Harness is a three-layer system:

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
- durable multi-step execution with Workflow DevKit-backed runs
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

## What is required to run it

### Required to boot the app locally

- [Bun](https://bun.com) `1.2+`
- a PostgreSQL database
- a Vercel OAuth app for sign-in
- app secrets for session/JWE encryption

Required `apps/web/.env` values:

```env
POSTGRES_URL=
JWE_SECRET=
ENCRYPTION_KEY=
NEXT_PUBLIC_AUTH_PROVIDERS=vercel
NEXT_PUBLIC_VERCEL_APP_CLIENT_ID=
VERCEL_APP_CLIENT_SECRET=
```

### Required for the full coding-agent flow

To use the actual background-agent workflow, not just render the UI, you also need:

- a Vercel project/environment with sandbox access enabled
- workflow execution available in that project
- model access configured for the gateway-backed models you want the agent to use

In practice, most people get the project-managed env they need by linking a Vercel project locally and pulling env vars.

### Required for GitHub repo access, pushes, and PRs

If you want users to connect repos, clone private repos, push branches, or open PRs, configure both GitHub OAuth and a GitHub App.

Required env vars:

```env
NEXT_PUBLIC_GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
NEXT_PUBLIC_GITHUB_APP_SLUG=
GITHUB_WEBHOOK_SECRET=
```

### Recommended

```env
REDIS_URL=
```

Redis is used for resumable streams and stop signaling. The app can start without it, but some realtime/resume behavior is degraded.

### Optional

```env
ELEVENLABS_API_KEY=
```

This enables voice transcription.

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

4. If you want to sync project-managed env vars from Vercel instead of entering them all manually:

   ```bash
   vc link
   ./scripts/setup.sh
   ```

   `scripts/setup.sh` will:
   - install dependencies
   - create `apps/web/.env` from `.env.example` if needed
   - pull Vercel env into `.env.local`
   - sync supported values into `apps/web/.env`

5. Start the app:

   ```bash
   bun run web
   ```

## OAuth and integration setup

### Vercel OAuth

Create a Vercel OAuth app and use this callback for local development:

```text
http://localhost:3000/api/auth/vercel/callback
```

Then set:

```env
NEXT_PUBLIC_VERCEL_APP_CLIENT_ID=...
VERCEL_APP_CLIENT_SECRET=...
```

### GitHub OAuth

Create a GitHub OAuth app for account linking and use:

- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/api/github/app/callback`

Then set:

```env
NEXT_PUBLIC_GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

### GitHub App

Create a GitHub App for installation-based repo access and configure:

- Callback URL: `http://localhost:3000/api/github/app/callback`
- Setup URL: `http://localhost:3000/api/github/app/callback`
- enable "Request user authorization (OAuth) during installation"
- make the app public if you want org installs to work cleanly

Then set:

```env
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY=...
NEXT_PUBLIC_GITHUB_APP_SLUG=...
GITHUB_WEBHOOK_SECRET=...
```

## Useful commands

```bash
bun run web
bun run check
bun run typecheck
bun run ci
bun run sandbox:snapshot-base
```

If you update project env vars later, re-run:

```bash
scripts/refresh-vercel-token.sh
```

## Repo layout

```text
apps/web         Next.js app, workflows, auth, chat UI
packages/agent   agent implementation, tools, subagents, skills
packages/sandbox sandbox abstraction and Vercel sandbox integration
packages/shared  shared utilities
```
