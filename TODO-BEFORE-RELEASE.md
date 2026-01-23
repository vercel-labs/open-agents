# TODO Before Release

## Workflow

To work through these todos, follow this pattern:

1. Find the first pending `[ ]` item
2. Ask: "Want me to tackle this one?"
3. Research the codebase to understand the current implementation
4. Implement the solution
5. Run typecheck and lint to verify
6. Ask the user to test
7. Once confirmed working, commit the changes and mark item as `[x]`
8. Move to the next pending item

---

## Web App

### Critical

- [x] Model selector (in flight)
- [x] Add loading state in repository selection dropdown
- [x] Three dots menu is non-functional - remove or implement
- [x] Task with empty sandbox shows date - display "Untitled Workspace" with edit button instead
- [x] Remove unused "Code Review" tab from homepage
- [x] Add context window usage / token usage display in task page
- [x] Show todo list inline in chat

### Cost Optimization

- [ ] Remove Vercel Blob for saving sandbox (ingress/egress too expensive) - switch to native snapshotting

### Sandbox Setup

- [ ] Ensure pnpm install runs during sandbox setup
- [ ] Explore read-only mode that switches to full sandbox when agent needs write/execute access

### Nice to Have

- [ ] Add terminal view in tasks (terminal implementation exists elsewhere)
- [ ] Move to workspace approach (multiple chats per workspace)
- [x] Migrate from raw fetching to SWR
- [ ] explore a new package with ai related utils (e.g. predicate for sendAutomaticallyWhen etc.)

### Cancelled

- [c] Sandbox startup time - using in-memory solution instead
- [c] Explore Modal as alternative sandbox provider

---

## CLI

### Critical

- [ ] Add slash commands for changing model and context compaction approach
- [ ] Stop execution when user leaves no reason in tool execution approval
- [ ] Persist chats for resume capability
- [ ] Client-side pending approval rule propagation for batch requests
- [ ] Auth with web app

### Architecture

- [ ] Evaluate whether TUI package should remain separate or be merged into CLI app
- [ ] Explore workflows for background execution
- [ ] Explore sandbox maximum timeout with proactive shutdown after inactivity

---

## Agent

### Features

- [ ] Add plan mode

### Explored/Blocked

- [ ] Context offloading outside of current message (cc ido approach) [blocked]
- [ ] Add automatic compaction approach as a tool [explored]
- [ ] Provider defined tools dynamic switch per request [explored]

---

## Technical Debt

- [x] Align import extensions across packages - `packages/shared` uses `.js` extensions which cause issues with Next.js/Turbopack

---

## Future Ideas

- [ ] Slack App - explore using Malte's chat SDK (vercel-labs/chat)
- [ ] Documentation
