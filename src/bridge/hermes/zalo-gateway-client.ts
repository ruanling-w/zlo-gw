import type { ZaloGatewayClient, ZaloGatewaySendInput, ZaloGatewaySendResult } from "./types.js";

export class HttpZaloGatewayClient implements ZaloGatewayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendMessage(input: ZaloGatewaySendInput): Promise<ZaloGatewaySendResult> {
    try {
      const response = await this.fetchImpl(new URL("/messages/send", this.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.token ? { authorization: "Bearer " + this.token } : {}),
        },
        body: JSON.stringify(input),
      });
      const body = await response.json().catch(() => ({})) as { ok?: boolean; messageId?: string; error?: string };
      if (!response.ok || body.ok === false) {
        return { ok: false, error: body.error ?? `Zalo Gateway returned HTTP ${response.status}` };
      }
      return { ok: true, messageId: body.messageId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
