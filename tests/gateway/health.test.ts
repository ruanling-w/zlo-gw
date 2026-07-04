import { afterEach, describe, expect, it } from "vitest";
import { createGatewayServer } from "../../src/gateway/server.js";
import { healthResponse, versionResponse } from "../../src/gateway/routes/health.js";

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

async function startTestServer() {
  const gateway = createGatewayServer({
    config: { host: "127.0.0.1", port: 0, webhooks: [] },
    runtime: { name: "zalo-api-gateway", version: "0.1.0-test", node: "v-test" },
    getZaloStatus: () => ({ status: "disconnected", authenticated: false }),
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

describe("gateway health routes", () => {
  it("builds a health response without real Zalo login", async () => {
    const result = await healthResponse({
      runtime: { name: "zalo-api-gateway", version: "0.1.0-test", node: "v-test" },
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      status: "ok",
      service: "zalo-api-gateway",
      version: "0.1.0-test",
      zalo: { status: "unknown", authenticated: false },
    });
  });

  it("returns version metadata", () => {
    const result = versionResponse({ name: "zalo-api-gateway", version: "0.1.0-test", node: "v-test" });

    expect(result).toEqual({
      status: 200,
      body: { name: "zalo-api-gateway", version: "0.1.0-test", node: "v-test" },
    });
  });

  it("serves GET /health and GET /version over HTTP", async () => {
    const baseUrl = await startTestServer();

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      service: "zalo-api-gateway",
      version: "0.1.0-test",
      zalo: { status: "disconnected", authenticated: false },
    });

    const version = await fetch(`${baseUrl}/version`);
    expect(version.status).toBe(200);
    expect(await version.json()).toEqual({
      name: "zalo-api-gateway",
      version: "0.1.0-test",
      node: "v-test",
    });
  });

  it("returns stable JSON errors for unknown paths and wrong methods", async () => {
    const baseUrl = await startTestServer();

    const missing = await fetch(`${baseUrl}/missing`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, error: "Not found" });

    const wrongMethod = await fetch(`${baseUrl}/health`, { method: "POST" });
    expect(wrongMethod.status).toBe(405);
    expect(await wrongMethod.json()).toEqual({ ok: false, error: "Method not allowed" });
  });
});
