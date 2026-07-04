import type { FriendInfo, GatewayZaloClient, GroupMember, GroupSummary } from "../zalo-client.js";
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

function includesQuery(values: Array<string | undefined>, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => value?.toLowerCase().includes(needle));
}

function filterFriends(items: FriendInfo[], query: string): FriendInfo[] {
  return items.filter((item) => includesQuery([item.userId, item.displayName, item.zaloName, item.username], query));
}

function filterGroups(items: GroupSummary[], query: string): GroupSummary[] {
  return items.filter((item) => includesQuery([item.groupId, item.name], query));
}

function filterMembers(items: GroupMember[], query: string): GroupMember[] {
  return items.filter((item) => includesQuery([item.userId, item.displayName], query));
}

export async function friendsResponse(url: URL, client: GatewayZaloClient): Promise<JsonResponse> {
  const result = await client.listFriends({
    count: parsePositiveInt(url.searchParams.get("count")),
    page: parsePositiveInt(url.searchParams.get("page")),
  });
  if (!result.ok) return error(502, result.error ?? "Failed to list friends");
  const query = url.searchParams.get("query") ?? "";
  return json(200, { ok: true, data: filterFriends(result.data ?? [], query) });
}

export async function groupsResponse(url: URL, client: GatewayZaloClient): Promise<JsonResponse> {
  const result = await client.listGroups();
  if (!result.ok) return error(502, result.error ?? "Failed to list groups");
  const query = url.searchParams.get("query") ?? "";
  return json(200, { ok: true, data: filterGroups(result.data ?? [], query) });
}

export async function groupMembersResponse(groupId: string, url: URL, client: GatewayZaloClient): Promise<JsonResponse> {
  if (!groupId) return error(400, "groupId is required");
  const result = await client.getGroupMembers({ threadId: groupId });
  if (!result.ok) return error(502, result.error ?? "Failed to list group members");
  const query = url.searchParams.get("query") ?? "";
  return json(200, { ok: true, data: filterMembers(result.data ?? [], query) });
}
