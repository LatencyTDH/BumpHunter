/**
 * GitHub Webhook Auto-Deploy Listener
 *
 * Listens on PORT 9443 for GitHub push events on the `main` branch.
 * Verifies the HMAC SHA-256 signature, then triggers an async deploy:
 *   git pull → npm run build → systemctl --user restart bumphunter
 *
 * Kept intentionally minimal — plain Node http module, zero dependencies.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = Number(process.env.WEBHOOK_PORT) || 9443;
const SECRET_PATH = resolve(PROJECT_ROOT, ".webhook-secret");

let SECRET = "";
try {
  SECRET = readFileSync(SECRET_PATH, "utf-8").trim();
} catch {
  console.warn(
    `⚠️  Webhook secret file not found at ${SECRET_PATH} — signature verification disabled. ` +
    `Create the file to enable verification.`
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[webhook ${ts}] ${msg}`);
}

function verifySignature(payload: Buffer, sigHeader: string | undefined): boolean {
  if (!sigHeader) return false;
  const expected = "sha256=" + createHmac("sha256", SECRET).update(payload).digest("hex");
  if (expected.length !== sigHeader.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sigHeader));
}

function runDeploy() {
  log("🚀 Deploy started");

  const shell = "/bin/bash";
  const script = `
    set -e
    cd "${PROJECT_ROOT}"
    echo "=== git pull ==="
    git pull origin main 2>&1
    echo "=== npm run build ==="
    npm run build 2>&1
    echo "=== restart service ==="
    systemctl --user restart bumphunter 2>&1
    echo "=== deploy complete ==="
  `;

  execFile(shell, ["-c", script], { env: { ...process.env, PATH: process.env.PATH } }, (err, stdout, stderr) => {
    if (err) {
      log(`❌ Deploy FAILED: ${err.message}`);
      if (stdout) log(`stdout:\n${stdout}`);
      if (stderr) log(`stderr:\n${stderr}`);
      return;
    }
    log(`✅ Deploy succeeded`);
    if (stdout) log(`stdout:\n${stdout}`);
  });
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  // Only accept POST /webhook
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }

  let body: Buffer;
  try {
    body = await readBody(req);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("bad request");
    return;
  }

  // Verify signature
  if (!SECRET) {
    log("⚠️  No webhook secret configured — rejecting request");
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("webhook secret not configured");
    return;
  }
  const sig = req.headers["x-hub-signature-256"] as string | undefined;
  if (!verifySignature(body, sig)) {
    log("⚠️  Invalid signature — rejected");
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("invalid signature");
    return;
  }

  // Parse payload
  let payload: any;
  try {
    payload = JSON.parse(body.toString("utf-8"));
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("invalid json");
    return;
  }

  // Only deploy on push to main
  const ref = payload.ref as string | undefined;
  if (ref !== "refs/heads/main") {
    log(`ℹ️  Push to ${ref} — ignoring (not main)`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ignored", reason: "not main branch" }));
    return;
  }

  // Respond immediately, deploy async
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "deploying" }));

  const pusher = payload.pusher?.name || "unknown";
  const commitMsg = payload.head_commit?.message?.split("\n")[0] || "no message";
  log(`📦 Push to main by ${pusher}: "${commitMsg}"`);

  runDeploy();
});

server.listen(PORT, () => {
  log(`Listening on port ${PORT}`);
});
