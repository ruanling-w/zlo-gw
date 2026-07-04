import type { GatewayHealth, GatewayRuntimeInfo, JsonResponse, ZaloConnectionStatus } from "../types.js";

export type HealthRouteOptions = {
  runtime: GatewayRuntimeInfo;
  getZaloStatus?: () => Promise<{ status: ZaloConnectionStatus; authenticated: boolean }> | { status: ZaloConnectionStatus; authenticated: boolean };
};

export async function healthResponse(options: HealthRouteOptions): Promise<JsonResponse> {
  const zalo = options.getZaloStatus
    ? await options.getZaloStatus()
    : { status: "unknown" as const, authenticated: false };

  const body: GatewayHealth = {
    ok: true,
    status: "ok",
    service: options.runtime.name,
    version: options.runtime.version,
    zalo,
  };

  return { status: 200, body };
}

export function versionResponse(runtime: GatewayRuntimeInfo): JsonResponse {
  return {
    status: 200,
    body: runtime,
  };
}
