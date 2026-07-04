import type { IncomingMessage } from "node:http";
import type { JsonResponse } from "../types.js";
import { normalizePolicyConfig, type GatewayPolicyStore, type PolicyUpdate } from "../policy-store.js";

const MAX_BODY_BYTES = 64 * 1024;

function json(status: number, body: unknown): JsonResponse {
  return { status, body };
}

function error(status: number, message: string, details?: unknown): JsonResponse {
  return json(status, { ok: false, error: message, details });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
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

function validatePayload(payload: unknown): { ok: true; value: PolicyUpdate } | { ok: false; response: JsonResponse } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, response: error(400, "Request body must be a JSON object") };
  }
  const record = payload as Record<string, unknown>;
  for (const key of ["allowedSenders", "allowedThreads", "deniedSenders", "deniedThreads"] as const) {
    if (record[key] !== undefined && (!Array.isArray(record[key]) || record[key].some((item) => typeof item !== "string"))) {
      return { ok: false, response: error(400, `${key} must be an array of strings`) };
    }
  }
  return { ok: true, value: normalizePolicyConfig(record as PolicyUpdate) };
}

export async function policyResponse(request: IncomingMessage, store: GatewayPolicyStore): Promise<JsonResponse> {
  if (request.method === "GET") return json(200, { ok: true, data: store.current() });
  if (request.method !== "PUT") return error(405, "Method not allowed");

  let payload: unknown;
  try {
    payload = await readJson(request);
  } catch (err) {
    return error(400, err instanceof SyntaxError ? "Invalid JSON body" : err instanceof Error ? err.message : "Invalid request body");
  }
  const validated = validatePayload(payload);
  if (!validated.ok) return validated.response;
  return json(200, { ok: true, data: store.update(validated.value) });
}
