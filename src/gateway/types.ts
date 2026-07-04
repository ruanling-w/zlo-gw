export type GatewayStatus = "ok" | "degraded";

export type ZaloConnectionStatus = "unknown" | "connected" | "disconnected";

export type GatewayConfig = {
  host: string;
  port: number;
  token?: string;
  eventsToken?: string;
  webhookToken?: string;
  webhooks: string[];
  allowedSenders: string[];
  allowedThreads: string[];
  deniedSenders: string[];
  deniedThreads: string[];
};

export type GatewayRuntimeInfo = {
  name: string;
  version: string;
  node: string;
};

export type GatewayHealth = {
  ok: boolean;
  status: GatewayStatus;
  service: string;
  version: string;
  zalo: {
    status: ZaloConnectionStatus;
    authenticated: boolean;
  };
};

export type JsonResponse = {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
};
