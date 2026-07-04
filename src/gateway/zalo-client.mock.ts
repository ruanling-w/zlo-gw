import type {
  ActionResult,
  Disposable,
  FriendInfo,
  GatewayZaloClient,
  GroupMember,
  GroupSummary,
  NormalizedZaloEvent,
  SendMessageResult,
  SendTextInput,
  ThreadInfo,
  ZaloGatewayStatus,
} from "./zalo-client.js";

export class MockGatewayZaloClient implements GatewayZaloClient {
  private handlers = new Set<(event: NormalizedZaloEvent) => void>();
  public sentMessages: SendTextInput[] = [];
  public replies: Array<SendTextInput & { messageId?: string }> = [];
  public reactions: Array<{ threadId: string; messageId: string; reaction: string; isGroup?: boolean }> = [];
  public markReadCalls: Array<{ threadId: string; isGroup?: boolean }> = [];
  public nextSendResult?: Partial<SendMessageResult>;
  public nextReplyResult?: Partial<SendMessageResult>;
  public nextActionResult?: ActionResult;
  public threadInfo: ThreadInfo = { threadId: "thread-1", isGroup: false, name: "Mock Thread" };
  public groupMembers: GroupMember[] = [];
  public friends: FriendInfo[] = [];
  public groups: GroupSummary[] = [];

  constructor(private currentStatus: ZaloGatewayStatus = {
    status: "disconnected",
    authenticated: false,
    hasStoredCredentials: false,
  }) {}

  async status(): Promise<ZaloGatewayStatus> {
    return this.currentStatus;
  }

  setStatus(status: ZaloGatewayStatus): void {
    this.currentStatus = status;
  }

  async sendText(input: SendTextInput): Promise<SendMessageResult> {
    this.sentMessages.push(input);
    return {
      ok: true,
      messageId: `mock-${this.sentMessages.length}`,
      threadId: input.threadId,
      ...this.nextSendResult,
    };
  }

  async replyMessage(input: SendTextInput & { messageId?: string }): Promise<SendMessageResult> {
    this.replies.push(input);
    return {
      ok: true,
      messageId: `reply-${this.replies.length}`,
      threadId: input.threadId,
      ...this.nextReplyResult,
    };
  }

  async addReaction(input: { threadId: string; messageId: string; reaction: string; isGroup?: boolean }): Promise<ActionResult> {
    this.reactions.push(input);
    return this.nextActionResult ?? { ok: true, data: { reacted: true } };
  }

  async getThreadInfo(input: { threadId: string; isGroup?: boolean }): Promise<ActionResult<ThreadInfo>> {
    return { ok: true, data: { ...this.threadInfo, threadId: input.threadId, isGroup: input.isGroup ?? this.threadInfo.isGroup } };
  }

  async getGroupMembers(_input: { threadId: string }): Promise<ActionResult<GroupMember[]>> {
    return { ok: true, data: this.groupMembers };
  }

  async listFriends(_input: { count?: number; page?: number } = {}): Promise<ActionResult<FriendInfo[]>> {
    return { ok: true, data: this.friends };
  }

  async listGroups(): Promise<ActionResult<GroupSummary[]>> {
    return { ok: true, data: this.groups };
  }

  async markRead(input: { threadId: string; isGroup?: boolean }): Promise<ActionResult> {
    this.markReadCalls.push(input);
    return this.nextActionResult ?? { ok: true, data: { marked: true } };
  }

  onMessage(handler: (event: NormalizedZaloEvent) => void): Disposable {
    this.handlers.add(handler);
    return {
      dispose: () => {
        this.handlers.delete(handler);
      },
    };
  }

  emit(event: NormalizedZaloEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  listenerCount(): number {
    return this.handlers.size;
  }
}
