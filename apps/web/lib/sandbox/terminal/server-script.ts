export const TERMINAL_SERVER_VERSION = "2026-03-24-dist-assets-v2";

const TERMINAL_PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0"
    />
    <title>Session Terminal</title>
    <style>
      :root {
        color-scheme: dark;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: #09090b;
        color: #fafafa;
      }

      .shell {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
      }

      .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        padding: 12px 16px;
        background: rgba(9, 9, 11, 0.96);
        backdrop-filter: blur(12px);
      }

      .title {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.01em;
      }

      .status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: #a1a1aa;
        font-size: 12px;
      }

      .status::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #f59e0b;
        box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
      }

      .status[data-state="connected"]::before {
        background: #22c55e;
        box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
      }

      .status[data-state="error"]::before,
      .status[data-state="disconnected"]::before {
        background: #f43f5e;
        box-shadow: 0 0 0 2px rgba(244, 63, 94, 0.2);
      }

      #terminal {
        flex: 1;
        min-height: 0;
        padding: 12px;
        overflow: hidden;
      }

      #terminal canvas {
        display: block;
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="toolbar">
        <div class="title">Session Terminal</div>
        <div class="status" data-state="connecting" id="terminal-status">
          Connecting…
        </div>
      </div>
      <div id="terminal"></div>
    </div>

    <script type="module">
      import { FitAddon, Terminal, init } from "/dist/ghostty-web.js";

      const statusElement = document.getElementById("terminal-status");
      const terminalContainer = document.getElementById("terminal");
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const token = hashParams.get("token");

      function setStatus(label, state) {
        statusElement.textContent = label;
        statusElement.dataset.state = state;
      }

      if (!token) {
        setStatus("Missing token", "error");
        throw new Error("Missing terminal token");
      }

      await init();

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily:
          'Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        scrollback: 10000,
        theme: {
          background: "#09090b",
          foreground: "#fafafa",
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      await term.open(terminalContainer);
      fitAddon.fit();
      fitAddon.observeResize();

      let socket;
      let reconnectTimeoutId = null;

      function clearReconnectTimeout() {
        if (reconnectTimeoutId !== null) {
          window.clearTimeout(reconnectTimeoutId);
          reconnectTimeoutId = null;
        }
      }

      function scheduleReconnect() {
        clearReconnectTimeout();
        reconnectTimeoutId = window.setTimeout(() => {
          reconnectTimeoutId = null;
          connect();
        }, 1500);
      }

      function buildWebSocketUrl() {
        const protocol =
          window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = new URL(
          protocol + "//" + window.location.host + "/ws",
        );
        url.searchParams.set("cols", String(term.cols));
        url.searchParams.set("rows", String(term.rows));
        url.searchParams.set("token", token);
        return url.toString();
      }

      function connect() {
        setStatus("Connecting…", "connecting");
        socket = new WebSocket(buildWebSocketUrl());

        socket.addEventListener("open", () => {
          setStatus("Connected", "connected");
        });

        socket.addEventListener("message", (event) => {
          term.write(event.data);
        });

        socket.addEventListener("error", () => {
          setStatus("Connection error", "error");
        });

        socket.addEventListener("close", () => {
          setStatus("Reconnecting…", "disconnected");
          scheduleReconnect();
        });
      }

      term.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(data);
        }
      });

      term.onResize(({ cols, rows }) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });

      window.addEventListener("resize", () => {
        fitAddon.fit();
      });

      window.addEventListener("beforeunload", () => {
        clearReconnectTimeout();
        socket?.close();
      });

      connect();
    </script>
  </body>
</html>
`;

const TERMINAL_SERVER_SCRIPT_LINES = [
  'import { createReadStream, existsSync, readFileSync } from "node:fs";',
  'import { createServer } from "node:http";',
  'import path from "node:path";',
  'import pty from "@lydell/node-pty";',
  'import { WebSocketServer } from "ws";',
  "",
  'const PORT = Number(process.env.OPEN_HARNESS_TERMINAL_PORT ?? "7681");',
  'const WORKING_DIRECTORY = process.env.OPEN_HARNESS_TERMINAL_CWD ?? "/vercel/sandbox";',
  'const TOKEN_FILE = process.env.OPEN_HARNESS_TERMINAL_TOKEN_FILE ?? "/tmp/open-harness-terminal/token";',
  'const DIST_DIR = path.join(process.cwd(), "node_modules", "ghostty-web", "dist");',
  'const GHOSTTY_WASM_PATH = path.join(process.cwd(), "node_modules", "ghostty-web", "ghostty-vt.wasm");',
  `const SERVER_VERSION = ${JSON.stringify(TERMINAL_SERVER_VERSION)};`,
  `const INDEX_HTML = ${JSON.stringify(TERMINAL_PAGE_HTML)};`,
  "",
  "const MIME_TYPES = new Map([",
  '  [".js", "application/javascript; charset=utf-8"],',
  '  [".css", "text/css; charset=utf-8"],',
  '  [".wasm", "application/wasm"],',
  '  [".html", "text/html; charset=utf-8"],',
  "]);",
  "const COMMON_HEADERS = {",
  '  "Access-Control-Allow-Origin": "*",',
  '  "Cross-Origin-Resource-Policy": "cross-origin",',
  "};",
  "",
  "function sendJson(res, statusCode, payload) {",
  "  res.writeHead(statusCode, {",
  "    ...COMMON_HEADERS,",
  '    "Cache-Control": "no-store",',
  '    "Content-Type": "application/json; charset=utf-8",',
  "  });",
  "  res.end(JSON.stringify(payload));",
  "}",
  "",
  "function serveFile(res, filePath) {",
  "  const extension = path.extname(filePath);",
  '  const contentType = MIME_TYPES.get(extension) ?? "application/octet-stream";',
  "  if (!existsSync(filePath)) {",
  "    res.writeHead(404, {",
  "      ...COMMON_HEADERS,",
  '      "Content-Type": "text/plain; charset=utf-8",',
  "    });",
  '    res.end("Not Found");',
  "    return;",
  "  }",
  "  res.writeHead(200, {",
  "    ...COMMON_HEADERS,",
  '    "Cache-Control": extension === ".wasm" ? "public, max-age=3600" : "no-store",',
  '    "Content-Type": contentType,',
  "  });",
  "  createReadStream(filePath).pipe(res);",
  "}",
  "",
  "function getToken() {",
  "  try {",
  '    return readFileSync(TOKEN_FILE, "utf8").trim();',
  "  } catch {",
  '    return "";',
  "  }",
  "}",
  "",
  "function isAuthorized(token) {",
  "  const expectedToken = getToken();",
  "  return expectedToken.length > 0 && token === expectedToken;",
  "}",
  "",
  "function clampSize(value, fallback, max) {",
  '  const parsed = Number.parseInt(value ?? "", 10);',
  "  if (!Number.isFinite(parsed) || parsed <= 0) {",
  "    return fallback;",
  "  }",
  "  return Math.min(parsed, max);",
  "}",
  "",
  "function getShell() {",
  '  return process.env.SHELL || "/bin/bash";',
  "}",
  "",
  "const server = createServer((req, res) => {",
  '  const host = req.headers.host ?? ("127.0.0.1:" + PORT);',
  '  const url = new URL(req.url ?? "/", "http://" + host);',
  '  if (url.pathname === "/health") {',
  "    sendJson(res, 200, { ok: true, version: SERVER_VERSION });",
  "    return;",
  "  }",
  '  if (url.pathname === "/" || url.pathname === "/index.html") {',
  "    res.writeHead(200, {",
  "      ...COMMON_HEADERS,",
  '      "Cache-Control": "no-store",',
  '      "Content-Type": "text/html; charset=utf-8",',
  "    });",
  "    res.end(INDEX_HTML);",
  "    return;",
  "  }",
  '  if (url.pathname.startsWith("/dist/")) {',
  "    const distRoot = path.resolve(DIST_DIR);",
  '    const requestedDistPath = url.pathname.slice("/dist/".length);',
  "    const resolvedDistPath = path.resolve(distRoot, requestedDistPath);",
  "    if (resolvedDistPath !== distRoot && !resolvedDistPath.startsWith(distRoot + path.sep)) {",
  "      res.writeHead(403, {",
  "        ...COMMON_HEADERS,",
  '        "Content-Type": "text/plain; charset=utf-8",',
  "      });",
  '      res.end("Forbidden");',
  "      return;",
  "    }",
  "    serveFile(res, resolvedDistPath);",
  "    return;",
  "  }",
  '  if (url.pathname === "/ghostty-vt.wasm") {',
  "    serveFile(res, GHOSTTY_WASM_PATH);",
  "    return;",
  "  }",
  "  res.writeHead(404, {",
  "    ...COMMON_HEADERS,",
  '    "Content-Type": "text/plain; charset=utf-8",',
  "  });",
  '  res.end("Not Found");',
  "});",
  "",
  "const wss = new WebSocketServer({ noServer: true });",
  "const activeSessions = new Map();",
  "",
  'server.on("upgrade", (req, socket, head) => {',
  '  const host = req.headers.host ?? ("127.0.0.1:" + PORT);',
  '  const url = new URL(req.url ?? "/", "http://" + host);',
  '  if (url.pathname !== "/ws") {',
  "    socket.destroy();",
  "    return;",
  "  }",
  '  const token = url.searchParams.get("token") ?? "";',
  "  if (!isAuthorized(token)) {",
  '    socket.write("HTTP/1.1 401 Unauthorized\\r\\nConnection: close\\r\\n\\r\\n");',
  "    socket.destroy();",
  "    return;",
  "  }",
  "  wss.handleUpgrade(req, socket, head, (ws) => {",
  '    wss.emit("connection", ws, req);',
  "  });",
  "});",
  "",
  'wss.on("connection", (ws, req) => {',
  '  const host = req.headers.host ?? ("127.0.0.1:" + PORT);',
  '  const url = new URL(req.url ?? "/", "http://" + host);',
  '  const cols = clampSize(url.searchParams.get("cols"), 120, 300);',
  '  const rows = clampSize(url.searchParams.get("rows"), 32, 120);',
  "  const ptyProcess = pty.spawn(getShell(), [], {",
  '    name: "xterm-256color",',
  "    cols,",
  "    rows,",
  "    cwd: WORKING_DIRECTORY,",
  "    env: {",
  "      ...process.env,",
  '      COLORTERM: "truecolor",',
  '      TERM: "xterm-256color",',
  "    },",
  "  });",
  "  activeSessions.set(ws, ptyProcess);",
  "",
  "  ptyProcess.onData((data) => {",
  "    if (ws.readyState === ws.OPEN) {",
  "      ws.send(data);",
  "    }",
  "  });",
  "",
  "  ptyProcess.onExit(({ exitCode }) => {",
  "    if (ws.readyState === ws.OPEN) {",
  '      ws.send("\\r\\n\\x1b[33mShell exited (code: " + (exitCode ?? 0) + ")\\x1b[0m\\r\\n");',
  "      ws.close();",
  "    }",
  "  });",
  "",
  '  ws.on("message", (rawMessage) => {',
  '    const message = rawMessage.toString("utf8");',
  '    if (message.startsWith("{")) {',
  "      try {",
  "        const parsed = JSON.parse(message);",
  '        if (parsed.type === "resize") {',
  '          const nextCols = clampSize(String(parsed.cols ?? ""), cols, 300);',
  '          const nextRows = clampSize(String(parsed.rows ?? ""), rows, 120);',
  "          ptyProcess.resize(nextCols, nextRows);",
  "          return;",
  "        }",
  "      } catch {",
  "        // Fall through and write raw message to the PTY.",
  "      }",
  "    }",
  "    ptyProcess.write(message);",
  "  });",
  "",
  '  ws.on("close", () => {',
  "    const session = activeSessions.get(ws);",
  "    if (session) {",
  "      session.kill();",
  "      activeSessions.delete(ws);",
  "    }",
  "  });",
  "",
  '  ws.on("error", () => {',
  "    // Ignore transient socket errors from browser disconnects.",
  "  });",
  "});",
  "",
  "function shutdown() {",
  "  for (const [ws, ptyProcess] of activeSessions.entries()) {",
  "    try {",
  "      ptyProcess.kill();",
  "    } catch {}",
  "    try {",
  "      ws.close();",
  "    } catch {}",
  "    activeSessions.delete(ws);",
  "  }",
  "  wss.close();",
  "  server.close(() => process.exit(0));",
  "}",
  "",
  'process.on("SIGINT", shutdown);',
  'process.on("SIGTERM", shutdown);',
  "",
  'server.listen(PORT, "0.0.0.0", () => {',
  '  console.log("[OpenHarnessTerminal] listening on " + PORT);',
  "});",
];

export const TERMINAL_SERVER_SCRIPT = TERMINAL_SERVER_SCRIPT_LINES.join("\n");
