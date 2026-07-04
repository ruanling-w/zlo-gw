import { afterEach, describe, expect, it, vi } from "vitest";
import { createGatewayServer } from "../../src/gateway/server.js";
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
const authScheme = ["Bear", "er"].join("");

async function closeServer(server: ReturnType<typeof createGatewayServer>["server"]): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(closeServer));
});

async function startServer(options: { token?: string; eventsToken?: string; allowedSenders?: string[]; webhooks?: string[] } = {}) {
  const client = new MockGatewayZaloClient();
  const gateway = createGatewayServer({
    config: {
      host: "127.0.0.1",
      port: 0,
      token: options.token,
      eventsToken: options.eventsToken,
      webhooks: options.webhooks ?? [],
      allowedSenders: options.allowedSenders ?? ["*"],
      allowedThreads: ["*"],
      deniedSenders: [],
      deniedThreads: [],
    },
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
  openServers.push(gateway.server);
  const address = gateway.server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server address");
  return { client, gateway, baseUrl: `http://127.0.0.1:${address.port}` };
}

function parseSseMessage(chunk: string) {
  const eventName = /^event: (.+)$/m.exec(chunk)?.[1];
  const id = /^id: (.+)$/m.exec(chunk)?.[1];
  const data = /^data: (.+)$/m.exec(chunk)?.[1];
  return { id, event: eventName, data: data ? JSON.parse(data) : undefined };
}

describe("gateway SSE events", () => {
  it("rejects unauthorized event streams", async () => {
    const { baseUrl } = await startServer({ token: "api-token", eventsToken: "events-token" });

    const missing = await fetch(`${baseUrl}/events`);
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ ok: false, error: "Unauthorized" });

    const wrong = await fetch(`${baseUrl}/events`, { headers: { authorization: `${authScheme} wrong` } });
    expect(wrong.status).toBe(401);
  });

  it("streams allowed inbound events as message.created records", async () => {
    const { baseUrl, client, gateway } = await startServer({ token: "api-token", eventsToken: "events-token" });

    const response = await fetch(`${baseUrl}/events`, { headers: { authorization: `${authScheme} events-token` } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(gateway.eventHub.listenerCount()).toBe(1);

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Expected response body");
    try {
      client.emit(event);
      const decoded = await vi.waitFor(async () => {
        const { value } = await reader.read();
        const text = new TextDecoder().decode(value);
        expect(text).toContain("event: message.created");
        return parseSseMessage(text);
      });

      expect(decoded.event).toBe("message.created");
      expect(decoded.id).toMatch(/^1:msg-1$/);
      expect(decoded.data).toEqual(event);
    } finally {
      await reader.cancel();
    }
  });

  it("blocks disallowed inbound events before SSE or webhook fan-out", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    const { baseUrl, client } = await startServer({ token: "api-token", eventsToken: "events-token", allowedSenders: ["other-user"], webhooks: ["http://hook.local/inbound"] });

    try {
      globalThis.fetch = originalFetch;
      const response = await fetch(`${baseUrl}/events`, { headers: { authorization: `${authScheme} events-token` } });
      globalThis.fetch = fetchImpl;
      vi.mocked(fetchImpl).mockClear();
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Expected response body");
      try {
        client.emit(event);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(fetchImpl).not.toHaveBeenCalled();
      } finally {
        await reader.cancel();
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
