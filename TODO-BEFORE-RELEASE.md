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

### Performance
- [ ] Sandbox startup time is too slow - add warming (start sandbox when user starts typing)
- [ ] Explore Modal as alternative sandbox provider (reportedly faster)

### Cost Optimization
- [ ] Remove Vercel Blob for saving sandbox (ingress/egress too expensive) - switch to native snapshotting

### Sandbox Setup
- [ ] Ensure pnpm install runs during sandbox setup

### Nice to Have
- [ ] Add terminal view in tasks (terminal implementation exists elsewhere)
- [ ] Move to workspace approach (multiple chats per workspace)
- [ ] Migrate from raw fetching to SWR

## CLI

### Critical
- [ ] Add slash commands for:
  - Changing model
  - Changing context compaction approach (auto compaction vs open code approach)
- [ ] Stop execution when user leaves no reason in tool execution approval (instead of continuing)
- [ ] Persist chats for resume capability
- [ ] Client-side pending approval rule propagation: When the model generates multiple approval requests in the same batch (e.g., two file edits in the same directory), approving the first one with a rule should apply to remaining pending approvals in that batch, not just follow-up requests

### Architecture
- [ ] Evaluate whether TUI package should remain separate or be merged into CLI app

### Nice to Have
- [ ] Add auth flow to authenticate with web app

## Agent

### Features
- [ ] Add plan mode
- [ ] Add automatic compaction approach as a tool

## Slack App (New)

- [ ] Explore using Malte's chat SDK (vercel-labs/chat) for Slack interface
