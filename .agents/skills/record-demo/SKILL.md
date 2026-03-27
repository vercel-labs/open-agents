---
name: record-demo
description: Records polished demo videos of web applications using agent-browser. Use when the user asks to record a demo, screencast, walkthrough, or video of a web app. Triggers on "record demo", "demo video", "screencast", "record a walkthrough", "/record-demo".
allowed-tools: Bash(agent-browser:*),Read,Write,Edit
---

# Demo Recording with agent-browser

Record polished `.webm` demo videos of web applications running in the sandbox.

## Principles

- **Minimize dead time** — chain commands with `&&` so tool-call overhead stays out of the video.
- **Visible cursor** — headless Playwright has no cursor; inject a fake one via DOM.
- **One chain per page** — navigation destroys the DOM cursor, so re-inject after every page change.
- **No `sleep` calls** — tool execution provides enough natural pacing.

---

## Step-by-step process

### 1. Set up the page BEFORE recording

Navigate and snapshot **before** `record start`. Any time after recording starts is in the video.

```bash
agent-browser open <url>
```
```bash
agent-browser snapshot -i
```

Review the snapshot to identify element refs (`@e1`, `@e2`, …) and plan the interaction sequence.

### 2. Find element coordinates for mouse moves

Use `getBoundingClientRect()` to find the (x, y) center of each element you plan to interact with. Do this **before** recording starts so the lookup doesn't appear in the video.

```bash
agent-browser eval "(() => {
  const el = document.querySelector('<selector>');
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) });
})()"
```

### 3. Inject the visible cursor

Inject a red dot that follows mouse events. **Re-inject after every navigation** — page transitions destroy it.

```bash
agent-browser eval "(() => {
  const c = document.createElement('div');
  c.style.cssText = 'width:20px;height:20px;border-radius:50%;background:rgba(255,50,50,0.85);position:fixed;top:290px;left:390px;z-index:999999;pointer-events:none;transition:top 0.15s ease,left 0.15s ease;box-shadow:0 0 8px rgba(255,50,50,0.5);';
  document.body.appendChild(c);
  document.addEventListener('mousemove', e => {
    c.style.top=(e.clientY-10)+'px';
    c.style.left=(e.clientX-10)+'px';
  });
})(); 'ok'"
```

### 4. Record with chained commands

Start recording, perform all actions on the current page, and either navigate or stop — all in **one `&&` chain** to eliminate dead time between tool calls.

```bash
agent-browser record start ./demo.webm && agent-browser eval "<inject cursor>" && agent-browser mouse move <x> <y> && agent-browser click @e1 && agent-browser mouse move <x2> <y2> && agent-browser click @e2 && agent-browser record stop
```

#### Multi-page structure

Use one chain per page. The recording persists across chains — only stop it in the final chain.

```bash
# Chain 1 — first page → click navigates away
agent-browser record start ./demo.webm && agent-browser eval "<inject cursor>" && agent-browser mouse move 400 300 && agent-browser click @e5
```

```bash
# Chain 2 — new page → finish
agent-browser eval "<inject cursor>" && agent-browser mouse move 200 150 && agent-browser click @e3 && agent-browser scroll down 200 && agent-browser record stop
```

### 5. Use `mouse move` before every click

Always move the cursor to the target element before clicking so viewers can follow the action:

```bash
agent-browser mouse move 623 52 && agent-browser click @e5
```

### 6. Serve the result

Copy the `.webm` into the project's `public/` directory, create a minimal viewer page, and share the sandbox URL.

```bash
mkdir -p public && cp demo.webm public/demo.webm
```

Create a viewer page (e.g. `public/demo.html`):

```html
<!DOCTYPE html>
<html>
<head><title>Demo</title></head>
<body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#111">
  <video controls autoplay style="max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.5)" src="/demo.webm"></video>
</body>
</html>
```

Then share the sandbox URL pointing to the viewer page.

---

## Quick-reference checklist

1. `open` + `snapshot -i` — before recording
2. `eval getBoundingClientRect()` — get coordinates for mouse moves
3. `eval` inject cursor — at the start of each page
4. `record start` — begins the video
5. `mouse move` → `click` — for every interaction
6. `record stop` — ends the video
7. Copy to `public/`, create viewer, share URL

## Common mistakes to avoid

- **Starting the recording before the page is ready** — navigate and wait first.
- **Forgetting to re-inject the cursor after navigation** — the DOM element is gone.
- **Using separate tool calls instead of `&&` chains** — adds seconds of blank screen.
- **Using `sleep`** — unnecessary; tool execution provides natural pacing.
- **Forgetting `mouse move`** — clicks without visible cursor movement look jarring.
