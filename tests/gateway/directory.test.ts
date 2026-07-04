import { afterEach, describe, expect, it } from "vitest";
import { createGatewayServer } from "../../src/gateway/server.js";
import { MockGatewayZaloClient } from "../../src/gateway/zalo-client.mock.js";

const openServers: Array<ReturnType<typeof createGatewayServer>["server"]> = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((err) => err ? reject(err) : resolve());
  })));
});

async function startServer(client = new MockGatewayZaloClient()) {
  const gateway = createGatewayServer({
    config: { host: "127.0.0.1", port: 0, token: "secret", webhooks: [] },
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
  return `http://127.0.0.1:${address.port}`;
}

function authHeaders() {
  return { authorization: "Bearer " + "secret" };
}

describe("directory routes", () => {
  it("requires auth", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/friends`);
    expect(response.status).toBe(401);
  });

  it("lists friends and groups", async () => {
    const client = new MockGatewayZaloClient();
    client.friends = [{ userId: "u1", displayName: "User One", zaloName: "Zalo One" }];
    client.groups = [{ groupId: "g1", name: "Group One", memberCount: 2 }];
    const baseUrl = await startServer(client);

    const friends = await fetch(`${baseUrl}/friends?count=10&page=1`, { headers: authHeaders() });
    expect(friends.status).toBe(200);
    expect(await friends.json()).toEqual({ ok: true, data: [{ userId: "u1", displayName: "User One", zaloName: "Zalo One" }] });

    const groups = await fetch(`${baseUrl}/groups`, { headers: authHeaders() });
    expect(groups.status).toBe(200);
    expect(await groups.json()).toEqual({ ok: true, data: [{ groupId: "g1", name: "Group One", memberCount: 2 }] });
  });

  it("lists group members", async () => {
    const client = new MockGatewayZaloClient();
    client.groupMembers = [{ userId: "u1", displayName: "User One" }];
    const baseUrl = await startServer(client);

    const response = await fetch(`${baseUrl}/groups/group-1/members`, { headers: authHeaders() });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: [{ userId: "u1", displayName: "User One" }] });
  });
});
