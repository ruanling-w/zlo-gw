import type { IncomingMessage } from "node:http";
import type { JsonResponse } from "../types.js";
import { decideOutboundPolicy, type GatewayPolicyConfig } from "../policy.js";
import type { GatewayZaloClient, SendAttachmentInput, SendLinkInput, SendTextInput, SendVideoInput } from "../zalo-client.js";

export const SUPPORTED_ACTIONS = [
  "send",
  "reply-message",
  "add-reaction",
  "get-thread-info",
  "get-group-members",
  "list-friends",
  "list-groups",
  "mark-read",
  "send-image",
  "send-file",
  "send-link",
  "send-video",
  "send-voice",
  "get-group-info",
  "get-group-members-info",
] as const;

export type GatewayActionName = typeof SUPPORTED_ACTIONS[number];

type ActionContext = {
  client: GatewayZaloClient;
  policy?: GatewayPolicyConfig;
};

type ActionHandler = (payload: unknown, context: ActionContext) => Promise<JsonResponse>;

const MAX_BODY_BYTES = 128 * 1024;

function json(status: number, body: unknown): JsonResponse {
  return { status, body };
}

function error(status: number, message: string, details?: unknown): JsonResponse {
  return json(status, { ok: false, error: message, details });
}

function forbidden(reason: string | undefined): JsonResponse {
  return json(403, { ok: false, error: "Forbidden", reason });
}

function checkOutbound(input: { threadId: string; isGroup?: boolean }, policy: GatewayPolicyConfig | undefined): JsonResponse | undefined {
  if (!policy) return undefined;
  const decision = decideOutboundPolicy(input, policy);
  return decision.allowed ? undefined : forbidden(decision.reason);
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

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
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

async function send(payload: unknown, context: ActionContext): Promise<JsonResponse> {
  const parsed = sendTextInput(payload);
  if (!parsed.ok) return parsed.response;
  const blocked = checkOutbound(parsed.value, context.policy);
  if (blocked) return blocked;
  const result = await context.client.sendText(parsed.value);
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}

async function replyMessage(payload: unknown, context: ActionContext): Promise<JsonResponse> {
  const parsed = sendTextInput(payload);
  if (!parsed.ok) return parsed.response;
  const blocked = checkOutbound(parsed.value, context.policy);
  if (blocked) return blocked;
  const messageId = isRecord(payload) ? requiredString(payload, "messageId") : undefined;
  const result = await context.client.replyMessage({ ...parsed.value, messageId });
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}

async function addReaction(payload: unknown, context: ActionContext): Promise<JsonResponse> {
  if (!isRecord(payload)) return error(400, "Request body must be a JSON object");
  const threadId = requiredString(payload, "threadId");
  const messageId = requiredString(payload, "messageId");
  const reaction = requiredString(payload, "reaction");
  if (!threadId) return error(400, "threadId is required");
  if (!messageId) return error(400, "messageId is required");
  if (!reaction) return error(400, "reaction is required");
  const isGroup = optionalBoolean(payload, "isGroup");
  const blocked = checkOutbound({ threadId, isGroup }, context.policy);
  if (blocked) return blocked;
  const result = await context.client.addReaction({ threadId, messageId, reaction, isGroup });
  return result.ok ? json(200, { ok: true, data: result.data ?? {} }) : error(502, result.error ?? "Action failed");
}

async function getThreadInfo(payload: unknown, context: ActionContext): Promise<JsonResponse> {
  if (!isRecord(payload)) return error(400, "Request body must be a JSON object");
  const threadId = requiredString(payload, "threadId");
  if (!threadId) return error(400, "threadId is required");
  const result = await context.client.getThreadInfo({ threadId, isGroup: optionalBoolean(payload, "isGroup") });
  return result.ok ? json(200, { ok: true, data: result.data }) : error(502, result.error ?? "Action failed");
}

async function getGroupMembers(payload: unknown, context: ActionContext): Promise<JsonResponse> {
  if (!isRecord(payload)) return error(400, "Request body must be a JSON object");
  const threadId = requiredString(payload, "threadId");
  if (!threadId) return error(400, "threadId is required");
  const result = await context.client.getGroupMembers({ threadId });
  return result.ok ? json(200, { ok: true, data: result.data ?? [] }) : error(502, result.error ?? "Action failed");
}

async function listFriends(payload: unknown, context: ActionContext): Promise<JsonResponse> {
  const input = isRecord(payload) ? {
    count: typeof payload.count === "number" ? payload.count : undefined,
    page: typeof payload.page === "number" ? payload.page : undefined,
  } : undefined;
  const result = await context.client.listFriends(input);
  return result.ok ? json(200, { ok: true, data: result.data ?? [] }) : error(502, result.error ?? "Action failed");
}

async function listGroups(_payload: unknown, context: ActionContext): Promise<JsonResponse> {
  const result = await context.client.listGroups();
  return result.ok ? json(200, { ok: true, data: result.data ?? [] }) : error(502, result.error ?? "Action failed");
}

async function markRead(payload: unknown, context: ActionContext): Promise<JsonResponse> {
  if (!isRecord(payload)) return error(400, "Request body must be a JSON object");
  const threadId = requiredString(payload, "threadId");
  if (!threadId) return error(400, "threadId is required");
  const isGroup = optionalBoolean(payload, "isGroup");
  const blocked = checkOutbound({ threadId, isGroup }, context.policy);
  if (blocked) return blocked;
  const result = await context.client.markRead({ threadId, isGroup });
  return result.ok ? json(200, { ok: true, data: result.data ?? {} }) : error(502, result.error ?? "Action failed");
}

function attachmentInput(payload: unknown, key: "imageUrl" | "fileUrl"): { ok: true; value: SendAttachmentInput } | { ok: false; response: JsonResponse } {
  if (!isRecord(payload)) return { ok: false, response: error(400, "Request body must be a JSON object") };
  const threadId = requiredString(payload, "threadId");
  const attachment = requiredString(payload, key) ?? requiredString(payload, "attachment");
  if (!threadId) return { ok: false, response: error(400, "threadId is required") };
  if (!attachment) return { ok: false, response: error(400, `${key} is required`) };
  return { ok: true, value: { threadId, attachment, text: typeof payload.text === "string" ? payload.text : undefined, isGroup: optionalBoolean(payload, "isGroup"), ttl: optionalNumber(payload, "ttl") } };
}

async function sendImage(payload: unknown, context: ActionContext): Promise<JsonResponse> {
  const parsed = attachmentInput(payload, "imageUrl");
  if (!parsed.ok) return parsed.response;
  const blocked = checkOutbound(parsed.value, context.policy);
  if (blocked) return blocked;
  const result = await context.client.sendAttachment(parsed.value);
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}

async function sendFile(payload: unknown, context: ActionContext): Promise<JsonResponse> {
  const parsed = attachmentInput(payload, "fileUrl");
  if (!parsed.ok) return parsed.response;
  const blocked = checkOutbound(parsed.value, context.policy);
  if (blocked) return blocked;
  const result = await context.client.sendAttachment(parsed.value);
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}

function linkInput(payload: unknown): { ok: true; value: SendLinkInput } | { ok: false; response: JsonResponse } {
  if (!isRecord(payload)) return { ok: false, response: error(400, "Request body must be a JSON object") };
  const threadId = requiredString(payload, "threadId");
  const link = requiredString(payload, "link") ?? requiredString(payload, "url");
  if (!threadId) return { ok: false, response: error(400, "threadId is required") };
  if (!link) return { ok: false, response: error(400, "link is required") };
  return { ok: true, value: { threadId, link, text: typeof payload.text === "string" ? payload.text : undefined, isGroup: optionalBoolean(payload, "isGroup"), ttl: optionalNumber(payload, "ttl") } };
}

async function sendLink(payload: unknown, context: ActionContext): Promise<JsonResponse> {
  const parsed = linkInput(payload);
  if (!parsed.ok) return parsed.response;
  const blocked = checkOutbound(parsed.value, context.policy);
  if (blocked) return blocked;
  const result = await context.client.sendLink(parsed.value);
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}

function videoInput(payload: unknown): { ok: true; value: SendVideoInput } | { ok: false; response: JsonResponse } {
  if (!isRecord(payload)) return { ok: false, response: error(400, "Request body must be a JSON object") };
  const threadId = requiredString(payload, "threadId");
  const videoUrl = requiredString(payload, "videoUrl");
  const thumbnailUrl = requiredString(payload, "thumbnailUrl");
  if (!threadId) return { ok: false, response: error(400, "threadId is required") };
  if (!videoUrl) return { ok: false, response: error(400, "videoUrl is required") };
  if (!thumbnailUrl) return { ok: false, response: error(400, "thumbnailUrl is required") };
  return { ok: true, value: { threadId, videoUrl, thumbnailUrl, text: typeof payload.text === "string" ? payload.text : undefined, isGroup: optionalBoolean(payload, "isGroup"), ttl: optionalNumber(payload, "ttl"), duration: optionalNumber(payload, "duration"), width: optionalNumber(payload, "width"), height: optionalNumber(payload, "height") } };
}

async function sendVideo(payload: unknown, context: ActionContext): Promise<JsonResponse> {
  const parsed = videoInput(payload);
  if (!parsed.ok) return parsed.response;
  const blocked = checkOutbound(parsed.value, context.policy);
  if (blocked) return blocked;
  const result = await context.client.sendVideo(parsed.value);
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}

function sendVoiceInput(payload: unknown): { ok: true; value: { threadId: string; voiceUrl: string; isGroup?: boolean; ttl?: number } } | { ok: false; response: JsonResponse } {
  if (!isRecord(payload)) return { ok: false, response: error(400, "Request body must be a JSON object") };
  const threadId = requiredString(payload, "threadId");
  const voiceUrl = requiredString(payload, "voiceUrl");
  if (!threadId) return { ok: false, response: error(400, "threadId is required") };
  if (!voiceUrl) return { ok: false, response: error(400, "voiceUrl is required") };
  return { ok: true, value: { threadId, voiceUrl, isGroup: optionalBoolean(payload, "isGroup"), ttl: typeof payload.ttl === "number" ? payload.ttl : undefined } };
}

async function sendVoice(payload: unknown, context: ActionContext): Promise<JsonResponse> {
  const parsed = sendVoiceInput(payload);
  if (!parsed.ok) return parsed.response;
  const blocked = checkOutbound(parsed.value, context.policy);
  if (blocked) return blocked;
  const result = await context.client.sendVoice(parsed.value);
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}

async function getGroupInfo(payload: unknown, context: ActionContext): Promise<JsonResponse> {
  return getThreadInfo(payload, context);
}

async function getGroupMembersInfo(payload: unknown, context: ActionContext): Promise<JsonResponse> {
  return getGroupMembers(payload, context);
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
  "send-image": sendImage,
  "send-file": sendFile,
  "send-link": sendLink,
  "send-video": sendVideo,
  "send-voice": sendVoice,
  "get-group-info": getGroupInfo,
  "get-group-members-info": getGroupMembersInfo,
};

export function isSupportedAction(action: string): action is GatewayActionName {
  return Object.hasOwn(actionRegistry, action);
}

export async function actionResponse(action: string, request: IncomingMessage, client: GatewayZaloClient, policy?: GatewayPolicyConfig): Promise<JsonResponse> {
  if (!isSupportedAction(action)) return error(404, `Unsupported action: ${action}`, { supported: SUPPORTED_ACTIONS });
  let payload: unknown;
  try {
    payload = await readRequestBody(request);
  } catch (err) {
    return error(400, err instanceof SyntaxError ? "Invalid JSON body" : err instanceof Error ? err.message : "Invalid request body");
  }
  return actionRegistry[action](payload, { client, policy });
}
