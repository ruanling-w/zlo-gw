import type { NormalizedZaloEvent } from "./zalo-client.js";

export type GatewayPolicyConfig = {
  allowedSenders: string[];
  allowedThreads: string[];
  deniedSenders: string[];
  deniedThreads: string[];
};

export type PolicyDecision = {
  allowed: boolean;
  reason?: "sender_denied" | "thread_denied" | "sender_not_allowed" | "thread_not_allowed";
};

const WILDCARD = "*";

export function parsePolicyList(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((item) => item.trim()).filter(Boolean))];
}

function matches(list: string[], value: string | undefined): boolean {
  list = list ?? [];
  if (list.includes(WILDCARD)) return true;
  return Boolean(value && list.includes(value));
}

function isConstrained(list: string[]): boolean {
  list = list ?? [];
  return list.length > 0 && !list.includes(WILDCARD);
}

export function decideInboundPolicy(event: NormalizedZaloEvent, policy: GatewayPolicyConfig): PolicyDecision {
  if (matches(policy.deniedSenders, event.senderId)) return { allowed: false, reason: "sender_denied" };
  if (matches(policy.deniedThreads, event.threadId)) return { allowed: false, reason: "thread_denied" };
  if (isConstrained(policy.allowedSenders) && !matches(policy.allowedSenders, event.senderId)) {
    return { allowed: false, reason: "sender_not_allowed" };
  }
  if (isConstrained(policy.allowedThreads) && !matches(policy.allowedThreads, event.threadId)) {
    return { allowed: false, reason: "thread_not_allowed" };
  }
  return { allowed: true };
}

export function decideOutboundPolicy(input: { threadId: string; isGroup?: boolean }, policy: GatewayPolicyConfig): PolicyDecision {
  if (matches(policy.deniedThreads, input.threadId)) return { allowed: false, reason: "thread_denied" };
  if (input.isGroup) {
    if (isConstrained(policy.allowedThreads) && !matches(policy.allowedThreads, input.threadId)) {
      return { allowed: false, reason: "thread_not_allowed" };
    }
    return { allowed: true };
  }
  if (matches(policy.deniedSenders, input.threadId)) return { allowed: false, reason: "sender_denied" };
  if (isConstrained(policy.allowedSenders) && !matches(policy.allowedSenders, input.threadId)) {
    return { allowed: false, reason: "sender_not_allowed" };
  }
  return { allowed: true };
}

export function redactId(value: string | undefined): string {
  if (!value) return "[UNKNOWN]";
  return "[REDACTED]";
}

export function logPolicyDecision(event: string, decision: PolicyDecision, fields: { threadId?: string; senderId?: string } = {}): void {
  const parts = [
    `[zalo-api-gateway] event=${event}`,
    decision.reason ? `reason=${decision.reason}` : undefined,
    `threadId=${redactId(fields.threadId)}`,
    fields.senderId !== undefined ? `senderId=${redactId(fields.senderId)}` : undefined,
  ].filter(Boolean);
  console.log(parts.join(" "));
}
