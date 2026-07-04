import type { NormalizedZaloEvent } from "./zalo-client.js";

export type WebhookDelivery = {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
};

export type WebhookDispatchResult = {
  delivered: WebhookDelivery[];
};

export type WebhookDispatcherOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  token?: string;
};

const DEFAULT_TIMEOUT_MS = 10_000;

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error("Webhook dispatch timed out")), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

export class WebhookDispatcher {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly token?: string;

  constructor(private readonly urls: string[], options: WebhookDispatcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.token = options.token;
  }

  hasTargets(): boolean {
    return this.urls.length > 0;
  }

  async dispatch(event: NormalizedZaloEvent, signal?: AbortSignal): Promise<WebhookDispatchResult> {
    const delivered = await Promise.all(this.urls.map((url) => this.deliver(url, event, signal)));
    return { delivered };
  }

  private async deliver(url: string, event: NormalizedZaloEvent, signal?: AbortSignal): Promise<WebhookDelivery> {
    const timeout = withTimeout(signal, this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.token ? { authorization: "Bearer " + this.token } : {}),
        },
        body: JSON.stringify(event),
        signal: timeout.signal,
      });
      return {
        url,
        ok: response.ok,
        status: response.status,
        error: response.ok ? undefined : `Webhook returned HTTP ${response.status}`,
      };
    } catch (err) {
      return {
        url,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      timeout.cleanup();
    }
  }
}
