import type { ServerResponse } from "node:http";
import type { NormalizedZaloEvent } from "./zalo-client.js";

export type GatewayEventRecord = {
  id: string;
  event: string;
  data: NormalizedZaloEvent | { ts: number };
};

export type GatewayEventSubscription = {
  id: number;
  write(record: GatewayEventRecord): boolean;
  close(): void;
};

const DEFAULT_REPLAY_LIMIT = 500;
const DEFAULT_HEARTBEAT_MS = 15_000;

function formatSseRecord(record: GatewayEventRecord): string {
  return `id: ${record.id}\nevent: ${record.event}\ndata: ${JSON.stringify(record.data)}\n\n`;
}

export class GatewayEventHub {
  private nextSequence = 1;
  private nextSubscriptionId = 1;
  private readonly records: GatewayEventRecord[] = [];
  private readonly subscriptions = new Map<number, GatewayEventSubscription>();
  private readonly replayLimit: number;

  constructor(options: { replayLimit?: number } = {}) {
    this.replayLimit = options.replayLimit ?? DEFAULT_REPLAY_LIMIT;
  }

  publishMessage(event: NormalizedZaloEvent): GatewayEventRecord {
    const record: GatewayEventRecord = {
      id: this.nextEventId(event),
      event: event.type,
      data: event,
    };
    this.records.push(record);
    if (this.records.length > this.replayLimit) this.records.splice(0, this.records.length - this.replayLimit);
    for (const subscription of this.subscriptions.values()) subscription.write(record);
    return record;
  }

  subscribe(response: ServerResponse, options: { lastEventId?: string; heartbeatMs?: number } = {}): GatewayEventSubscription {
    const id = this.nextSubscriptionId++;
    const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    const subscription: GatewayEventSubscription = {
      id,
      write: (record) => response.write(formatSseRecord(record)),
      close: () => {
        clearInterval(heartbeat);
        this.subscriptions.delete(id);
        if (!response.destroyed) response.end();
      },
    };
    this.subscriptions.set(id, subscription);

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.write(`: connected\n\n`);

    for (const record of this.replayAfter(options.lastEventId)) subscription.write(record);
    const heartbeat = setInterval(() => {
      subscription.write({ id: `heartbeat-${Date.now()}`, event: "heartbeat", data: { ts: Date.now() } });
    }, heartbeatMs);
    response.once("close", subscription.close);
    return subscription;
  }

  closeAll(): void {
    for (const subscription of [...this.subscriptions.values()]) subscription.close();
  }

  listenerCount(): number {
    return this.subscriptions.size;
  }

  private replayAfter(lastEventId: string | undefined): GatewayEventRecord[] {
    if (!lastEventId) return [];
    const index = this.records.findIndex((record) => record.id === lastEventId);
    return index >= 0 ? this.records.slice(index + 1) : [];
  }

  private nextEventId(event: NormalizedZaloEvent): string {
    const suffix = event.messageId?.trim() || String(this.nextSequence);
    return `${this.nextSequence++}:${suffix}`;
  }
}
