import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { requireBearerToken } from "../../gateway/auth.js";
import type { JsonResponse } from "../../gateway/types.js";
import { loadHermesBridgeConfig } from "./config.js";
import { HermesCliRunner } from "./hermes-cli.js";
import { HermesBridgeOrchestrator } from "./orchestrator.js";
import type { HermesBridgeConfig, HermesRunner, ZaloGatewayClient } from "./types.js";
import { HttpZaloGatewayClient } from "./zalo-gateway-client.js";

export type HermesBridgeServerOptions = {
  config?: HermesBridgeConfig;
  hermesRunner?: HermesRunner;
  zaloGatewayClient?: ZaloGatewayClient;
};

export type HermesBridgeServer = {
  server: Server;
  config: HermesBridgeConfig;
  orchestrator: HermesBridgeOrchestrator;
};

function sendJson(response: ServerResponse, result: JsonResponse): void {
  const body = JSON.stringify(result.body);
  response.writeHead(result.status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body).toString(),
    ...result.headers,
  });
  response.end(body);
}

function routePath(request: IncomingMessage): string {
  const host = request.headers.host ?? "127.0.0.1";
  return new URL(request.url ?? "/", `http://${host}`).pathname;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : undefined;
}

export function createHermesBridgeServer(options: HermesBridgeServerOptions = {}): HermesBridgeServer {
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

export async function listenHermesBridge(options: HermesBridgeServerOptions = {}): Promise<HermesBridgeServer> {
  const bridge = createHermesBridgeServer(options);
  await new Promise<void>((resolve, reject) => {
    bridge.server.once("error", reject);
    bridge.server.listen(bridge.config.port, bridge.config.host, () => {
      bridge.server.off("error", reject);
      resolve();
    });
  });
  return bridge;
}
