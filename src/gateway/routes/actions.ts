import type { IncomingMessage } from "node:http";
import type { JsonResponse } from "../types.js";
import type { GatewayZaloClient, SendTextInput } from "../zalo-client.js";

export const SUPPORTED_ACTIONS = [
  "send",
  "reply-message",
  "add-reaction",
  "get-thread-info",
  "get-group-members",
  "list-friends",
  "list-groups",
  "mark-read",
] as const;

export type GatewayActionName = typeof SUPPORTED_ACTIONS[number];

type ActionHandler = (payload: unknown, client: GatewayZaloClient) => Promise<JsonResponse>;

const MAX_BODY_BYTES = 128 * 1024;

function json(status: number, body: unknown): JsonResponse {
  return { status, body };
}

function error(status: number, message: string, details?: unknown): JsonResponse {
  return json(status, { ok: false, error: message, details });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function sendTextInput(payload: unknown): { ok: true; value: SendTextInput } | { ok: false; response: JsonResponse } {
  if (!isRecord(payload)) return { ok: false, response: error(400, "Request body must be a JSON object") };
  const threadId = requiredString(payload, "threadId");
  const text = typeof payload.text === "string" ? payload.text : "";
  if (!threadId) return { ok: false, response: error(400, "threadId is required") };
  if (!text.trim()) return { ok: false, response: error(400, "text is required") };
  if (payload.isGroup !== undefined && typeof payload.isGroup !== "boolean") return { ok: false, response: error(400, "isGroup must be a boolean") };
  return { ok: true, value: { threadId, text, isGroup: optionalBoolean(payload, "isGroup") } };
}

async function send(payload: unknown, client: GatewayZaloClient): Promise<JsonResponse> {
  const parsed = sendTextInput(payload);
  if (!parsed.ok) return parsed.response;
  const result = await client.sendText(parsed.value);
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}

async function replyMessage(payload: unknown, client: GatewayZaloClient): Promise<JsonResponse> {
  const parsed = sendTextInput(payload);
  if (!parsed.ok) return parsed.response;
  const messageId = isRecord(payload) ? requiredString(payload, "messageId") : undefined;
  const result = await client.replyMessage({ ...parsed.value, messageId });
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}

async function addReaction(payload: unknown, client: GatewayZaloClient): Promise<JsonResponse> {
  if (!isRecord(payload)) return error(400, "Request body must be a JSON object");
  const threadId = requiredString(payload, "threadId");
  const messageId = requiredString(payload, "messageId");
  const reaction = requiredString(payload, "reaction");
  if (!threadId) return error(400, "threadId is required");
  if (!messageId) return error(400, "messageId is required");
  if (!reaction) return error(400, "reaction is required");
  const result = await client.addReaction({ threadId, messageId, reaction, isGroup: optionalBoolean(payload, "isGroup") });
  return result.ok ? json(200, { ok: true, data: result.data ?? {} }) : error(502, result.error ?? "Action failed");
}

async function getThreadInfo(payload: unknown, client: GatewayZaloClient): Promise<JsonResponse> {
  if (!isRecord(payload)) return error(400, "Request body must be a JSON object");
  const threadId = requiredString(payload, "threadId");
  if (!threadId) return error(400, "threadId is required");
  const result = await client.getThreadInfo({ threadId, isGroup: optionalBoolean(payload, "isGroup") });
  return result.ok ? json(200, { ok: true, data: result.data }) : error(502, result.error ?? "Action failed");
}

async function getGroupMembers(payload: unknown, client: GatewayZaloClient): Promise<JsonResponse> {
  if (!isRecord(payload)) return error(400, "Request body must be a JSON object");
  const threadId = requiredString(payload, "threadId");
  if (!threadId) return error(400, "threadId is required");
  const result = await client.getGroupMembers({ threadId });
  return result.ok ? json(200, { ok: true, data: result.data ?? [] }) : error(502, result.error ?? "Action failed");
}

async function listFriends(payload: unknown, client: GatewayZaloClient): Promise<JsonResponse> {
  const input = isRecord(payload) ? {
    count: typeof payload.count === "number" ? payload.count : undefined,
    page: typeof payload.page === "number" ? payload.page : undefined,
  } : undefined;
  const result = await client.listFriends(input);
  return result.ok ? json(200, { ok: true, data: result.data ?? [] }) : error(502, result.error ?? "Action failed");
}

async function listGroups(_payload: unknown, client: GatewayZaloClient): Promise<JsonResponse> {
  const result = await client.listGroups();
  return result.ok ? json(200, { ok: true, data: result.data ?? [] }) : error(502, result.error ?? "Action failed");
}

async function markRead(payload: unknown, client: GatewayZaloClient): Promise<JsonResponse> {
  if (!isRecord(payload)) return error(400, "Request body must be a JSON object");
  const threadId = requiredString(payload, "threadId");
  if (!threadId) return error(400, "threadId is required");
  const result = await client.markRead({ threadId, isGroup: optionalBoolean(payload, "isGroup") });
  return result.ok ? json(200, { ok: true, data: result.data ?? {} }) : error(502, result.error ?? "Action failed");
}

export const actionRegistry: Record<GatewayActionName, ActionHandler> = {
  send,
  "reply-message": replyMessage,
  "add-reaction": addReaction,
  "get-thread-info": getThreadInfo,
  "get-group-members": getGroupMembers,
  "list-friends": listFriends,
  "list-groups": listGroups,
  "mark-read": markRead,
};

export function isSupportedAction(action: string): action is GatewayActionName {
  return Object.hasOwn(actionRegistry, action);
}

export async function actionResponse(action: string, request: IncomingMessage, client: GatewayZaloClient): Promise<JsonResponse> {
  if (!isSupportedAction(action)) return error(404, `Unsupported action: ${action}`, { supported: SUPPORTED_ACTIONS });
  let payload: unknown;
  try {
    payload = await readRequestBody(request);
  } catch (err) {
    return error(400, err instanceof SyntaxError ? "Invalid JSON body" : err instanceof Error ? err.message : "Invalid request body");
  }
  return actionRegistry[action](payload, client);
}
