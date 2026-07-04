import { describe, expect, it } from "vitest";
import { HermesBridgeOrchestrator } from "../../../src/bridge/hermes/orchestrator.js";
import type { HermesBridgeConfig, HermesRunInput, HermesRunResult, HermesRunner, ZaloGatewayClient, ZaloGatewaySendInput, ZaloGatewaySendResult, ZaloWebhookEvent } from "../../../src/bridge/hermes/types.js";

const config: HermesBridgeConfig = {
  host: "127.0.0.1",
  port: 8790,
  hermesCli: "hermes",
  sessionPrefix: "zalo",
  hermesTimeoutMs: 1000,
  zaloGatewayUrl: "http://127.0.0.1:8787",
  allowedSenders: [],
  allowedThreads: [],
};

class MockHermes implements HermesRunner {
  calls: HermesRunInput[] = [];
  result: HermesRunResult = { ok: true, text: "reply" };
  async run(input: HermesRunInput): Promise<HermesRunResult> {
    this.calls.push(input);
    return this.result;
  }
}

class MockZaloGateway implements ZaloGatewayClient {
  calls: ZaloGatewaySendInput[] = [];
  result: ZaloGatewaySendResult = { ok: true, messageId: "zalo-msg-1" };
  async sendMessage(input: ZaloGatewaySendInput): Promise<ZaloGatewaySendResult> {
    this.calls.push(input);
    return this.result;
  }
}

const event: ZaloWebhookEvent = {
  type: "message.created",
  platform: "zalo",
  threadId: "thread-1",
  messageId: "msg-1",
  senderId: "sender-1",
  senderName: "Sender",
  chatType: "group",
  text: "hello",
  timestamp: 1,
};

describe("HermesBridgeOrchestrator", () => {
  it("calls Hermes and sends the reply back through Zalo Gateway", async () => {
    const hermes = new MockHermes();
    const zalo = new MockZaloGateway();
    const orchestrator = new HermesBridgeOrchestrator(config, hermes, zalo);

    const result = await orchestrator.process(event);

    expect(result).toEqual({ ok: true, hermesText: "reply", messageId: "zalo-msg-1" });
    expect(hermes.calls).toEqual([{ sessionId: "zalo:thread-1", prompt: "[Zalo group] Sender: hello", timeoutMs: 1000 }]);
    expect(zalo.calls).toEqual([{ threadId: "thread-1", isGroup: true, text: "reply" }]);
  });

  it("ignores invalid, duplicate, disallowed, and empty-reply events", async () => {
    const hermes = new MockHermes();
    const zalo = new MockZaloGateway();
    const restricted = new HermesBridgeOrchestrator({ ...config, allowedSenders: ["other"] }, hermes, zalo);
    expect(await restricted.process(event)).toMatchObject({ ok: true, ignored: true, reason: "not allowed" });

    const orchestrator = new HermesBridgeOrchestrator(config, hermes, zalo);
    expect(await orchestrator.process({ ...event, text: "" })).toMatchObject({ ok: true, ignored: true, reason: "empty text" });
    expect(await orchestrator.process(event)).toMatchObject({ ok: true });
    expect(await orchestrator.process(event)).toMatchObject({ ok: true, ignored: true, reason: "duplicate" });

    const emptyHermes = new MockHermes();
    emptyHermes.result = { ok: true, text: "   " };
    const emptyReply = new HermesBridgeOrchestrator(config, emptyHermes, new MockZaloGateway());
    expect(await emptyReply.process({ ...event, messageId: "msg-2" })).toMatchObject({ ok: true, ignored: true, reason: "empty hermes reply" });
  });

  it("reports Hermes and Zalo Gateway failures", async () => {
    const hermes = new MockHermes();
    hermes.result = { ok: false, error: "hermes failed" };
    expect(await new HermesBridgeOrchestrator(config, hermes, new MockZaloGateway()).process(event)).toEqual({ ok: false, error: "hermes failed" });

    const zalo = new MockZaloGateway();
    zalo.result = { ok: false, error: "send failed" };
    expect(await new HermesBridgeOrchestrator(config, new MockHermes(), zalo).process(event)).toEqual({ ok: false, hermesText: "reply", error: "send failed" });
  });
});
