# Plan: Chunk Resumable Stream Replay to Avoid Upstash 10 MB Limits

## Status

- Implemented
- Scope: fast safety fix only ("fix #1")

## Assumptions

- Current resume failures are caused by replay backlog being published as one large Redis `PUBLISH` payload.
- Upstash request size limits (10 MB) apply to this `PUBLISH` call and can reject oversized replay payloads.
- We want a low-risk patch that preserves existing stream semantics and does not require a persistence model redesign yet.

## Problem

Resume replay currently builds a single large string (`chunks.join("")`) and publishes it once, which can exceed Upstash limits and cause resumed clients to receive no stream content.

## Approach

Patch replay delivery to publish backlog in bounded frames instead of one message, while keeping ordering and completion signaling identical from the client perspective.

## Proposed Design

### 1) Bound replay publish size

- Introduce a conservative `MAX_REPLAY_PUBLISH_BYTES` for replay payload frames (recommended: `256 * 1024` to start).
- During replay, slice buffered data into frames at or below that cap and publish each frame sequentially to the listener channel.
- Keep existing live tail behavior unchanged (new chunks continue to publish as they are produced).

### 2) Preserve resume handshake guarantees

- If replay backlog is empty, still publish one empty frame (`""`) so the resume subscriber ack/timeout behavior remains intact.
- If stream is already complete, publish `DONE_SENTINEL` only after replay frames are published.
- Maintain strict ordering: replay frames first, then live frames, then done sentinel.

### 3) Keep fix localized

- Prefer patching upstream replay logic (`resumable-stream` runtime path) where `chunks.join("")` is currently used.
- If upstream patch cannot be consumed immediately, add a local compatibility layer in `apps/web/lib/resumable-stream-context.ts` that chunks oversized replay publishes before sending.

## File-Level Plan

- `apps/web/lib/resumable-stream-context.ts`
  - If needed for short-term mitigation, instantiate context with custom publisher/subscriber adapters and wrap `publish` with bounded replay frame logic.
- Dependency update path (if upstream patch used)
  - Bump `resumable-stream` in `apps/web/package.json` once patched release is available.

## Rollout Strategy

1. Implement chunked replay in one environment.
2. Validate resume of very large streams (>10 MB total buffered output).
3. Ship broadly after confirming no reconnect regressions.

## Validation Checklist

- Resume succeeds when buffered replay exceeds 10 MB total.
- Replayed content arrives in correct order with no dropped/duplicated frames.
- Empty replay still connects immediately (no timeout waiting for first ack).
- Completed streams still terminate correctly with done sentinel.
- Normal small replays continue to behave exactly as before.

## Observability to Add

- Replay backlog size estimate at resume time.
- Number of replay frames emitted per listener.
- Largest replay frame bytes published.
- Replay publish failures with explicit error surface (including Upstash rejection details).

## Risks and Mitigations

- Risk: frame splitting could alter boundary assumptions.
  - Mitigation: preserve byte-for-byte payload order and avoid transforming content.
- Risk: too-large frame cap still occasionally exceeds provider envelope overhead.
  - Mitigation: start conservative (`256 KB`) and increase only with measured headroom.
- Risk: local mitigation diverges from upstream behavior.
  - Mitigation: keep local wrapper minimal and remove after upstream adoption.

## Out of Scope (for this plan)

- Incremental durable event persistence for assistant output.
- Cursor-based replay (`afterSeq`) and multi-source catch-up.
- Any changes to client protocol shape.

## Next Step After This Plan

- Publish this plan as the implementation proposal.
- Create a dedicated branch for implementation and tests.
