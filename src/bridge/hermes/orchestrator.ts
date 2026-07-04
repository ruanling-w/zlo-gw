import type { BridgeProcessResult, HermesBridgeConfig, HermesRunner, ZaloGatewayClient, ZaloWebhookEvent } from "./types.js";

const DEDUP_TTL_MS = 10 * 60 * 1000;
const DEDUP_MAX = 2000;

export class HermesBridgeOrchestrator {
  private readonly seenMessageIds = new Map<string, number>();

  constructor(
    private readonly config: HermesBridgeConfig,
    private readonly hermes: HermesRunner,
    private readonly zaloGateway: ZaloGatewayClient,
  ) {}

  async process(event: unknown): Promise<BridgeProcessResult> {
    const validated = this.validateEvent(event);
    if (!validated.ok) return { ok: true, ignored: true, reason: validated.reason };
    const message = validated.event;

    if (this.isDuplicate(message.messageId)) return { ok: true, ignored: true, reason: "duplicate" };
    if (!this.isAllowed(message)) return { ok: true, ignored: true, reason: "not allowed" };

    const hermesResult = await this.hermes.run({
      sessionId: `${this.config.sessionPrefix}:${message.threadId}`,
      prompt: this.formatPrompt(message),
      timeoutMs: this.config.hermesTimeoutMs,
    });
    if (!hermesResult.ok) return { ok: false, error: hermesResult.error ?? "Hermes failed" };
    const text = hermesResult.text?.trim() ?? "";
    if (!text) return { ok: true, ignored: true, reason: "empty hermes reply" };

    const sendResult = await this.zaloGateway.sendMessage({
      threadId: message.threadId,
      isGroup: message.chatType === "group",
      text,
    });
    if (!sendResult.ok) return { ok: false, hermesText: text, error: sendResult.error ?? "Failed to send Zalo reply" };

    return { ok: true, hermesText: text, messageId: sendResult.messageId };
  }

  private validateEvent(event: unknown): { ok: true; event: ZaloWebhookEvent } | { ok: false; reason: string } {
    if (!event || typeof event !== "object" || Array.isArray(event)) return { ok: false, reason: "invalid event" };
    const record = event as Record<string, unknown>;
    if (record.type !== "message.created" || record.platform !== "zalo") return { ok: false, reason: "unsupported event" };
    if (typeof record.threadId !== "string" || !record.threadId.trim()) return { ok: false, reason: "missing threadId" };
    if (record.chatType !== "dm" && record.chatType !== "group") return { ok: false, reason: "invalid chatType" };
    if (typeof record.text !== "string" || !record.text.trim()) return { ok: false, reason: "empty text" };
    return { ok: true, event: record as ZaloWebhookEvent };
  }

  private isAllowed(event: ZaloWebhookEvent): boolean {
    if (this.config.allowedThreads.length > 0 && !this.config.allowedThreads.includes(event.threadId)) return false;
    if (this.config.allowedSenders.length > 0 && (!event.senderId || !this.config.allowedSenders.includes(event.senderId))) return false;
    return true;
  }

  private isDuplicate(messageId: string | undefined): boolean {
    if (!messageId) return false;
    const now = Date.now();
    if (this.seenMessageIds.has(messageId)) return true;
    if (this.seenMessageIds.size >= DEDUP_MAX) {
      for (const [id, ts] of this.seenMessageIds) {
        if (now - ts > DEDUP_TTL_MS) this.seenMessageIds.delete(id);
      }
      if (this.seenMessageIds.size >= DEDUP_MAX) {
        const oldest = this.seenMessageIds.keys().next().value;
        if (oldest) this.seenMessageIds.delete(oldest);
      }
    }
    this.seenMessageIds.set(messageId, now);
    return false;
  }

  private formatPrompt(event: ZaloWebhookEvent): string {
    const sender = event.senderName || event.senderId || "Zalo user";
    return `[Zalo ${event.chatType}] ${sender}: ${event.text}`;
  }
}
