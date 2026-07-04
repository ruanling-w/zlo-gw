import type { IncomingMessage } from "node:http";
import type { JsonResponse } from "../types.js";
import type { GatewayZaloClient, SendTextInput } from "../zalo-client.js";
import { decideOutboundPolicy, type GatewayPolicyConfig } from "../policy.js";

const MAX_TEXT_LENGTH = 4000;
const MAX_BODY_BYTES = 128 * 1024;

export type SendMessageRequest = {
  threadId: string;
  text: string;
  isGroup?: boolean;
  metadata?: SendTextInput["metadata"];
};

export type SendMessageSuccess = {
  ok: true;
  messageId?: string;
  threadId: string;
};

export type SendMessageError = {
  ok: false;
  error: string;
  details?: unknown;
};

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function badRequest(error: string, details?: unknown): JsonResponse {
  return {
    status: 400,
    body: { ok: false, error, details } satisfies SendMessageError,
  };
}

export function validateSendMessagePayload(payload: unknown): { ok: true; value: SendMessageRequest } | { ok: false; response: JsonResponse } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, response: badRequest("Request body must be a JSON object") };
  }

  const record = payload as Record<string, unknown>;
  const threadId = typeof record.threadId === "string" ? record.threadId.trim() : "";
  const text = typeof record.text === "string" ? record.text : "";

  if (!threadId) return { ok: false, response: badRequest("threadId is required") };
  if (!text.trim()) return { ok: false, response: badRequest("text is required") };
  if (text.length > MAX_TEXT_LENGTH) return { ok: false, response: badRequest(`text must be <= ${MAX_TEXT_LENGTH} characters`) };
  if (record.isGroup !== undefined && typeof record.isGroup !== "boolean") {
    return { ok: false, response: badRequest("isGroup must be a boolean") };
  }
  if (record.metadata !== undefined && (typeof record.metadata !== "object" || record.metadata === null || Array.isArray(record.metadata))) {
    return { ok: false, response: badRequest("metadata must be an object") };
  }

  return {
    ok: true,
    value: {
      threadId,
      text,
      isGroup: record.isGroup as boolean | undefined,
      metadata: record.metadata as SendTextInput["metadata"] | undefined,
    },
  };
}

export async function sendMessageResponse(request: IncomingMessage, zaloClient: GatewayZaloClient, policy?: GatewayPolicyConfig): Promise<JsonResponse> {
  let payload: unknown;
  try {
    const raw = await readRequestBody(request);
    payload = raw.trim() ? JSON.parse(raw) : undefined;
  } catch (err) {
    return badRequest(err instanceof SyntaxError ? "Invalid JSON body" : err instanceof Error ? err.message : "Invalid request body");
  }

  const validated = validateSendMessagePayload(payload);
  if (!validated.ok) return validated.response;

  const decision = policy ? decideOutboundPolicy(validated.value, policy) : { allowed: true };
  if (!decision.allowed) {
    return {
      status: 403,
      body: { ok: false, error: "Forbidden", reason: decision.reason },
    };
  }

  const result = await zaloClient.sendText(validated.value);
  if (!result.ok) {
    return {
      status: 502,
      body: {
        ok: false,
        error: result.error ?? "Failed to send Zalo message",
      } satisfies SendMessageError,
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      messageId: result.messageId,
      threadId: result.threadId,
    } satisfies SendMessageSuccess,
  };
}
