import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GatewayPolicyConfig } from "./policy.js";
import { getGatewayDataDir } from "../client/credentials.js";

export type PolicyUpdate = Partial<GatewayPolicyConfig>;

const POLICY_FILE = "gateway-policy.json";

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))];
}

export function policyPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getGatewayDataDir(env), POLICY_FILE);
}

export function normalizePolicyConfig(input: PolicyUpdate): GatewayPolicyConfig {
  return {
    allowedSenders: cleanList(input.allowedSenders),
    allowedThreads: cleanList(input.allowedThreads),
    deniedSenders: cleanList(input.deniedSenders),
    deniedThreads: cleanList(input.deniedThreads),
  };
}

export class GatewayPolicyStore {
  private policy: GatewayPolicyConfig;

  constructor(initialPolicy: GatewayPolicyConfig, private path = policyPath()) {
    this.policy = this.load(initialPolicy);
  }

  current(): GatewayPolicyConfig {
    return this.policy;
  }

  update(next: PolicyUpdate): GatewayPolicyConfig {
    this.policy = normalizePolicyConfig({ ...this.policy, ...next });
    this.save();
    return this.policy;
  }

  private load(fallback: GatewayPolicyConfig): GatewayPolicyConfig {
    if (!existsSync(this.path)) return normalizePolicyConfig(fallback);
    try {
      return normalizePolicyConfig(JSON.parse(readFileSync(this.path, "utf8")) as PolicyUpdate);
    } catch {
      return normalizePolicyConfig(fallback);
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(this.policy, null, 2)}\n`, { mode: 0o600 });
  }
}
