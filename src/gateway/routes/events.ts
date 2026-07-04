import type { IncomingMessage, ServerResponse } from "node:http";
import { requireBearerToken } from "../auth.js";
import type { GatewayConfig, JsonResponse } from "../types.js";
import type { GatewayEventHub } from "../events.js";

export function eventsResponse(request: IncomingMessage, response: ServerResponse, config: GatewayConfig, eventHub: GatewayEventHub): JsonResponse | undefined {
  const auth = requireBearerToken(request, config.eventsToken ?? config.token);
  if (!auth.ok) return { status: auth.status, body: { ok: false, error: auth.error } };
  const lastEventId = Array.isArray(request.headers["last-event-id"])
    ? request.headers["last-event-id"][0]
    : request.headers["last-event-id"];
  eventHub.subscribe(response, { lastEventId });
  return undefined;
}
