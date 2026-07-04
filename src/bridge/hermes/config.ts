import type { HermesBridgeConfig } from "./types.js";

export type HermesBridgeEnv = Partial<Record<string, string | undefined>>;

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8790;
const DEFAULT_TIMEOUT_MS = 120_000;

function parsePort(raw: string | undefined): number {
  if (!raw) return DEFAULT_PORT;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid HERMES_BRIDGE_PORT: ${raw}`);
  }
  return port;
}

function parseTimeout(raw: string | undefined): number {
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const timeout = Number.parseInt(raw, 10);
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error(`Invalid HERMES_TIMEOUT_MS: ${raw}`);
  }
  return timeout;
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

export function loadHermesBridgeConfig(env: HermesBridgeEnv = process.env): HermesBridgeConfig {
  return {
    host: env.HERMES_BRIDGE_HOST?.trim() || DEFAULT_HOST,
    port: parsePort(env.HERMES_BRIDGE_PORT),
    token: env.HERMES_BRIDGE_TOKEN?.trim() || undefined,
    hermesCli: env.HERMES_CLI?.trim() || "hermes",
    sessionPrefix: env.HERMES_SESSION_PREFIX?.trim() || "zalo",
    hermesTimeoutMs: parseTimeout(env.HERMES_TIMEOUT_MS),
    zaloGatewayUrl: env.ZALO_GATEWAY_URL?.trim() || "http://127.0.0.1:8787",
    zaloGatewayToken: env.ZALO_GATEWAY_TOKEN?.trim() || undefined,
    allowedSenders: parseList(env.HERMES_BRIDGE_ALLOWED_SENDERS),
    allowedThreads: parseList(env.HERMES_BRIDGE_ALLOWED_THREADS),
  };
}
