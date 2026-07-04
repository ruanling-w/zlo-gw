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

function listValues(list: string[] | undefined): string[] {
  return list ?? [];
}

function matches(list: string[] | undefined, value: string | undefined): boolean {
  const values = listValues(list);
  if (values.includes(WILDCARD)) return true;
  return Boolean(value && values.includes(value));
}

function hasConfiguredAllowlists(policy: GatewayPolicyConfig): boolean {
  return Array.isArray(policy.allowedSenders) || Array.isArray(policy.allowedThreads);
}

function allowedSender(policy: GatewayPolicyConfig, senderId: string | undefined): boolean {
  return matches(policy.allowedSenders, senderId);
}

function allowedThread(policy: GatewayPolicyConfig, threadId: string | undefined): boolean {
  return matches(policy.allowedThreads, threadId);
}

export function decideInboundPolicy(event: NormalizedZaloEvent, policy: GatewayPolicyConfig): PolicyDecision {
  if (matches(policy.deniedSenders, event.senderId)) return { allowed: false, reason: "sender_denied" };
  if (matches(policy.deniedThreads, event.threadId)) return { allowed: false, reason: "thread_denied" };
  if (!hasConfiguredAllowlists(policy)) return { allowed: true };

  if (event.chatType === "group") {
    return allowedThread(policy, event.threadId) ? { allowed: true } : { allowed: false, reason: "thread_not_allowed" };
  }
  return allowedSender(policy, event.senderId) ? { allowed: true } : { allowed: false, reason: "sender_not_allowed" };
}

export function decideOutboundPolicy(input: { threadId: string; isGroup?: boolean }, policy: GatewayPolicyConfig): PolicyDecision {
  if (matches(policy.deniedThreads, input.threadId)) return { allowed: false, reason: "thread_denied" };
  if (!hasConfiguredAllowlists(policy)) return { allowed: true };

  if (input.isGroup) {
    return allowedThread(policy, input.threadId) ? { allowed: true } : { allowed: false, reason: "thread_not_allowed" };
  }
  if (matches(policy.deniedSenders, input.threadId)) return { allowed: false, reason: "sender_denied" };
  return allowedSender(policy, input.threadId) ? { allowed: true } : { allowed: false, reason: "sender_not_allowed" };
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
