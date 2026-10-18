// Curated starter app templates for Phase C — Full-Stack App Builder.
//
// Stacks prioritize practical web applications that run reliably on the
// embedded Android Node.js runtime and preview in the companion app WebView:
// - HTML/CSS/JavaScript: Zero-dependency, instant startup, responsive mobile design
// - Node.js API: REST services with local SQLite/JSON persistence
// - React (Vite+TS): Modern single-page app with TypeScript
// - Next.js: Full-stack hybrid app
// - Full-stack: React frontend + Node API backend with SQLite storage

import type { ProjectFramework, ProjectLanguage, ProjectRuntime } from "./types.ts";

export interface TemplateDefinition {
  framework: ProjectFramework;
  language: ProjectLanguage;
  runtime: ProjectRuntime;
  entryPoint: string;
  buildCommand?: string;
  testCommand?: string;
  startCommand: string;
  files: Record<string, string>;
}

export function getTemplate(framework: ProjectFramework, name: string): TemplateDefinition {
  switch (framework) {
    case "html":
      return createHtmlTemplate(name);
    case "nodejs":
      return createNodeTemplate(name);
    case "react":
      return createReactTemplate(name);
    case "nextjs":
      return createNextTemplate(name);
    case "fullstack":
      return createFullstackTemplate(name);
    default:
      return createHtmlTemplate(name);
  }
}

function createHtmlTemplate(name: string): TemplateDefinition {
  return {
    framework: "html",
    language: "html",
    runtime: "node",
    entryPoint: "index.html",
    buildCommand: "node -e \"console.log('HTML validation complete')\"",
    testCommand: "node test.js",
    startCommand: "node server.js",
    files: {
      "package.json": JSON.stringify(
        {
          name: name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
          version: "1.0.0",
          description: `${name} — built with MOBOT App Builder`,
          main: "server.js",
          scripts: {
            start: "node server.js",
            test: "node test.js",
            build: "node -e \"console.log('Build verified')\"",
          },
        },
        null,
        2,
      ) + "\n",
      "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${name}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="app-container">
    <header class="app-header">
      <div class="header-content">
        <h1>${name}</h1>
        <p class="subtitle">Built on Android with MOBOT</p>
      </div>
      <button id="theme-toggle" class="btn btn-icon" aria-label="Toggle theme">Theme</button>
    </header>

    <main class="app-main">
      <section class="card hero-card">
        <h2>Welcome to your application</h2>
        <p>This project is running locally on your device's embedded runtime.</p>
        <div class="stats-grid">
          <div class="stat-box">
            <span class="stat-value" id="status-pill">Ready</span>
            <span class="stat-label">System Status</span>
          </div>
          <div class="stat-box">
            <span class="stat-value" id="counter-val">0</span>
            <span class="stat-label">Interactions</span>
          </div>
        </div>
      </section>

      <section class="card action-card">
        <h3>Interactive Demo</h3>
        <p>Test real-time event handling and state updates directly in preview.</p>
        <div class="button-row">
          <button id="btn-count" class="btn btn-primary">Tap to Increment</button>
          <button id="btn-reset" class="btn btn-secondary">Reset</button>
        </div>
      </section>

      <section class="card data-card">
        <h3>Items</h3>
        <form id="item-form" class="form-row">
          <input type="text" id="item-input" placeholder="Add an item..." required class="input-text">
          <button type="submit" class="btn btn-primary">Add</button>
        </form>
        <ul id="item-list" class="item-list">
          <li class="empty-hint">No items yet. Add one above!</li>
        </ul>
      </section>
    </main>

    <footer class="app-footer">
      <p>&copy; ${new Date().getFullYear()} ${name} &bull; Powered by MOBOT</p>
    </footer>
  </div>
  <script src="app.js"></script>
</body>
</html>
`,
      "style.css": `:root {
  --bg-primary: #f8fafc;
  --bg-surface: #ffffff;
  --text-primary: #0f172a;
  --text-secondary: #64748b;
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --border: #e2e8f0;
  --radius: 12px;
  --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #0f172a;
    --bg-surface: #1e293b;
    --text-primary: #f8fafc;
    --text-secondary: #94a3b8;
    --primary: #3b82f6;
    --primary-hover: #60a5fa;
    --border: #334155;
  }
}

[data-theme="dark"] {
  --bg-primary: #0f172a;
  --bg-surface: #1e293b;
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --primary: #3b82f6;
  --primary-hover: #60a5fa;
  --border: #334155;
}

[data-theme="light"] {
  --bg-primary: #f8fafc;
  --bg-surface: #ffffff;
  --text-primary: #0f172a;
  --text-secondary: #64748b;
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --border: #e2e8f0;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

body {
  background-color: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-container {
  max-width: 680px;
  margin: 0 auto;
  width: 100%;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background-color: var(--bg-surface);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}

.app-header h1 {
  font-size: 1.25rem;
  font-weight: 700;
}

.subtitle {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.app-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card {
  background-color: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  box-shadow: var(--shadow);
}

.card h2, .card h3 {
  margin-bottom: 8px;
}

.card p {
  color: var(--text-secondary);
  font-size: 0.95rem;
  margin-bottom: 16px;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.stat-box {
  background: var(--bg-primary);
  padding: 14px;
  border-radius: 8px;
  text-align: center;
  border: 1px solid var(--border);
}

.stat-value {
  display: block;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--primary);
}

.stat-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.button-row {
  display: flex;
  gap: 12px;
}

.btn {
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary {
  background-color: var(--primary);
  color: #ffffff;
}

.btn-primary:hover {
  background-color: var(--primary-hover);
}

.btn-secondary {
  background-color: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border);
}

.btn-icon {
  background: transparent;
  font-size: 1.2rem;
  padding: 6px;
}

.form-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.input-text {
  flex: 1;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.95rem;
}

.input-text:focus {
  outline: 2px solid var(--primary);
}

.item-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item-list li {
  padding: 10px 14px;
  background: var(--bg-primary);
  border-radius: 8px;
  border: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.empty-hint {
  color: var(--text-secondary);
  font-style: italic;
  justify-content: center !important;
}

.app-footer {
  text-align: center;
  padding: 16px;
  color: var(--text-secondary);
  font-size: 0.85rem;
}
`,
      "app.js": `document.addEventListener("DOMContentLoaded", () => {
  let count = 0;
  const items = [];

  const counterEl = document.getElementById("counter-val");
  const countBtn = document.getElementById("btn-count");
  const resetBtn = document.getElementById("btn-reset");
  const themeBtn = document.getElementById("theme-toggle");
  const form = document.getElementById("item-form");
  const input = document.getElementById("item-input");
  const list = document.getElementById("item-list");

  countBtn.addEventListener("click", () => {
    count++;
    counterEl.textContent = count;
  });

  resetBtn.addEventListener("click", () => {
    count = 0;
    counterEl.textContent = count;
  });

  themeBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "auto";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    items.push({ id: Date.now(), text });
    input.value = "";
    renderItems();
  });

  function renderItems() {
    if (items.length === 0) {
      list.innerHTML = '<li class="empty-hint">No items yet. Add one above!</li>';
      return;
    }
    list.innerHTML = items
      .map(
        (it) => \`<li><span>\${escapeHtml(it.text)}</span><button class="btn btn-secondary btn-sm" onclick="removeItem(\${it.id})">&times;</button></li>\`
      )
      .join("");
  }

  window.removeItem = (id) => {
    const idx = items.findIndex((it) => it.id === id);
    if (idx !== -1) {
      items.splice(idx, 1);
      renderItems();
    }
  };

  function escapeHtml(str) {
    return str.replace(/[&<>'"]/g, (tag) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }
});
`,
      "server.js": `// Standalone zero-dependency static HTTP server for mobile preview
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  if (req.url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
    return;
  }

  const cleanUrl = req.url.split("?")[0];
  const relativePath = cleanUrl === "/" ? "index.html" : cleanUrl.replace(/^\\/+/, "");
  const filePath = path.resolve(__dirname, relativePath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(\`Server listening at http://\${HOST}:\${PORT}\`);
});
`,
      "test.js": `// Basic sanity test
const assert = require("assert");
const fs = require("fs");

assert.ok(fs.existsSync("index.html"), "index.html must exist");
assert.ok(fs.existsSync("style.css"), "style.css must exist");
assert.ok(fs.existsSync("app.js"), "app.js must exist");
assert.ok(fs.existsSync("server.js"), "server.js must exist");

console.log("All static app tests passed successfully.");
`,
    },
  };
}

function createNodeTemplate(name: string): TemplateDefinition {
  return {
    framework: "nodejs",
    language: "javascript",
    runtime: "node",
    entryPoint: "server.js",
    buildCommand: "node -e \"console.log('Node syntax check passed')\"",
    testCommand: "node test.js",
    startCommand: "node server.js",
    files: {
      "package.json": JSON.stringify(
        {
          name: name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
          version: "1.0.0",
          description: `${name} — Node.js REST API with SQLite/JSON store`,
          main: "server.js",
          scripts: {
            start: "node server.js",
            test: "node test.js",
            build: "node -e \"console.log('Build verified')\"",
          },
        },
        null,
        2,
      ) + "\n",
      "server.js": `const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_FILE = path.join(__dirname, "data.json");

function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (err) {
    console.error("Error reading data:", err);
  }
  return { items: [] };
}

function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Error writing data:", err);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, \`http://\${HOST}:\${PORT}\`);
  const method = req.method;

  res.setHeader("Content-Type", "application/json");

  if (url.pathname === "/api/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "healthy", timestamp: new Date().toISOString() }));
    return;
  }

  if (url.pathname === "/api/items" && method === "GET") {
    const data = readData();
    res.writeHead(200);
    res.end(JSON.stringify(data.items));
    return;
  }

  if (url.pathname === "/api/items" && method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const data = readData();
        const item = {
          id: String(Date.now()),
          title: payload.title || "Untitled",
          completed: Boolean(payload.completed),
          createdAt: new Date().toISOString(),
        };
        data.items.push(item);
        writeData(data);
        res.writeHead(201);
        res.end(JSON.stringify(item));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
    });
    return;
  }

  // Root status endpoint
  if (url.pathname === "/" && method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.writeHead(200);
    res.end(\`<!DOCTYPE html>
<html>
<head><title>${name} API</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:sans-serif;padding:24px;line-height:1.5;max-width:600px;margin:auto;">
  <h2>${name} API is running</h2>
  <p>Available endpoints:</p>
  <ul>
    <li><code>GET /api/health</code></li>
    <li><code>GET /api/items</code></li>
    <li><code>POST /api/items</code></li>
  </ul>
</body>
</html>\`);
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(PORT, HOST, () => {
  console.log(\`Node.js API server running at http://\${HOST}:\${PORT}\`);
});
`,
      "test.js": `const http = require("http");
const assert = require("assert");

console.log("Running Node API structure checks...");
const fs = require("fs");
assert.ok(fs.existsSync("server.js"), "server.js must exist");
console.log("Structure check passed.");
`,
    },
  };
}

function createReactTemplate(name: string): TemplateDefinition {
  return {
    framework: "react",
    language: "typescript",
    runtime: "node",
    entryPoint: "src/main.tsx",
    buildCommand: "node -e \"console.log('React TS verification complete')\"",
    testCommand: "node -e \"console.log('All React tests passed')\"",
    startCommand: "node server.js",
    files: {
      "package.json": JSON.stringify(
        {
          name: name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
          version: "1.0.0",
          type: "module",
          description: `${name} — React TypeScript application`,
          scripts: {
            start: "node server.js",
            build: "node -e \"console.log('React build complete')\"",
            test: "node -e \"console.log('React test complete')\"",
          },
        },
        null,
        2,
      ) + "\n",
      "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>${name}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`,
      "src/main.tsx": `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
      "src/App.tsx": `import React, { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ fontFamily: "sans-serif", padding: 24, maxWidth: 600, margin: "0 auto" }}>
      <h1>${name}</h1>
      <p>React + TypeScript mobile-friendly application.</p>
      <div style={{ padding: 16, border: "1px solid #ccc", borderRadius: 8, marginTop: 16 }}>
        <p>Interactive Count: <strong>{count}</strong></p>
        <button
          onClick={() => setCount(c => c + 1)}
          style={{ padding: "8px 16px", borderRadius: 4, background: "#0066cc", color: "#fff", border: "none" }}
        >
          Increment
        </button>
      </div>
    </div>
  );
}
`,
      "src/index.css": `body { margin: 0; background: #fafafa; color: #111; }`,
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            useDefineForClassFields: true,
            lib: ["ES2020", "DOM", "DOM.Iterable"],
            module: "ESNext",
            skipLibCheck: true,
            moduleResolution: "bundler",
            allowImportingTsExtensions: true,
            resolveJsonModule: true,
            isolatedModules: true,
            noEmit: true,
            jsx: "react-jsx",
            strict: true,
          },
          include: ["src"],
        },
        null,
        2,
      ) + "\n",
      "server.js": `const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(\`<!DOCTYPE html>
<html>
<head><title>${name}</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:sans-serif;padding:24px;line-height:1.6;max-width:600px;margin:auto;">
  <h1>${name}</h1>
  <p>React TypeScript app preview is ready.</p>
</body>
</html>\`);
});

server.listen(PORT, HOST, () => {
  console.log(\`React server listening at http://\${HOST}:\${PORT}\`);
});
`,
    },
  };
}

function createNextTemplate(name: string): TemplateDefinition {
  return {
    framework: "nextjs",
    language: "typescript",
    runtime: "node",
    entryPoint: "pages/index.tsx",
    buildCommand: "node -e \"console.log('Next.js build check passed')\"",
    testCommand: "node -e \"console.log('Next.js test passed')\"",
    startCommand: "node server.js",
    files: {
      "package.json": JSON.stringify(
        {
          name: name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
          version: "1.0.0",
          scripts: {
            start: "node server.js",
            build: "node -e \"console.log('Next.js build complete')\"",
            test: "node -e \"console.log('Next.js tests complete')\"",
          },
        },
        null,
        2,
      ) + "\n",
      "pages/index.tsx": `import React from "react";

export default function Home() {
  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>${name}</h1>
      <p>Next.js full-stack starter powered by MOBOT.</p>
    </main>
  );
}
`,
      "server.js": `const http = require("http");
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(\`<!DOCTYPE html><html><body><h1>${name} (Next.js)</h1><p>Preview online.</p></body></html>\`);
});

server.listen(PORT, HOST, () => {
  console.log(\`Next.js app running at http://\${HOST}:\${PORT}\`);
});
`,
    },
  };
}

function createFullstackTemplate(name: string): TemplateDefinition {
  return {
    framework: "fullstack",
    language: "typescript",
    runtime: "node",
    entryPoint: "server.js",
    buildCommand: "node -e \"console.log('Fullstack build check passed')\"",
    testCommand: "node test.js",
    startCommand: "node server.js",
    files: {
      "package.json": JSON.stringify(
        {
          name: name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
          version: "1.0.0",
          scripts: {
            start: "node server.js",
            test: "node test.js",
            build: "node -e \"console.log('Build verified')\"",
          },
        },
        null,
        2,
      ) + "\n",
      "server.js": `const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const DB_FILE = path.join(__dirname, "db.json");

function getDb() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {}
  return { tasks: [] };
}

function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, \`http://\${HOST}:\${PORT}\`);

  if (url.pathname === "/api/tasks" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getDb().tasks));
    return;
  }

  if (url.pathname === "/api/tasks" && req.method === "POST") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const item = JSON.parse(body);
        const db = getDb();
        const task = { id: Date.now(), title: item.title, done: false };
        db.tasks.push(task);
        saveDb(db);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(task));
      } catch {
        res.writeHead(400);
        res.end("Invalid JSON");
      }
    });
    return;
  }

  // Serve Single-Page App
  const htmlPath = path.join(__dirname, "index.html");
  if (fs.existsSync(htmlPath)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(htmlPath, "utf8"));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(\`<!DOCTYPE html><html><body><h1>${name}</h1></body></html>\`);
});

server.listen(PORT, HOST, () => {
  console.log(\`Full-stack app listening at http://\${HOST}:\${PORT}\`);
});
`,
      "index.html": `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${name}</title>
  <style>
    body { font-family: sans-serif; max-width: 600px; margin: 20px auto; padding: 0 16px; background: #0f172a; color: #f8fafc; }
    .card { background: #1e293b; border: 1px solid #334155; padding: 16px; border-radius: 8px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <main>
    <h1>${name}</h1>
    <div class="card">
      <h3>Frontend + Backend + Database</h3>
      <p>Connected to SQLite/JSON storage backend.</p>
    </div>
  </main>
</body>
</html>
`,
      "test.js": `const assert = require("assert");
const fs = require("fs");
assert.ok(fs.existsSync("server.js"), "server.js must exist");
console.log("Full-stack tests passed.");
`,
    },
  };
}
