// src/env/load-dotenv.ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const index = trimmed.indexOf("=");
  if (index <= 0) return null;
  const key = trimmed.slice(0, index).trim();
  let value = trimmed.slice(index + 1).trim();
  if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }
  return [key, value];
}
function loadDotEnv(path = resolve(process.cwd(), ".env")) {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    process.env[key] ??= value;
  }
}
loadDotEnv();

// src/bridge/hermes/server.ts
import { createServer } from "node:http";

// src/gateway/auth.ts
function extractBearerToken(header) {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return void 0;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || void 0;
}
function isAuthorized(request, expectedToken) {
  if (!expectedToken) return true;
  return extractBearerToken(request.headers.authorization) === expectedToken;
}
function requireBearerToken(request, expectedToken) {
  if (isAuthorized(request, expectedToken)) return { ok: true };
  return { ok: false, status: 401, error: "Unauthorized" };
}

// src/bridge/hermes/config.ts
var DEFAULT_HOST = "127.0.0.1";
var DEFAULT_PORT = 8790;
var DEFAULT_TIMEOUT_MS = 12e4;
function parsePort(raw) {
  if (!raw) return DEFAULT_PORT;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid HERMES_BRIDGE_PORT: ${raw}`);
  }
  return port;
}
function parseTimeout(raw) {
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const timeout = Number.parseInt(raw, 10);
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error(`Invalid HERMES_TIMEOUT_MS: ${raw}`);
  }
  return timeout;
}
function parseList(raw) {
  if (!raw) return [];
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}
function loadHermesBridgeConfig(env = process.env) {
  return {
    host: env.HERMES_BRIDGE_HOST?.trim() || DEFAULT_HOST,
    port: parsePort(env.HERMES_BRIDGE_PORT),
    token: env.HERMES_BRIDGE_TOKEN?.trim() || void 0,
    hermesCli: env.HERMES_CLI?.trim() || "hermes",
    sessionPrefix: env.HERMES_SESSION_PREFIX?.trim() || "zalo",
    hermesTimeoutMs: parseTimeout(env.HERMES_TIMEOUT_MS),
    zaloGatewayUrl: env.ZALO_GATEWAY_URL?.trim() || "http://127.0.0.1:8787",
    zaloGatewayToken: env.ZALO_GATEWAY_TOKEN?.trim() || void 0,
    allowedSenders: parseList(env.HERMES_BRIDGE_ALLOWED_SENDERS),
    allowedThreads: parseList(env.HERMES_BRIDGE_ALLOWED_THREADS)
  };
}

// src/bridge/hermes/hermes-cli.ts
import { spawn } from "node:child_process";
var HermesCliRunner = class {
  constructor(command) {
    this.command = command;
  }
  command;
  async run(input) {
    return new Promise((resolve2) => {
      const child = spawn(this.command, ["--continue", input.sessionId, "-z", input.prompt], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve2({ ok: false, error: "Hermes CLI timed out" });
      }, input.timeoutMs);
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve2({ ok: false, error: err.message });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          return resolve2({ ok: true, text: stdout.trim() });
        }
        return resolve2({ ok: false, error: stderr.trim() || `Hermes CLI exited with code ${code}` });
      });
    });
  }
};

// src/bridge/hermes/orchestrator.ts
var DEDUP_TTL_MS = 10 * 60 * 1e3;
var DEDUP_MAX = 2e3;
var HermesBridgeOrchestrator = class {
  constructor(config, hermes, zaloGateway) {
    this.config = config;
    this.hermes = hermes;
    this.zaloGateway = zaloGateway;
  }
  config;
  hermes;
  zaloGateway;
  seenMessageIds = /* @__PURE__ */ new Map();
  async process(event) {
    const validated = this.validateEvent(event);
    if (!validated.ok) return { ok: true, ignored: true, reason: validated.reason };
    const message = validated.event;
    if (this.isDuplicate(message.messageId)) return { ok: true, ignored: true, reason: "duplicate" };
    if (!this.isAllowed(message)) return { ok: true, ignored: true, reason: "not allowed" };
    const hermesResult = await this.hermes.run({
      sessionId: `${this.config.sessionPrefix}:${message.threadId}`,
      prompt: this.formatPrompt(message),
      timeoutMs: this.config.hermesTimeoutMs
    });
    if (!hermesResult.ok) return { ok: false, error: hermesResult.error ?? "Hermes failed" };
    const text = hermesResult.text?.trim() ?? "";
    if (!text) return { ok: true, ignored: true, reason: "empty hermes reply" };
    const sendResult = await this.zaloGateway.sendMessage({
      threadId: message.threadId,
      isGroup: message.chatType === "group",
      text
    });
    if (!sendResult.ok) return { ok: false, hermesText: text, error: sendResult.error ?? "Failed to send Zalo reply" };
    return { ok: true, hermesText: text, messageId: sendResult.messageId };
  }
  validateEvent(event) {
    if (!event || typeof event !== "object" || Array.isArray(event)) return { ok: false, reason: "invalid event" };
    const record = event;
    if (record.type !== "message.created" || record.platform !== "zalo") return { ok: false, reason: "unsupported event" };
    if (typeof record.threadId !== "string" || !record.threadId.trim()) return { ok: false, reason: "missing threadId" };
    if (record.chatType !== "dm" && record.chatType !== "group") return { ok: false, reason: "invalid chatType" };
    if (typeof record.text !== "string" || !record.text.trim()) return { ok: false, reason: "empty text" };
    return { ok: true, event: record };
  }
  isAllowed(event) {
    if (this.config.allowedThreads.length > 0 && !this.config.allowedThreads.includes(event.threadId)) return false;
    if (this.config.allowedSenders.length > 0 && (!event.senderId || !this.config.allowedSenders.includes(event.senderId))) return false;
    return true;
  }
  isDuplicate(messageId) {
    if (!messageId) return false;
    const now = Date.now();
    if (this.seenMessageIds.has(messageId)) return true;
    if (this.seenMessageIds.size >= DEDUP_MAX) {
      for (const [id, ts] of this.seenMessageIds) {
        if (now - ts > DEDUP_TTL_MS) this.seenMessageIds.delete(id);
      }
      if (this.seenMessageIds.size >= DEDUP_MAX) {
        const oldest = this.seenMessageIds.keys().next().value;
        if (oldest) this.seenMessageIds.delete(oldest);
      }
    }
    this.seenMessageIds.set(messageId, now);
    return false;
  }
  formatPrompt(event) {
    const sender = event.senderName || event.senderId || "Zalo user";
    return `[Zalo ${event.chatType}] ${sender}: ${event.text}`;
  }
};

// src/bridge/hermes/zalo-gateway-client.ts
var HttpZaloGatewayClient = class {
  constructor(baseUrl, token, fetchImpl = fetch) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }
  baseUrl;
  token;
  fetchImpl;
  async sendMessage(input) {
    try {
      const response = await this.fetchImpl(new URL("/messages/send", this.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.token ? { authorization: "Bearer " + this.token } : {}
        },
        body: JSON.stringify(input)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        return { ok: false, error: body.error ?? `Zalo Gateway returned HTTP ${response.status}` };
      }
      return { ok: true, messageId: body.messageId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
};

// src/bridge/hermes/server.ts
function sendJson(response, result) {
  const body = JSON.stringify(result.body);
  response.writeHead(result.status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body).toString(),
    ...result.headers
  });
  response.end(body);
}
function routePath(request) {
  const host = request.headers.host ?? "127.0.0.1";
  return new URL(request.url ?? "/", `http://${host}`).pathname;
}
async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : void 0;
}
function createHermesBridgeServer(options = {}) {
  const config = options.config ?? loadHermesBridgeConfig();
  const hermesRunner = options.hermesRunner ?? new HermesCliRunner(config.hermesCli);
  const zaloGatewayClient = options.zaloGatewayClient ?? new HttpZaloGatewayClient(config.zaloGatewayUrl, config.zaloGatewayToken);
  const orchestrator = new HermesBridgeOrchestrator(config, hermesRunner, zaloGatewayClient);
  const server = createServer(async (request, response) => {
    try {
      const path = routePath(request);
      if (path === "/health") {
        if (request.method !== "GET") return sendJson(response, { status: 405, body: { ok: false, error: "Method not allowed" } });
        return sendJson(response, { status: 200, body: { ok: true, service: "zalo-hermes-bridge" } });
      }
      if (path === "/webhooks/zalo") {
        if (request.method !== "POST") return sendJson(response, { status: 405, body: { ok: false, error: "Method not allowed" } });
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        const event = await readJson(request);
        const result = await orchestrator.process(event);
        return sendJson(response, { status: result.ok ? 200 : 502, body: result });
      }
      return sendJson(response, { status: 404, body: { ok: false, error: "Not found" } });
    } catch (err) {
      return sendJson(response, { status: 400, body: { ok: false, error: err instanceof SyntaxError ? "Invalid JSON body" : err instanceof Error ? err.message : "Bad request" } });
    }
  });
  return { server, config, orchestrator };
}
async function listenHermesBridge(options = {}) {
  const bridge2 = createHermesBridgeServer(options);
  await new Promise((resolve2, reject) => {
    bridge2.server.once("error", reject);
    bridge2.server.listen(bridge2.config.port, bridge2.config.host, () => {
      bridge2.server.off("error", reject);
      resolve2();
    });
  });
  return bridge2;
}

// src/bridge/hermes/index.ts
var bridge = await listenHermesBridge();
console.log(`[zalo-hermes-bridge] listening on http://${bridge.config.host}:${bridge.config.port}`);
var shutdown = async () => {
  await new Promise((resolve2, reject) => {
    bridge.server.close((err) => err ? reject(err) : resolve2());
  });
};
process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
