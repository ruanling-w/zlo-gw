export type HermesBridgeConfig = {
  host: string;
  port: number;
  token?: string;
  hermesCli: string;
  sessionPrefix: string;
  hermesTimeoutMs: number;
  zaloGatewayUrl: string;
  zaloGatewayToken?: string;
  allowedSenders: string[];
  allowedThreads: string[];
};

export type ZaloWebhookEvent = {
  type: "message.created";
  platform: "zalo";
  threadId: string;
  messageId?: string;
  senderId?: string;
  senderName?: string;
  chatType: "dm" | "group";
  text: string;
  timestamp: number;
  raw?: unknown;
};

export type HermesRunInput = {
  sessionId: string;
  prompt: string;
  timeoutMs: number;
};

export type HermesRunResult = {
  ok: boolean;
  text?: string;
  error?: string;
};

export interface HermesRunner {
  run(input: HermesRunInput): Promise<HermesRunResult>;
}

export type ZaloGatewaySendInput = {
  threadId: string;
  isGroup: boolean;
  text: string;
};

export type ZaloGatewaySendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

export type ZaloGatewayLoginStatus = {
  sessionId?: string;
  status: string;
  qrImageBase64?: string;
  displayName?: string;
  authenticatedHint?: boolean;
  error?: string;
  startedAt?: number;
};

export interface ZaloGatewayClient {
  sendMessage(input: ZaloGatewaySendInput): Promise<ZaloGatewaySendResult>;
  startQrLogin(): Promise<{ ok: boolean; data?: ZaloGatewayLoginStatus; error?: string }>;
  getQrLoginStatus(): Promise<{ ok: boolean; data?: ZaloGatewayLoginStatus; error?: string }>;
  getQrLoginImage(): Promise<{ ok: boolean; contentType?: string; bytes?: Uint8Array; error?: string }>;
}

export type BridgeProcessResult = {
  ok: boolean;
  ignored?: boolean;
  reason?: string;
  hermesText?: string;
  messageId?: string;
  error?: string;
};
