import { afterEach, describe, expect, it, vi } from "vitest";
import { createGatewayServer } from "../../src/gateway/server.js";
import { WebhookDispatcher } from "../../src/gateway/webhooks.js";
import { MockGatewayZaloClient } from "../../src/gateway/zalo-client.mock.js";
import type { NormalizedZaloEvent } from "../../src/gateway/zalo-client.js";

const event: NormalizedZaloEvent = {
  type: "message.created",
  platform: "zalo",
  threadId: "thread-1",
  messageId: "msg-1",
  senderId: "user-1",
  senderName: "User One",
  chatType: "dm",
  text: "hello",
  timestamp: 123,
};

const openServers: Array<ReturnType<typeof createGatewayServer>["server"]> = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((err) => err ? reject(err) : resolve());
  })));
});

describe("WebhookDispatcher", () => {
  it("posts normalized events to configured webhooks", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const dispatcher = new WebhookDispatcher(["http://hook.local/a", "http://hook.local/b"], { fetchImpl });

    const result = await dispatcher.dispatch(event);

    expect(result.delivered).toEqual([
      { url: "http://hook.local/a", ok: true, status: 200, error: undefined },
      { url: "http://hook.local/b", ok: true, status: 200, error: undefined },
    ]);
    expect(calls).toEqual([
      { url: "http://hook.local/a", body: event },
      { url: "http://hook.local/b", body: event },
    ]);
  });

  it("captures non-2xx and thrown webhook failures", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/throw")) throw new Error("network down");
      return new Response("nope", { status: 503 });
    }) as unknown as typeof fetch;
    const dispatcher = new WebhookDispatcher(["http://hook.local/fail", "http://hook.local/throw"], { fetchImpl });

    const result = await dispatcher.dispatch(event);

    expect(result.delivered).toEqual([
      { url: "http://hook.local/fail", ok: false, status: 503, error: "Webhook returned HTTP 503" },
      { url: "http://hook.local/throw", ok: false, error: "network down" },
    ]);
  });

  it("adds bearer auth when webhook token is configured", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const dispatcher = new WebhookDispatcher(["http://hook.local/secure"], { fetchImpl, token: "webhook-secret" });

    await dispatcher.dispatch(event);

    const [, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(init?.headers).toMatchObject({ authorization: "Bearer " + "webhook-secret" });
  });
});

describe("gateway inbound webhook wiring", () => {
  it("subscribes to inbound client events and dispatches them", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    const client = new MockGatewayZaloClient();
    const gateway = createGatewayServer({
      config: { host: "127.0.0.1", port: 0, webhooks: ["http://hook.local/inbound"], webhookToken: "webhook-secret" },
      runtime: { name: "zalo-api-gateway", version: "0.1.0-test", node: "v-test" },
      zaloClient: client,
    });
    openServers.push(gateway.server);

    try {
      client.emit(event);
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
      const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
      expect(String(url)).toBe("http://hook.local/inbound");
      expect(init?.headers).toMatchObject({ authorization: "Bearer " + "webhook-secret" });
      expect(JSON.parse(String(init?.body))).toEqual(event);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });



  it("blocks inbound events outside the gateway allowlist before webhook dispatch", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    const client = new MockGatewayZaloClient();
    const gateway = createGatewayServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        webhooks: ["http://hook.local/inbound"],
        allowedSenders: ["other-user"],
        allowedThreads: [],
        deniedSenders: [],
        deniedThreads: [],
      },
      runtime: { name: "zalo-api-gateway", version: "0.1.0-test", node: "v-test" },
      zaloClient: client,
    });
    openServers.push(gateway.server);

    try {
      client.emit(event);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("disposes inbound subscription when server closes", async () => {
    const client = new MockGatewayZaloClient();
    const gateway = createGatewayServer({
      config: { host: "127.0.0.1", port: 0, webhooks: ["http://hook.local/inbound"] },
      runtime: { name: "zalo-api-gateway", version: "0.1.0-test", node: "v-test" },
      zaloClient: client,
    });
    await new Promise<void>((resolve, reject) => {
      gateway.server.once("error", reject);
      gateway.server.listen(0, "127.0.0.1", () => {
        gateway.server.off("error", reject);
        resolve();
      });
    });
    expect(client.listenerCount()).toBe(1);

    await new Promise<void>((resolve, reject) => gateway.server.close((err) => err ? reject(err) : resolve()));

    expect(client.listenerCount()).toBe(0);
  });
});
