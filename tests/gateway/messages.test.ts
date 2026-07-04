import { afterEach, describe, expect, it } from "vitest";
import { createGatewayServer } from "../../src/gateway/server.js";
import { MockGatewayZaloClient } from "../../src/gateway/zalo-client.mock.js";
import { validateSendMessagePayload } from "../../src/gateway/routes/messages.js";

const openServers: Array<ReturnType<typeof createGatewayServer>["server"]> = [];

async function closeServer(server: ReturnType<typeof createGatewayServer>["server"]): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(closeServer));
});

async function startServer(options: { token?: string; client?: MockGatewayZaloClient } = {}) {
  const client = options.client ?? new MockGatewayZaloClient();
  const gateway = createGatewayServer({
    config: { host: "127.0.0.1", port: 0, token: options.token, webhooks: [], allowedSenders: ["*"], allowedThreads: ["*"], deniedSenders: [], deniedThreads: [] },
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
  return { baseUrl: `http://127.0.0.1:${address.port}`, client };
}

describe("POST /messages/send", () => {
  it("validates payload shape", () => {
    expect(validateSendMessagePayload({ threadId: " 123 ", text: "hello", isGroup: true })).toEqual({
      ok: true,
      value: { threadId: "123", text: "hello", isGroup: true, metadata: undefined },
    });
    expect(validateSendMessagePayload({ text: "hello" }).ok).toBe(false);
    expect(validateSendMessagePayload({ threadId: "123", text: "" }).ok).toBe(false);
    expect(validateSendMessagePayload({ threadId: "123", text: "hello", isGroup: "yes" }).ok).toBe(false);
  });

  it("requires bearer token when configured", async () => {
    const { baseUrl } = await startServer({ token: "secret" });

    const response = await fetch(`${baseUrl}/messages/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: "thread-1", text: "hello" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("sends text through GatewayZaloClient", async () => {
    const { baseUrl, client } = await startServer({ token: "secret" });

    const response = await fetch(`${baseUrl}/messages/send`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer secret" },
      body: JSON.stringify({ threadId: "thread-1", text: "hello", isGroup: false }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, messageId: "mock-1", threadId: "thread-1" });
    expect(client.sentMessages).toEqual([{ threadId: "thread-1", text: "hello", isGroup: false, metadata: undefined }]);
  });

  it("returns stable validation and upstream errors", async () => {
    const client = new MockGatewayZaloClient();
    client.nextSendResult = { ok: false, error: "send failed" };
    const { baseUrl } = await startServer({ client });

    const invalid = await fetch(`${baseUrl}/messages/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: "", text: "hello" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ ok: false, error: "threadId is required" });

    const failed = await fetch(`${baseUrl}/messages/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: "thread-1", text: "hello" }),
    });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ ok: false, error: "send failed" });
  });
});
