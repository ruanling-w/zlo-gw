import type { GatewayZaloClient } from "../zalo-client.js";
import type { JsonResponse } from "../types.js";

function json(status: number, body: unknown): JsonResponse {
  return { status, body };
}

function error(status: number, message: string): JsonResponse {
  return json(status, { ok: false, error: message });
}

function parsePositiveInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function friendsResponse(url: URL, client: GatewayZaloClient): Promise<JsonResponse> {
  const result = await client.listFriends({
    count: parsePositiveInt(url.searchParams.get("count")),
    page: parsePositiveInt(url.searchParams.get("page")),
  });
  return result.ok ? json(200, { ok: true, data: result.data ?? [] }) : error(502, result.error ?? "Failed to list friends");
}

export async function groupsResponse(client: GatewayZaloClient): Promise<JsonResponse> {
  const result = await client.listGroups();
  return result.ok ? json(200, { ok: true, data: result.data ?? [] }) : error(502, result.error ?? "Failed to list groups");
}

export async function groupMembersResponse(groupId: string, client: GatewayZaloClient): Promise<JsonResponse> {
  if (!groupId) return error(400, "groupId is required");
  const result = await client.getGroupMembers({ threadId: groupId });
  return result.ok ? json(200, { ok: true, data: result.data ?? [] }) : error(502, result.error ?? "Failed to list group members");
}
