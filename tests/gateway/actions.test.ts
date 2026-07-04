import { afterEach, describe, expect, it } from "vitest";
import { createGatewayServer } from "../../src/gateway/server.js";
import { MockGatewayZaloClient } from "../../src/gateway/zalo-client.mock.js";
import { isSupportedAction, SUPPORTED_ACTIONS } from "../../src/gateway/routes/actions.js";

const openServers: Array<ReturnType<typeof createGatewayServer>["server"]> = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((err) => err ? reject(err) : resolve());
  })));
});

async function startServer(options: { token?: string; client?: MockGatewayZaloClient } = {}) {
  const client = options.client ?? new MockGatewayZaloClient();
  const gateway = createGatewayServer({
    config: { host: "127.0.0.1", port: 0, token: options.token, webhooks: [] },
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

async function postAction(baseUrl: string, action: string, body: unknown, token?: string) {
  return fetch(`${baseUrl}/actions/${encodeURIComponent(action)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("action registry", () => {
  it("lists supported actions", () => {
    expect(SUPPORTED_ACTIONS).toEqual([
      "send",
      "reply-message",
      "add-reaction",
      "get-thread-info",
      "get-group-members",
      "list-friends",
      "list-groups",
      "mark-read",
    ]);
    expect(isSupportedAction("send")).toBe(true);
    expect(isSupportedAction("unknown")).toBe(false);
  });

  it("requires auth for action routes when token is configured", async () => {
    const { baseUrl } = await startServer({ token: "secret" });

    const response = await postAction(baseUrl, "send", { threadId: "thread-1", text: "hello" });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("runs send and reply-message through the client boundary", async () => {
    const { baseUrl, client } = await startServer({ token: "secret" });

    const send = await postAction(baseUrl, "send", { threadId: "thread-1", text: "hello" }, "secret");
    expect(send.status).toBe(200);
    expect(await send.json()).toEqual({
      ok: true,
      data: { ok: true, messageId: "mock-1", threadId: "thread-1" },
    });

    const reply = await postAction(baseUrl, "reply-message", { threadId: "thread-1", text: "reply", messageId: "msg-1" }, "secret");
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({
      ok: true,
      data: { ok: true, messageId: "reply-1", threadId: "thread-1" },
    });
    expect(client.sentMessages).toEqual([{ threadId: "thread-1", text: "hello", isGroup: undefined }]);
    expect(client.replies).toEqual([{ threadId: "thread-1", text: "reply", isGroup: undefined, messageId: "msg-1" }]);
  });



  it("rejects send-like actions outside the gateway allowlist", async () => {
    const client = new MockGatewayZaloClient();
    const gateway = createGatewayServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        token: "secret",
        webhooks: [],
        allowedSenders: ["allowed-user"],
        allowedThreads: ["allowed-group"],
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
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const blockedDm = await postAction(baseUrl, "send", { threadId: "unknown-user", text: "hello", isGroup: false }, "secret");
    expect(blockedDm.status).toBe(403);
    expect(await blockedDm.json()).toEqual({ ok: false, error: "Forbidden", reason: "sender_not_allowed" });

    const blockedGroup = await postAction(baseUrl, "reply-message", { threadId: "unknown-group", text: "reply", isGroup: true }, "secret");
    expect(blockedGroup.status).toBe(403);
    expect(await blockedGroup.json()).toEqual({ ok: false, error: "Forbidden", reason: "thread_not_allowed" });

    const allowed = await postAction(baseUrl, "send", { threadId: "allowed-user", text: "hello", isGroup: false }, "secret");
    expect(allowed.status).toBe(200);
    expect(client.sentMessages).toEqual([{ threadId: "allowed-user", text: "hello", isGroup: false }]);
  });

  it("runs utility actions", async () => {
    const client = new MockGatewayZaloClient();
    client.groupMembers = [{ userId: "u1", displayName: "User 1" }];
    client.friends = [{ userId: "u1", displayName: "User 1" }];
    client.groups = [{ groupId: "g1", name: "Group 1" }];
    const { baseUrl } = await startServer({ client });

    const reaction = await postAction(baseUrl, "add-reaction", { threadId: "thread-1", messageId: "msg-1", reaction: "👍" });
    expect(reaction.status).toBe(200);
    expect(await reaction.json()).toEqual({ ok: true, data: { reacted: true } });

    const info = await postAction(baseUrl, "get-thread-info", { threadId: "thread-2", isGroup: true });
    expect(info.status).toBe(200);
    expect(await info.json()).toEqual({ ok: true, data: { threadId: "thread-2", isGroup: true, name: "Mock Thread" } });

    const members = await postAction(baseUrl, "get-group-members", { threadId: "group-1" });
    expect(members.status).toBe(200);
    expect(await members.json()).toEqual({ ok: true, data: [{ userId: "u1", displayName: "User 1" }] });

    const friends = await postAction(baseUrl, "list-friends", {});
    expect(friends.status).toBe(200);
    expect(await friends.json()).toEqual({ ok: true, data: [{ userId: "u1", displayName: "User 1" }] });

    const groups = await postAction(baseUrl, "list-groups", {});
    expect(groups.status).toBe(200);
    expect(await groups.json()).toEqual({ ok: true, data: [{ groupId: "g1", name: "Group 1" }] });

    const markRead = await postAction(baseUrl, "mark-read", { threadId: "thread-1" });
    expect(markRead.status).toBe(200);
    expect(await markRead.json()).toEqual({ ok: true, data: { marked: true } });
  });

  it("returns stable errors for unknown actions and invalid payloads", async () => {
    const { baseUrl } = await startServer();

    const unknown = await postAction(baseUrl, "unknown", {});
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({
      ok: false,
      error: "Unsupported action: unknown",
      details: { supported: SUPPORTED_ACTIONS },
    });

    const invalid = await postAction(baseUrl, "add-reaction", { threadId: "thread-1" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ ok: false, error: "messageId is required" });
  });
});
