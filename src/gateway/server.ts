import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { loadGatewayConfig } from "./config.js";
import type { GatewayConfig, GatewayRuntimeInfo, JsonResponse, ZaloConnectionStatus } from "./types.js";
import { healthResponse, versionResponse } from "./routes/health.js";
import { ZcaGatewayZaloClient, type GatewayZaloClient } from "./zalo-client.js";
import { requireBearerToken } from "./auth.js";
import { sendMessageResponse } from "./routes/messages.js";
import { WebhookDispatcher } from "./webhooks.js";
import { actionResponse } from "./routes/actions.js";
import { friendsResponse, groupMembersResponse, groupsResponse } from "./routes/directory.js";
import { decideInboundPolicy, logPolicyDecision } from "./policy.js";
import { GatewayPolicyStore } from "./policy-store.js";
import { policyResponse } from "./routes/policy.js";

export type GatewayServerOptions = {
  config?: GatewayConfig;
  runtime?: GatewayRuntimeInfo;
  zaloClient?: GatewayZaloClient;
  policyStore?: GatewayPolicyStore;
  getZaloStatus?: () => Promise<{ status: ZaloConnectionStatus; authenticated: boolean }> | { status: ZaloConnectionStatus; authenticated: boolean };
};

export type GatewayServer = {
  server: Server;
  config: GatewayConfig;
  runtime: GatewayRuntimeInfo;
  webhookDispatcher: WebhookDispatcher;
  policyStore: GatewayPolicyStore;
};

function defaultRuntime(): GatewayRuntimeInfo {
  return {
    name: "zalo-api-gateway",
    version: "0.1.0",
    node: process.version,
  };
}

function sendJson(response: ServerResponse, result: JsonResponse): void {
  const body = JSON.stringify(result.body);
  response.writeHead(result.status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body).toString(),
    ...result.headers,
  });
  response.end(body);
}

function notFound(): JsonResponse {
  return {
    status: 404,
    body: {
      ok: false,
      error: "Not found",
    },
  };
}

function methodNotAllowed(): JsonResponse {
  return {
    status: 405,
    body: {
      ok: false,
      error: "Method not allowed",
    },
  };
}

function routeUrl(request: IncomingMessage): URL {
  const host = request.headers.host ?? "127.0.0.1";
  return new URL(request.url ?? "/", `http://${host}`);
}

export function createGatewayServer(options: GatewayServerOptions = {}): GatewayServer {
  const config = options.config ?? loadGatewayConfig();
  const runtime = options.runtime ?? defaultRuntime();
  const zaloClient = options.zaloClient ?? new ZcaGatewayZaloClient();
  const webhookDispatcher = new WebhookDispatcher(config.webhooks, { token: config.webhookToken });
  const policyStore = options.policyStore ?? new GatewayPolicyStore(config);
  const getZaloStatus = options.getZaloStatus ?? (async () => {
    const status = await zaloClient.status();
    return { status: status.status, authenticated: status.authenticated };
  });

  const inboundSubscription = zaloClient.onMessage((event) => {
    if (!webhookDispatcher.hasTargets()) return;
    const decision = decideInboundPolicy(event, policyStore.current());
    if (!decision.allowed) {
      logPolicyDecision("policy.inbound.blocked", decision, { threadId: event.threadId, senderId: event.senderId });
      return;
    }
    logPolicyDecision("policy.inbound.allowed", decision, { threadId: event.threadId, senderId: event.senderId });
    void webhookDispatcher.dispatch(event).then((result) => {
      for (const delivery of result.delivered) {
        if (!delivery.ok) {
          console.warn(`[zalo-api-gateway] event=webhook.delivery.failed url=${delivery.url} error=${delivery.error ?? delivery.status ?? "unknown"}`);
        }
      }
    });
  });

  const server = createServer(async (request, response) => {
    try {
      const url = routeUrl(request);
      const path = url.pathname;
      if (path === "/health") {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        return sendJson(response, await healthResponse({ runtime, getZaloStatus }));
      }
      if (path === "/version") {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        return sendJson(response, versionResponse(runtime));
      }
      if (path === "/messages/send") {
        if (request.method !== "POST") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, await sendMessageResponse(request, zaloClient, policyStore.current()));
      }
      if (path === "/policy") {
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, await policyResponse(request, policyStore));
      }
      if (path === "/friends") {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, await friendsResponse(url, zaloClient));
      }
      if (path === "/groups") {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, await groupsResponse(zaloClient));
      }
      const groupMembersMatch = /^\/groups\/([^/]+)\/members$/.exec(path);
      if (groupMembersMatch) {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, await groupMembersResponse(decodeURIComponent(groupMembersMatch[1]), zaloClient));
      }
      if (path.startsWith("/actions/")) {
        if (request.method !== "POST") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        const action = decodeURIComponent(path.slice("/actions/".length));
        return sendJson(response, await actionResponse(action, request, zaloClient, policyStore.current()));
      }
      return sendJson(response, notFound());
    } catch (err) {
      return sendJson(response, {
        status: 500,
        body: {
          ok: false,
          error: err instanceof Error ? err.message : "Internal server error",
        },
      });
    }
  });

  server.once("close", () => inboundSubscription.dispose());

  return { server, config, runtime, webhookDispatcher, policyStore };
}

export async function listenGateway(options: GatewayServerOptions = {}): Promise<GatewayServer> {
  const gateway = createGatewayServer(options);
  await new Promise<void>((resolve, reject) => {
    gateway.server.once("error", reject);
    gateway.server.listen(gateway.config.port, gateway.config.host, () => {
      gateway.server.off("error", reject);
      resolve();
    });
  });
  return gateway;
}
