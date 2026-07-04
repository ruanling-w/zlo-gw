import { ThreadType, type Message } from "zca-js";
import { getApi, hasStoredCredentials, isAuthenticated, loginWithCredentials } from "../client/zalo-client.js";
import { sendMessageZaloClaw } from "../channel/send.js";

export type Disposable = {
  dispose: () => void;
};

export type ZaloGatewayStatus = {
  status: "connected" | "disconnected";
  authenticated: boolean;
  hasStoredCredentials: boolean;
};

export type SendTextInput = {
  threadId: string;
  text: string;
  isGroup?: boolean;
  metadata?: {
    urgency?: number;
    messageTtl?: number;
  };
};

export type SendMessageResult = {
  ok: boolean;
  messageId?: string;
  threadId: string;
  error?: string;
};

export type ThreadInfo = {
  threadId: string;
  isGroup: boolean;
  name?: string;
  memberCount?: number;
};

export type GroupMember = {
  userId: string;
  displayName?: string;
  avatar?: string;
};

export type FriendInfo = {
  userId: string;
  displayName?: string;
  zaloName?: string;
  username?: string;
  avatar?: string;
};

export type GroupSummary = {
  groupId: string;
  name?: string;
  memberCount?: number;
  avatar?: string;
};

export type ActionResult<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: string;
};

export type NormalizedZaloEvent = {
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

export interface GatewayZaloClient {
  status(): Promise<ZaloGatewayStatus>;
  sendText(input: SendTextInput): Promise<SendMessageResult>;
  replyMessage(input: SendTextInput & { messageId?: string }): Promise<SendMessageResult>;
  addReaction(input: { threadId: string; messageId: string; reaction: string; isGroup?: boolean }): Promise<ActionResult>;
  getThreadInfo(input: { threadId: string; isGroup?: boolean }): Promise<ActionResult<ThreadInfo>>;
  getGroupMembers(input: { threadId: string }): Promise<ActionResult<GroupMember[]>>;
  listFriends(input?: { count?: number; page?: number }): Promise<ActionResult<FriendInfo[]>>;
  listGroups(): Promise<ActionResult<GroupSummary[]>>;
  markRead(input: { threadId: string; isGroup?: boolean }): Promise<ActionResult>;
  onMessage(handler: (event: NormalizedZaloEvent) => void): Disposable;
}

export function normalizeGatewayZaloEvent(message: Message): NormalizedZaloEvent | undefined {
  if (message.isSelf) return undefined;
  const content = message.data.content;
  const text = typeof content === "string" ? content : JSON.stringify(content);
  if (!text.trim()) return undefined;
  const isGroup = message.type === ThreadType.Group;
  return {
    type: "message.created",
    platform: "zalo",
    threadId: message.threadId,
    messageId: message.data.msgId || message.data.cliMsgId,
    senderId: isGroup ? message.data.uidFrom : message.threadId,
    senderName: message.data.dName,
    chatType: isGroup ? "group" : "dm",
    text,
    timestamp: message.data.ts ? Number.parseInt(message.data.ts, 10) : Date.now(),
    raw: message,
  };
}

export class ZcaGatewayZaloClient implements GatewayZaloClient {
  private listenerStarted = false;
  async status(): Promise<ZaloGatewayStatus> {
    let authenticated = isAuthenticated();
    if (!authenticated && hasStoredCredentials()) {
      try {
        await loginWithCredentials();
        authenticated = true;
      } catch {
        authenticated = false;
      }
    }
    return {
      status: authenticated ? "connected" : "disconnected",
      authenticated,
      hasStoredCredentials: hasStoredCredentials(),
    };
  }

  async sendText(input: SendTextInput): Promise<SendMessageResult> {
    const result = await sendMessageZaloClaw(input.threadId, input.text, { isGroup: input.isGroup });
    return {
      ok: result.ok,
      messageId: result.messageId,
      threadId: input.threadId,
      error: result.error,
    };
  }

  async replyMessage(input: SendTextInput & { messageId?: string }): Promise<SendMessageResult> {
    return this.sendText(input);
  }

  async addReaction(_input: { threadId: string; messageId: string; reaction: string; isGroup?: boolean }): Promise<ActionResult> {
    return { ok: false, error: "add-reaction is not implemented for the zca-js adapter yet" };
  }

  async getThreadInfo(input: { threadId: string; isGroup?: boolean }): Promise<ActionResult<ThreadInfo>> {
    if (input.isGroup) {
      const api = await getApi();
      const response = await api.getGroupInfo(input.threadId);
      const info = response.gridInfoMap?.[input.threadId];
      if (!info) return { ok: false, error: "Group not found" };
      return {
        ok: true,
        data: {
          threadId: info.groupId,
          isGroup: true,
          name: info.name,
          memberCount: info.totalMember,
        },
      };
    }
    return {
      ok: true,
      data: {
        threadId: input.threadId,
        isGroup: input.isGroup ?? false,
      },
    };
  }

  async getGroupMembers(input: { threadId: string }): Promise<ActionResult<GroupMember[]>> {
    const api = await getApi();
    const groupInfo = await api.getGroupInfo(input.threadId);
    const memberIds = groupInfo.gridInfoMap?.[input.threadId]?.memberIds ?? [];
    const profiles = memberIds.length > 0 ? (await api.getGroupMembersInfo(memberIds)).profiles : {};
    return {
      ok: true,
      data: memberIds.map((userId) => ({
        userId,
        displayName: profiles[userId]?.displayName ?? profiles[userId]?.zaloName,
        avatar: profiles[userId]?.avatar,
      })),
    };
  }

  async listFriends(input: { count?: number; page?: number } = {}): Promise<ActionResult<FriendInfo[]>> {
    const api = await getApi();
    const friends = await api.getAllFriends(input.count, input.page);
    return {
      ok: true,
      data: friends.map((friend) => ({
        userId: friend.userId,
        displayName: friend.displayName,
        zaloName: friend.zaloName,
        username: friend.username,
        avatar: friend.avatar,
      })),
    };
  }

  async listGroups(): Promise<ActionResult<GroupSummary[]>> {
    const api = await getApi();
    const groups = await api.getAllGroups();
    const groupIds = Object.keys(groups.gridVerMap ?? {});
    if (groupIds.length === 0) return { ok: true, data: [] };
    const info = await api.getGroupInfo(groupIds);
    return {
      ok: true,
      data: groupIds.map((groupId) => {
        const group = info.gridInfoMap?.[groupId];
        return {
          groupId,
          name: group?.name,
          memberCount: group?.totalMember,
          avatar: group?.avt,
        };
      }),
    };
  }

  async markRead(_input: { threadId: string; isGroup?: boolean }): Promise<ActionResult> {
    return { ok: false, error: "mark-read is not implemented for the zca-js adapter yet" };
  }

  onMessage(handler: (event: NormalizedZaloEvent) => void): Disposable {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void getApi().then((api) => {
      if (disposed) return;
      const onRawMessage = (message: Message) => {
        const event = normalizeGatewayZaloEvent(message);
        if (event) handler(event);
      };
      api.listener.on("message", onRawMessage);
      cleanup = () => api.listener.off("message", onRawMessage);
      if (!this.listenerStarted) {
        api.listener.start({ retryOnClose: true });
        this.listenerStarted = true;
      }
    }).catch((err) => {
      console.warn(`[zalo-api-gateway] failed to start Zalo listener: ${err instanceof Error ? err.message : String(err)}`);
    });

    return {
      dispose: () => {
        disposed = true;
        cleanup?.();
      },
    };
  }
}
