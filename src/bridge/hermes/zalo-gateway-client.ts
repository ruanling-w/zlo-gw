import type { ZaloGatewayClient, ZaloGatewayLoginStatus, ZaloGatewaySendInput, ZaloGatewaySendResult } from "./types.js";

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
        headers: this.jsonHeaders(),
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

  async startQrLogin(): Promise<{ ok: boolean; data?: ZaloGatewayLoginStatus; error?: string }> {
    return this.gatewayJson("/login/qr/start", "POST");
  }

  async getQrLoginStatus(): Promise<{ ok: boolean; data?: ZaloGatewayLoginStatus; error?: string }> {
    return this.gatewayJson("/login/qr/status", "GET");
  }

  async getQrLoginImage(): Promise<{ ok: boolean; contentType?: string; bytes?: Uint8Array; error?: string }> {
    try {
      const response = await this.fetchImpl(new URL("/login/qr/image", this.baseUrl), {
        method: "GET",
        headers: this.authHeaders(),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        return { ok: false, error: body.error ?? `Zalo Gateway returned HTTP ${response.status}` };
      }
      return { ok: true, contentType: response.headers.get("content-type") ?? "image/png", bytes: new Uint8Array(await response.arrayBuffer()) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async gatewayJson(path: string, method: "GET" | "POST"): Promise<{ ok: boolean; data?: ZaloGatewayLoginStatus; error?: string }> {
    try {
      const response = await this.fetchImpl(new URL(path, this.baseUrl), {
        method,
        headers: this.jsonHeaders(),
      });
      const body = await response.json().catch(() => ({})) as { ok?: boolean; data?: ZaloGatewayLoginStatus; error?: string };
      if (!response.ok || body.ok === false) return { ok: false, error: body.error ?? `Zalo Gateway returned HTTP ${response.status}` };
      return { ok: true, data: body.data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private jsonHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...this.authHeaders(),
    };
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { authorization: "Bearer " + this.token } : {};
  }
}
