import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createGatewayServer } from "../../src/gateway/server.js";
import { GatewayPolicyStore } from "../../src/gateway/policy-store.js";
import { MockGatewayZaloClient } from "../../src/gateway/zalo-client.mock.js";

const openServers: Array<ReturnType<typeof createGatewayServer>["server"]> = [];
const tempDirs: string[] = [];

const basePolicy = {
  allowedSenders: [],
  allowedThreads: [],
  deniedSenders: [],
  deniedThreads: [],
};

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((err) => err ? reject(err) : resolve());
  })));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function startServer(policyStore: GatewayPolicyStore, client = new MockGatewayZaloClient()) {
  const gateway = createGatewayServer({
    config: { host: "127.0.0.1", port: 0, token: "secret", webhooks: [], ...basePolicy },
    runtime: { name: "zalo-api-gateway", version: "0.1.0-test", node: "v-test" },
    zaloClient: client,
    policyStore,
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

function authHeaders() {
  return { "content-type": "application/json", authorization: "Bearer secret" };
}

describe("gateway policy API", () => {
  it("updates allowlists at runtime and enforces them for sends", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zalo-policy-"));
    tempDirs.push(dir);
    const store = new GatewayPolicyStore(basePolicy, join(dir, "policy.json"));
    const { baseUrl, client } = await startServer(store);

    const blocked = await fetch(`${baseUrl}/messages/send`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ threadId: "u1", text: "hello", isGroup: false }),
    });
    expect(blocked.status).toBe(403);

    const update = await fetch(`${baseUrl}/policy`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ allowedSenders: ["u1"], allowedThreads: ["g1"] }),
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual({
      ok: true,
      data: { allowedSenders: ["u1"], allowedThreads: ["g1"], deniedSenders: [], deniedThreads: [] },
    });

    const allowed = await fetch(`${baseUrl}/messages/send`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ threadId: "u1", text: "hello", isGroup: false }),
    });
    expect(allowed.status).toBe(200);
    expect(client.sentMessages).toEqual([{ threadId: "u1", text: "hello", isGroup: false, metadata: undefined }]);
  });

  it("returns current policy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zalo-policy-"));
    tempDirs.push(dir);
    const store = new GatewayPolicyStore({ ...basePolicy, allowedSenders: ["u1"] }, join(dir, "policy.json"));
    const { baseUrl } = await startServer(store);

    const response = await fetch(`${baseUrl}/policy`, { headers: { authorization: "Bearer secret" } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { ...basePolicy, allowedSenders: ["u1"] } });
  });
});
