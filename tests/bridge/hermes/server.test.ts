import { afterEach, describe, expect, it } from "vitest";
import { createHermesBridgeServer } from "../../../src/bridge/hermes/server.js";
import type { HermesBridgeConfig, HermesRunInput, HermesRunResult, HermesRunner, ZaloGatewayClient, ZaloGatewaySendInput, ZaloGatewaySendResult } from "../../../src/bridge/hermes/types.js";

const openServers: Array<ReturnType<typeof createHermesBridgeServer>["server"]> = [];

const config: HermesBridgeConfig = {
  host: "127.0.0.1",
  port: 0,
  token: "bridge-token",
  hermesCli: "hermes",
  sessionPrefix: "zalo",
  hermesTimeoutMs: 1000,
  zaloGatewayUrl: "http://127.0.0.1:8787",
  allowedSenders: [],
  allowedThreads: [],
};

class MockHermes implements HermesRunner {
  calls: HermesRunInput[] = [];
  result: HermesRunResult = { ok: true, text: "bridge reply" };
  async run(input: HermesRunInput): Promise<HermesRunResult> {
    this.calls.push(input);
    return this.result;
  }
}

class MockZaloGateway implements ZaloGatewayClient {
  calls: ZaloGatewaySendInput[] = [];
  result: ZaloGatewaySendResult = { ok: true, messageId: "reply-msg" };
  loginStatus = { status: "qr_generated", sessionId: "session-1" };
  qrBytes = new Uint8Array([137, 80, 78, 71]);
  async sendMessage(input: ZaloGatewaySendInput): Promise<ZaloGatewaySendResult> {
    this.calls.push(input);
    return this.result;
  }
  async startQrLogin() {
    return { ok: true, data: this.loginStatus };
  }
  async getQrLoginStatus() {
    return { ok: true, data: this.loginStatus };
  }
  async getQrLoginImage() {
    return { ok: true, contentType: "image/png", bytes: this.qrBytes };
  }
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((err) => err ? reject(err) : resolve());
  })));
});

async function startBridge() {
  const hermes = new MockHermes();
  const zalo = new MockZaloGateway();
  const bridge = createHermesBridgeServer({ config, hermesRunner: hermes, zaloGatewayClient: zalo });
  await new Promise<void>((resolve, reject) => {
    bridge.server.once("error", reject);
    bridge.server.listen(0, "127.0.0.1", () => {
      bridge.server.off("error", reject);
      resolve();
    });
  });
  openServers.push(bridge.server);
  const address = bridge.server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server address");
  return { baseUrl: `http://127.0.0.1:${address.port}`, hermes, zalo };
}

describe("Hermes bridge server", () => {
  it("serves health", async () => {
    const { baseUrl } = await startBridge();
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "zalo-hermes-bridge" });
  });

  it("requires auth for webhook endpoint", async () => {
    const { baseUrl } = await startBridge();
    const response = await fetch(`${baseUrl}/webhooks/zalo`, { method: "POST", body: "{}" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Unauthorized" });
  });


  it("proxies Zalo QR connection endpoints", async () => {
    const { baseUrl } = await startBridge();
    const auth = { authorization: "Bearer " + "bridge-token" };

    const start = await fetch(`${baseUrl}/connect/zalo/start`, { method: "POST", headers: auth });
    const status = await fetch(`${baseUrl}/connect/zalo/status`, { headers: auth });
    const qr = await fetch(`${baseUrl}/connect/zalo/qr.png`, { headers: auth });

    expect(start.status).toBe(202);
    expect(await start.json()).toEqual({ ok: true, data: { status: "qr_generated", sessionId: "session-1" } });
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ ok: true, data: { status: "qr_generated", sessionId: "session-1" } });
    expect(qr.status).toBe(200);
    expect(qr.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await qr.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it("processes a valid Zalo webhook and sends reply", async () => {
    const { baseUrl, hermes, zalo } = await startBridge();
    const response = await fetch(`${baseUrl}/webhooks/zalo`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + "bridge-token" },
      body: JSON.stringify({
        type: "message.created",
        platform: "zalo",
        threadId: "thread-1",
        messageId: "msg-1",
        senderName: "Sender",
        chatType: "dm",
        text: "hello",
        timestamp: 1,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, hermesText: "bridge reply", messageId: "reply-msg" });
    expect(hermes.calls).toHaveLength(1);
    expect(zalo.calls).toEqual([{ threadId: "thread-1", isGroup: false, text: "bridge reply" }]);
  });
});
