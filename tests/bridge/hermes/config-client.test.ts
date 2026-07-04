import { describe, expect, it, vi } from "vitest";
import { loadHermesBridgeConfig } from "../../../src/bridge/hermes/config.js";
import { HttpZaloGatewayClient } from "../../../src/bridge/hermes/zalo-gateway-client.js";

describe("loadHermesBridgeConfig", () => {
  it("loads defaults and env overrides", () => {
    expect(loadHermesBridgeConfig({})).toMatchObject({
      host: "127.0.0.1",
      port: 8790,
      hermesCli: "hermes",
      sessionPrefix: "zalo",
      hermesTimeoutMs: 120000,
      zaloGatewayUrl: "http://127.0.0.1:8787",
      allowedSenders: [],
      allowedThreads: [],
    });

    expect(loadHermesBridgeConfig({
      HERMES_BRIDGE_HOST: "0.0.0.0",
      HERMES_BRIDGE_PORT: "9999",
      HERMES_BRIDGE_TOKEN: " bridge-token ",
      HERMES_CLI: "/usr/bin/hermes",
      HERMES_SESSION_PREFIX: "zalo-test",
      HERMES_TIMEOUT_MS: "5000",
      ZALO_GATEWAY_URL: "http://gw.local",
      ZALO_GATEWAY_TOKEN: " gateway-token ",
      HERMES_BRIDGE_ALLOWED_SENDERS: "u1,u2",
      HERMES_BRIDGE_ALLOWED_THREADS: "t1,t2",
    })).toMatchObject({
      host: "0.0.0.0",
      port: 9999,
      token: "bridge-token",
      hermesCli: "/usr/bin/hermes",
      sessionPrefix: "zalo-test",
      hermesTimeoutMs: 5000,
      zaloGatewayUrl: "http://gw.local",
      zaloGatewayToken: "gateway-token",
      allowedSenders: ["u1", "u2"],
      allowedThreads: ["t1", "t2"],
    });
  });
});

describe("HttpZaloGatewayClient", () => {
  it("posts replies to /messages/send", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, messageId: "m1" }), { status: 200 })) as unknown as typeof fetch;
    const client = new HttpZaloGatewayClient("http://gateway.local", "secret", fetchImpl);

    const result = await client.sendMessage({ threadId: "t1", isGroup: false, text: "hello" });

    expect(result).toEqual({ ok: true, messageId: "m1" });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(String(url)).toBe("http://gateway.local/messages/send");
    expect(init?.headers).toMatchObject({ authorization: "Bearer " + "secret" });
    expect(JSON.parse(String(init?.body))).toEqual({ threadId: "t1", isGroup: false, text: "hello" });
  });

  it("returns stable send failures", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "bad" }), { status: 502 })) as unknown as typeof fetch;
    const client = new HttpZaloGatewayClient("http://gateway.local", undefined, fetchImpl);

    await expect(client.sendMessage({ threadId: "t1", isGroup: false, text: "hello" })).resolves.toEqual({ ok: false, error: "bad" });
  });
});
