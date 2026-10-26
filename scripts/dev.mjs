// Backend-first dev runner: start the API, wait until its health route
// answers, then start the frontend. Both processes are long-running
// (tsx watch / vite), so this orchestrator owns their lifecycle — Ctrl+C
// and normal exit stop both children.
//
// Usage: pnpm dev   (root package.json → node scripts/dev.mjs)

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const PORT = Number(process.env.PORT) || 4000;
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/v1/health`;
const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_INTERVAL_MS = 500;

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let shuttingDown = false;

function start(name, command, args) {
  // shell:true needs a single command string (avoids DEP0190).
  const child = spawn(`${command} ${args.join(" ")}`, {
    cwd: root,
    shell: isWin, // pnpm.cmd on Windows
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  children.push(child);

  const prefix = `[${name}] `;
  const forward = (stream, out) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) out.write(prefix + line + "\n");
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.log(`${prefix}exited (code=${code} signal=${signal})`);
    shutdown(code ?? 1);
  });
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }
  }
  process.exitCode = code;
}

async function waitForHealth() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  for (;;) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // Not up yet.
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS));
  }
}

console.log("[dev] starting backend (API) first…");
start("api", "pnpm", ["dev:api"]);

const healthy = await waitForHealth();
if (healthy) {
  console.log(`[dev] backend healthy at ${HEALTH_URL} — starting frontend…`);
} else {
  console.warn(
    `[dev] backend not healthy after ${HEALTH_TIMEOUT_MS / 1000}s — starting frontend anyway (check [api] logs above).`,
  );
}
start("web", "pnpm", ["dev:web"]);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}
