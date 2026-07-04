import { describe, expect, it } from "vitest";
import { ThreadType } from "zca-js";
import { createGatewayServer } from "../../src/gateway/server.js";
import { MockGatewayZaloClient } from "../../src/gateway/zalo-client.mock.js";
import { normalizeGatewayZaloEvent } from "../../src/gateway/zalo-client.js";

describe("GatewayZaloClient boundary", () => {
  it("records mocked sendText calls and returns stable results", async () => {
    const client = new MockGatewayZaloClient();

    const result = await client.sendText({ threadId: "thread-1", text: "hello", isGroup: false });

    expect(result).toEqual({ ok: true, messageId: "mock-1", threadId: "thread-1" });
    expect(client.sentMessages).toEqual([{ threadId: "thread-1", text: "hello", isGroup: false }]);
  });

  it("supports message listeners with disposable subscriptions", () => {
    const client = new MockGatewayZaloClient();
    const events: string[] = [];
    const subscription = client.onMessage((event) => events.push(event.text));

    client.emit({
      type: "message.created",
      platform: "zalo",
      threadId: "thread-1",
      chatType: "dm",
      text: "first",
      timestamp: 1,
    });
    subscription.dispose();
    client.emit({
      type: "message.created",
      platform: "zalo",
      threadId: "thread-1",
      chatType: "dm",
      text: "second",
      timestamp: 2,
    });

    expect(events).toEqual(["first"]);
    expect(client.listenerCount()).toBe(0);
  });

  it("normalizes raw zca-js user and group messages", () => {
    expect(normalizeGatewayZaloEvent({
      type: ThreadType.User,
      threadId: "user-thread",
      isSelf: false,
      data: { msgId: "m1", cliMsgId: "c1", content: "hello", dName: "User One", ts: "123", uidFrom: "0" },
    } as any)).toMatchObject({
      type: "message.created",
      platform: "zalo",
      threadId: "user-thread",
      messageId: "m1",
      senderId: "user-thread",
      senderName: "User One",
      chatType: "dm",
      text: "hello",
      timestamp: 123,
    });

    expect(normalizeGatewayZaloEvent({
      type: ThreadType.Group,
      threadId: "group-thread",
      isSelf: false,
      data: { msgId: "m2", cliMsgId: "c2", content: { title: "photo" }, dName: "Group User", ts: "456", uidFrom: "user-2" },
    } as any)).toMatchObject({
      threadId: "group-thread",
      messageId: "m2",
      senderId: "user-2",
      senderName: "Group User",
      chatType: "group",
      text: JSON.stringify({ title: "photo" }),
      timestamp: 456,
    });
  });

  it("drops self or empty raw zca-js messages", () => {
    expect(normalizeGatewayZaloEvent({
      type: ThreadType.User,
      threadId: "user-thread",
      isSelf: true,
      data: { msgId: "m1", cliMsgId: "c1", content: "hello", dName: "User One", ts: "123", uidFrom: "0" },
    } as any)).toBeUndefined();
    expect(normalizeGatewayZaloEvent({
      type: ThreadType.User,
      threadId: "user-thread",
      isSelf: false,
      data: { msgId: "m1", cliMsgId: "c1", content: " ", dName: "User One", ts: "123", uidFrom: "0" },
    } as any)).toBeUndefined();
  });

  it("feeds mocked client status into /health", async () => {
    const client = new MockGatewayZaloClient({
      status: "connected",
      authenticated: true,
      hasStoredCredentials: true,
    });
    const gateway = createGatewayServer({
      config: { host: "127.0.0.1", port: 0, webhooks: [] },
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

    try {
      const address = gateway.server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP server address");
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        zalo: { status: "connected", authenticated: true },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        gateway.server.close((err) => err ? reject(err) : resolve());
      });
    }
  });
});
