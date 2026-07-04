import { describe, expect, it } from "vitest";
import { extractBearerToken, isAuthorized } from "../../src/gateway/auth.js";
import { loadGatewayConfig } from "../../src/gateway/config.js";

describe("gateway auth", () => {
  it("extracts bearer tokens case-insensitively", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
    expect(extractBearerToken("bearer abc123")).toBe("abc123");
    expect(extractBearerToken("Basic abc123")).toBeUndefined();
    expect(extractBearerToken(undefined)).toBeUndefined();
  });

  it("allows requests when no token is configured", () => {
    expect(isAuthorized({ headers: {} } as any)).toBe(true);
  });

  it("requires exact token match when configured", () => {
    expect(isAuthorized({ headers: { authorization: "Bearer secret" } } as any, "secret")).toBe(true);
    expect(isAuthorized({ headers: { authorization: "Bearer wrong" } } as any, "secret")).toBe(false);
  });
});

describe("gateway config", () => {
  it("loads default config", () => {
    expect(loadGatewayConfig({})).toEqual({
      host: "127.0.0.1",
      port: 8787,
      token: undefined,
      webhookToken: undefined,
      webhooks: [],
      allowedSenders: [],
      allowedThreads: [],
      deniedSenders: [],
      deniedThreads: [],
    });
  });

  it("loads env overrides", () => {
    expect(loadGatewayConfig({
      ZALO_GATEWAY_HOST: "0.0.0.0",
      ZALO_GATEWAY_PORT: "9999",
      ZALO_GATEWAY_TOKEN: " token ",
      ZALO_GATEWAY_WEBHOOK_TOKEN: " webhook-token ",
      ZALO_GATEWAY_WEBHOOKS: "http://one.local, http://two.local ,,,",
      ZALO_GATEWAY_ALLOWED_SENDERS: "user-1, user-2, user-1",
      ZALO_GATEWAY_ALLOWED_THREADS: "thread-1",
      ZALO_GATEWAY_DENY_SENDERS: "bad-user",
      ZALO_GATEWAY_DENY_THREADS: "bad-thread",
    })).toEqual({
      host: "0.0.0.0",
      port: 9999,
      token: "token",
      webhookToken: "webhook-token",
      webhooks: ["http://one.local", "http://two.local"],
      allowedSenders: ["user-1", "user-2"],
      allowedThreads: ["thread-1"],
      deniedSenders: ["bad-user"],
      deniedThreads: ["bad-thread"],
    });
  });

  it("rejects invalid ports", () => {
    expect(() => loadGatewayConfig({ ZALO_GATEWAY_PORT: "0" })).toThrow("Invalid ZALO_GATEWAY_PORT");
    expect(() => loadGatewayConfig({ ZALO_GATEWAY_PORT: "70000" })).toThrow("Invalid ZALO_GATEWAY_PORT");
    expect(() => loadGatewayConfig({ ZALO_GATEWAY_PORT: "abc" })).toThrow("Invalid ZALO_GATEWAY_PORT");
  });
});
