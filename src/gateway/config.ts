import type { GatewayConfig } from "./types.js";
import { parsePolicyList } from "./policy.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;

export type GatewayEnv = Partial<Record<string, string | undefined>>;

function parsePort(raw: string | undefined): number {
  if (!raw) return DEFAULT_PORT;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid ZALO_GATEWAY_PORT: ${raw}`);
  }
  return port;
}

function parseWebhooks(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadGatewayConfig(env: GatewayEnv = process.env): GatewayConfig {
  return {
    host: env.ZALO_GATEWAY_HOST?.trim() || DEFAULT_HOST,
    port: parsePort(env.ZALO_GATEWAY_PORT),
    token: env.ZALO_GATEWAY_TOKEN?.trim() || undefined,
    webhookToken: env.ZALO_GATEWAY_WEBHOOK_TOKEN?.trim() || undefined,
    webhooks: parseWebhooks(env.ZALO_GATEWAY_WEBHOOKS),
    allowedSenders: parsePolicyList(env.ZALO_GATEWAY_ALLOWED_SENDERS),
    allowedThreads: parsePolicyList(env.ZALO_GATEWAY_ALLOWED_THREADS),
    deniedSenders: parsePolicyList(env.ZALO_GATEWAY_DENY_SENDERS),
    deniedThreads: parsePolicyList(env.ZALO_GATEWAY_DENY_THREADS),
  };
}
