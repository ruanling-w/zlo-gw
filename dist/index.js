// src/gateway/auth.ts
function extractBearerToken(header) {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return void 0;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || void 0;
}
function isAuthorized(request, expectedToken) {
  if (!expectedToken) return true;
  return extractBearerToken(request.headers.authorization) === expectedToken;
}
function requireBearerToken(request, expectedToken) {
  if (isAuthorized(request, expectedToken)) return { ok: true };
  return { ok: false, status: 401, error: "Unauthorized" };
}

// src/gateway/config.ts
var DEFAULT_HOST = "127.0.0.1";
var DEFAULT_PORT = 8787;
function parsePort(raw) {
  if (!raw) return DEFAULT_PORT;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid ZALO_GATEWAY_PORT: ${raw}`);
  }
  return port;
}
function parseWebhooks(raw) {
  if (!raw) return [];
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}
function loadGatewayConfig(env = process.env) {
  return {
    host: env.ZALO_GATEWAY_HOST?.trim() || DEFAULT_HOST,
    port: parsePort(env.ZALO_GATEWAY_PORT),
    token: env.ZALO_GATEWAY_TOKEN?.trim() || void 0,
    webhookToken: env.ZALO_GATEWAY_WEBHOOK_TOKEN?.trim() || void 0,
    webhooks: parseWebhooks(env.ZALO_GATEWAY_WEBHOOKS)
  };
}

// src/gateway/server.ts
import { createServer } from "node:http";

// src/gateway/routes/health.ts
async function healthResponse(options) {
  const zalo = options.getZaloStatus ? await options.getZaloStatus() : { status: "unknown", authenticated: false };
  const body = {
    ok: true,
    status: "ok",
    service: options.runtime.name,
    version: options.runtime.version,
    zalo
  };
  return { status: 200, body };
}
function versionResponse(runtime) {
  return {
    status: 200,
    body: runtime
  };
}

// src/client/zalo-client.ts
import { Zalo, LoginQRCallbackEventType } from "zca-js";

// src/client/credentials.ts
import { readFileSync, writeFileSync, unlinkSync, existsSync, chmodSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { homedir } from "node:os";
var DEFAULT_DATA_DIR = "run";
var CREDENTIALS_FILE = "zalo-credentials.json";
var LEGACY_CREDENTIALS_PATH = join(homedir(), ".openclaw", "zaloclaw-credentials.json");
function getGatewayDataDir(env = process.env) {
  const configured = env.ZALO_GATEWAY_DATA_DIR?.trim() || DEFAULT_DATA_DIR;
  return isAbsolute(configured) ? configured : join(process.cwd(), configured);
}
function getCredentialsPath(env = process.env) {
  return join(getGatewayDataDir(env), "credentials", CREDENTIALS_FILE);
}
function migrateLegacyCredentialsIfNeeded(path3 = getCredentialsPath()) {
  if (existsSync(path3) || !existsSync(LEGACY_CREDENTIALS_PATH)) return;
  const dir = dirname(path3);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 448 });
  copyFileSync(LEGACY_CREDENTIALS_PATH, path3);
  try {
    chmodSync(path3, 384);
  } catch {
  }
}
function loadCredentials() {
  const path3 = getCredentialsPath();
  migrateLegacyCredentialsIfNeeded(path3);
  if (!existsSync(path3)) {
    return null;
  }
  try {
    const raw = readFileSync(path3, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function hasCredentials() {
  const path3 = getCredentialsPath();
  migrateLegacyCredentialsIfNeeded(path3);
  return existsSync(path3);
}

// src/client/zalo-client.ts
import sharp from "sharp";
import * as fs from "fs";
var apiInstance = null;
var currentUid = null;
var loginPromise = null;
async function imageMetadataGetter(filePath) {
  const data = await fs.promises.readFile(filePath);
  const metadata = await sharp(data).metadata();
  return {
    height: metadata.height || 0,
    width: metadata.width || 0,
    size: metadata.size || data.length
  };
}
async function loginWithCredentials() {
  const creds = loadCredentials();
  if (!creds) {
    throw new Error("No saved credentials found. Login with QR first.");
  }
  const zalo = new Zalo({ logging: false, imageMetadataGetter });
  const api = await zalo.login({
    imei: creds.imei,
    cookie: creds.cookie,
    userAgent: creds.userAgent,
    language: creds.language
  });
  apiInstance = api;
  try {
    const raw = await api.fetchAccountInfo();
    const info = raw?.profile ?? raw;
    currentUid = info?.userId ?? null;
  } catch {
  }
  return api;
}
async function getApi() {
  if (apiInstance) {
    return apiInstance;
  }
  if (!hasCredentials()) {
    throw new Error("Not authenticated. Login with QR first.");
  }
  if (loginPromise) {
    return loginPromise;
  }
  loginPromise = loginWithCredentials().finally(() => {
    loginPromise = null;
  });
  return loginPromise;
}
function isAuthenticated() {
  return apiInstance !== null;
}
function hasStoredCredentials() {
  return hasCredentials();
}

// src/channel/send.ts
import { ThreadType, TextStyle } from "zca-js";

// src/parsing/mention-parser.ts
var MEMBER_CACHE_TTL_MS = 5 * 60 * 1e3;
var MEMBER_CACHE_MAX = 50;
var groupMemberCache = /* @__PURE__ */ new Map();
function normalizeName(name) {
  return name.trim().normalize("NFC");
}
function nameKey(name) {
  return normalizeName(name).toLowerCase();
}
function profileName(profile) {
  return normalizeName(
    String(
      profile?.displayName ?? profile?.display_name ?? profile?.dName ?? profile?.zaloName ?? profile?.zalo_name ?? profile?.name ?? ""
    )
  );
}
function buildIndex(members) {
  const cleaned = members.map((m) => ({ uid: m.uid, name: normalizeName(m.name) })).filter((m) => m.uid && m.name.length > 0);
  const counts = /* @__PURE__ */ new Map();
  for (const m of cleaned) {
    const key = nameKey(m.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const uniqueNameToUid = /* @__PURE__ */ new Map();
  for (const m of cleaned) {
    const key = nameKey(m.name);
    if (counts.get(key) === 1) uniqueNameToUid.set(key, m.uid);
  }
  const byNameLower = cleaned.map((m) => ({ nameLower: nameKey(m.name), nameOriginal: m.name, uid: m.uid })).sort((a, b) => b.nameLower.length - a.nameLower.length);
  return { byNameLower, uniqueNameToUid };
}
function upsertMembersFromProfiles(membersByUid, profiles) {
  for (const [uid, p] of Object.entries(profiles)) {
    const name = profileName(p);
    if (name) membersByUid.set(uid, { uid, name });
  }
}
async function fetchUserInfoProfiles(api, memberIds) {
  if (memberIds.length === 0) return {};
  try {
    const userInfoResp = await api.getUserInfo(memberIds);
    return userInfoResp?.changed_profiles ?? {};
  } catch {
    return {};
  }
}
async function loadGroupMemberIndex(groupId) {
  const cached = groupMemberCache.get(groupId);
  if (cached && Date.now() - cached.cachedAt < MEMBER_CACHE_TTL_MS) return cached.index;
  const api = await getApi();
  const groupResp = await api.getGroupInfo([groupId]);
  const info = groupResp?.gridInfoMap?.[groupId];
  if (!info) return buildIndex([]);
  let memberIds = info.memberIds ?? [];
  if (memberIds.length === 0) {
    const memVerList = info.memVerList ?? [];
    memberIds = memVerList.map((entry) => entry.split("_")[0]).filter(Boolean);
  }
  if (memberIds.length === 0) return buildIndex([]);
  const membersByUid = /* @__PURE__ */ new Map();
  const batchSize = 40;
  for (let i = 0; i < memberIds.length; i += batchSize) {
    const batch = memberIds.slice(i, i + batchSize);
    try {
      const profilesResp = await api.getGroupMembersInfo(batch);
      upsertMembersFromProfiles(membersByUid, profilesResp?.profiles ?? {});
    } catch (err) {
      console.error(`[mention-parser] getGroupMembersInfo batch failed for group ${groupId}:`, err);
    }
  }
  let missingMemberIds = memberIds.filter((uid) => !membersByUid.has(uid));
  if (missingMemberIds.length > 0) {
    const changedProfiles = await fetchUserInfoProfiles(api, missingMemberIds);
    upsertMembersFromProfiles(membersByUid, changedProfiles);
  }
  missingMemberIds = memberIds.filter((uid) => !membersByUid.has(uid));
  if (missingMemberIds.length > 0) {
    const settled = await Promise.allSettled(
      missingMemberIds.map((uid) => api.getUserInfo(uid))
    );
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      const changedProfiles = result.value?.changed_profiles ?? {};
      upsertMembersFromProfiles(membersByUid, changedProfiles);
    }
  }
  const members = Array.from(membersByUid.values());
  const index = buildIndex(members);
  if (groupMemberCache.size >= MEMBER_CACHE_MAX) {
    const firstKey = groupMemberCache.keys().next().value;
    if (firstKey) groupMemberCache.delete(firstKey);
  }
  groupMemberCache.set(groupId, { index, cachedAt: Date.now() });
  return index;
}
function isWordChar(ch) {
  if (!ch) return false;
  return /[\p{L}\p{N}_]/u.test(ch);
}
function longestNamePrefixMatch(rest, index) {
  const restLower = rest.toLowerCase();
  for (const entry of index.byNameLower) {
    if (restLower.startsWith(entry.nameLower)) {
      const after = rest[entry.nameLower.length];
      if (isWordChar(after)) continue;
      if (index.uniqueNameToUid.get(entry.nameLower) === entry.uid) {
        return rest.substring(0, entry.nameLower.length);
      }
    }
  }
  return null;
}
function parseOutboundMentions(input, index) {
  if (!input || index.byNameLower.length === 0) {
    return { text: input, mentions: [], stripIndices: [] };
  }
  let output = "";
  const mentions = [];
  const stripIndices = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "@") {
      const prev = i > 0 ? input[i - 1] : void 0;
      if (isWordChar(prev)) {
        output += ch;
        i++;
        continue;
      }
      if (input[i + 1] === "[") {
        const close = input.indexOf("]", i + 2);
        if (close !== -1) {
          const name = input.substring(i + 2, close);
          const uid = index.uniqueNameToUid.get(name.toLowerCase());
          if (uid) {
            const pos = output.length;
            output += "@" + name;
            mentions.push({ pos, uid, len: 1 + name.length });
            stripIndices.push(i + 1);
            stripIndices.push(close);
            i = close + 1;
            continue;
          }
        }
      }
      const rest = input.substring(i + 1);
      const matchedName = longestNamePrefixMatch(rest, index);
      if (matchedName) {
        const uid = index.uniqueNameToUid.get(matchedName.toLowerCase());
        if (uid) {
          const pos = output.length;
          output += "@" + matchedName;
          mentions.push({ pos, uid, len: 1 + matchedName.length });
          i += 1 + matchedName.length;
          continue;
        }
      }
    }
    output += ch;
    i++;
  }
  return { text: output, mentions, stripIndices };
}
async function resolveOutboundMentions(groupId, text) {
  if (!text || !groupId) return { text, mentions: [], stripIndices: [] };
  if (!text.includes("@")) return { text, mentions: [], stripIndices: [] };
  try {
    const index = await loadGroupMemberIndex(groupId);
    return parseOutboundMentions(text, index);
  } catch (err) {
    console.error(`[mention-parser] resolve failed for group ${groupId}:`, err);
    return { text, mentions: [], stripIndices: [] };
  }
}

// src/safety/output-filter.ts
var REDACTION_RULES = [
  { pattern: () => /\/root\/[^\s"'`)\]}>]+/g, replacement: "[path]" },
  { pattern: () => /\/home\/[^\s"'`)\]}>]+/g, replacement: "[path]" },
  { pattern: () => /~\/\.openclaw\/[^\s"'`)\]}>]+/g, replacement: "[path]" },
  { pattern: () => /\/usr\/lib\/node_modules\/[^\s"'`)\]}>]+/g, replacement: "[path]" },
  { pattern: () => /\bmcp__[a-z_-]+__[a-z_-]+/g, replacement: "[tool]" },
  { pattern: () => /openclaw\/plugin-sdk\/[^\s"'`)\]}>]+/g, replacement: "[internal]" },
  { pattern: () => /openclaw\/dist\/[^\s"'`)\]}>]+/g, replacement: "[internal]" },
  { pattern: () => /\bsession[_-]?id[:\s=]+[a-f0-9-]{36}/gi, replacement: "session [id]" },
  // [M2] Lowered from {20,} to {8,} to catch shorter secrets/tokens
  { pattern: () => /\b(api[_-]?key|token|secret|password|credential)[:\s=]+["']?[A-Za-z0-9_\-./+=]{8,}["']?/gi, replacement: "$1=[redacted]" },
  { pattern: () => /\bpm2\s+(restart|stop|start|delete|logs)\s+[^\s]+/g, replacement: "pm2 [command]" },
  { pattern: () => /at\s+[^\n]*node_modules[^\n]*/g, replacement: "at [internal]" },
  { pattern: () => /at\s+[^\n]*\/dist\/[^\n]*/g, replacement: "at [internal]" }
];
function redactOutput(text) {
  let result = text;
  for (const { pattern, replacement } of REDACTION_RULES) {
    result = result.replace(pattern(), replacement);
  }
  return result;
}

// src/channel/send.ts
import * as fs2 from "fs";
var ZALO_MAX_TEXT_LENGTH = 4e3;
var TRUNCATION_SUFFIX = "\n\n[...tin nh\u1EAFn qu\xE1 d\xE0i, \u0111\xE3 c\u1EAFt b\u1EDBt]";
function markdownToZaloStyles(input) {
  const styles = [];
  let text = input;
  text = text.replace(/^(#{1,6})\s+(.+)$/gm, (_m, _h, content) => content);
  const inlinePatterns = [
    { regex: /\*\*\*(.+?)\*\*\*/g, style: TextStyle.Bold },
    { regex: /\*\*(.+?)\*\*/g, style: TextStyle.Bold },
    { regex: /~~(.+?)~~/g, style: TextStyle.StrikeThrough },
    { regex: /__(.+?)__/g, style: TextStyle.Underline },
    { regex: /`([^`]+)`/g, style: TextStyle.Bold },
    { regex: /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, style: TextStyle.Italic }
  ];
  for (const { regex, style } of inlinePatterns) {
    let result = "";
    let lastIndex = 0;
    const pending = [];
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      result += text.slice(lastIndex, match.index);
      const start = result.length;
      const content = match[1];
      result += content;
      pending.push({ start, len: content.length, st: style });
      lastIndex = match.index + match[0].length;
    }
    if (pending.length > 0) {
      result += text.slice(lastIndex);
      text = result;
      styles.push(...pending);
    }
  }
  return { text, styles };
}
function countStripsBefore(sorted, value) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
async function sendMessageZaloClaw(threadId, text, options = {}) {
  if (!threadId?.trim()) return { ok: false, error: "No threadId provided" };
  if (options.localPath) {
    return uploadAndSendLocalImage(threadId, options.localPath, {
      ...options,
      caption: text || options.caption
    });
  }
  if (text && isLocalFilePath(text.trim()) && fs2.existsSync(text.trim())) {
    return uploadAndSendLocalImage(threadId, text.trim(), {
      ...options,
      caption: options.caption
    });
  }
  if (options.mediaUrl) {
    return sendMediaZaloClaw(threadId, options.mediaUrl, {
      ...options,
      caption: text || options.caption
    });
  }
  try {
    const api = await getApi();
    const type = options.isGroup ? ThreadType.Group : ThreadType.User;
    const redacted = redactOutput(text);
    const truncated = redacted.length > ZALO_MAX_TEXT_LENGTH ? redacted.slice(0, ZALO_MAX_TEXT_LENGTH - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX : redacted;
    const { text: postMarkdownText, styles } = markdownToZaloStyles(truncated);
    let outboundText = postMarkdownText;
    let mentions = [];
    let alignedStyles = styles;
    if (options.isGroup) {
      const resolved = await resolveOutboundMentions(threadId.trim(), postMarkdownText);
      outboundText = resolved.text;
      mentions = resolved.mentions;
      if (resolved.stripIndices.length > 0 && styles.length > 0) {
        alignedStyles = styles.map((s) => {
          const shift = countStripsBefore(resolved.stripIndices, s.start);
          return shift === 0 ? s : { ...s, start: s.start - shift };
        });
      }
    }
    const content = { msg: outboundText };
    if (alignedStyles.length > 0) content.styles = alignedStyles;
    if (mentions.length > 0) content.mentions = mentions;
    if (options.quote) content.quote = options.quote;
    const result = await api.sendMessage(content, threadId.trim(), type);
    const msgId = result?.message?.msgId;
    return { ok: true, messageId: msgId != null ? String(msgId) : void 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function sendMediaZaloClaw(threadId, mediaUrl, options = {}) {
  if (!threadId?.trim()) return { ok: false, error: "No threadId provided" };
  if (!mediaUrl?.trim()) return { ok: false, error: "No media URL provided" };
  try {
    const api = await getApi();
    const type = options.isGroup ? ThreadType.Group : ThreadType.User;
    const result = await api.sendLink(
      { link: mediaUrl.trim(), msg: options.caption || void 0 },
      threadId.trim(),
      type
    );
    const msgId = result?.msgId;
    return { ok: true, messageId: msgId != null ? String(msgId) : void 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function uploadAndSendLocalImage(threadId, localPath, options = {}) {
  if (!threadId?.trim()) return { ok: false, error: "No threadId provided" };
  if (!localPath?.trim()) return { ok: false, error: "No local path provided" };
  if (!fs2.existsSync(localPath)) return { ok: false, error: `File not found: ${localPath}` };
  try {
    const api = await getApi();
    const type = options.isGroup ? ThreadType.Group : ThreadType.User;
    const result = await api.sendMessage(
      { msg: options.caption || "", attachments: localPath },
      threadId.trim(),
      type
    );
    if (options.cleanupAfterUpload === true) {
      try {
        fs2.unlinkSync(localPath);
      } catch {
      }
    }
    const msgId = result?.message?.msgId;
    return { ok: true, messageId: msgId != null ? String(msgId) : void 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
function isLocalFilePath(str) {
  if (!str) return false;
  const trimmed = str.trim();
  if (/^https?:\/\//i.test(trimmed)) return false;
  return trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../");
}

// src/gateway/zalo-client.ts
var ZcaGatewayZaloClient = class {
  async status() {
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
      hasStoredCredentials: hasStoredCredentials()
    };
  }
  async sendText(input) {
    const result = await sendMessageZaloClaw(input.threadId, input.text, { isGroup: input.isGroup });
    return {
      ok: result.ok,
      messageId: result.messageId,
      threadId: input.threadId,
      error: result.error
    };
  }
  async replyMessage(input) {
    return this.sendText(input);
  }
  async addReaction(_input) {
    return { ok: false, error: "add-reaction is not implemented for the zca-js adapter yet" };
  }
  async getThreadInfo(input) {
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
          memberCount: info.totalMember
        }
      };
    }
    return {
      ok: true,
      data: {
        threadId: input.threadId,
        isGroup: input.isGroup ?? false
      }
    };
  }
  async getGroupMembers(input) {
    const api = await getApi();
    const groupInfo = await api.getGroupInfo(input.threadId);
    const memberIds = groupInfo.gridInfoMap?.[input.threadId]?.memberIds ?? [];
    const profiles = memberIds.length > 0 ? (await api.getGroupMembersInfo(memberIds)).profiles : {};
    return {
      ok: true,
      data: memberIds.map((userId) => ({
        userId,
        displayName: profiles[userId]?.displayName ?? profiles[userId]?.zaloName,
        avatar: profiles[userId]?.avatar
      }))
    };
  }
  async listFriends(input = {}) {
    const api = await getApi();
    const friends = await api.getAllFriends(input.count, input.page);
    return {
      ok: true,
      data: friends.map((friend) => ({
        userId: friend.userId,
        displayName: friend.displayName,
        zaloName: friend.zaloName,
        username: friend.username,
        avatar: friend.avatar
      }))
    };
  }
  async listGroups() {
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
          avatar: group?.avt
        };
      })
    };
  }
  async markRead(_input) {
    return { ok: false, error: "mark-read is not implemented for the zca-js adapter yet" };
  }
  onMessage(_handler) {
    return { dispose: () => void 0 };
  }
};

// src/gateway/routes/messages.ts
var MAX_TEXT_LENGTH = 4e3;
var MAX_BODY_BYTES = 128 * 1024;
async function readRequestBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function badRequest(error3, details) {
  return {
    status: 400,
    body: { ok: false, error: error3, details }
  };
}
function validateSendMessagePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, response: badRequest("Request body must be a JSON object") };
  }
  const record = payload;
  const threadId = typeof record.threadId === "string" ? record.threadId.trim() : "";
  const text = typeof record.text === "string" ? record.text : "";
  if (!threadId) return { ok: false, response: badRequest("threadId is required") };
  if (!text.trim()) return { ok: false, response: badRequest("text is required") };
  if (text.length > MAX_TEXT_LENGTH) return { ok: false, response: badRequest(`text must be <= ${MAX_TEXT_LENGTH} characters`) };
  if (record.isGroup !== void 0 && typeof record.isGroup !== "boolean") {
    return { ok: false, response: badRequest("isGroup must be a boolean") };
  }
  if (record.metadata !== void 0 && (typeof record.metadata !== "object" || record.metadata === null || Array.isArray(record.metadata))) {
    return { ok: false, response: badRequest("metadata must be an object") };
  }
  return {
    ok: true,
    value: {
      threadId,
      text,
      isGroup: record.isGroup,
      metadata: record.metadata
    }
  };
}
async function sendMessageResponse(request, zaloClient) {
  let payload;
  try {
    const raw = await readRequestBody(request);
    payload = raw.trim() ? JSON.parse(raw) : void 0;
  } catch (err) {
    return badRequest(err instanceof SyntaxError ? "Invalid JSON body" : err instanceof Error ? err.message : "Invalid request body");
  }
  const validated = validateSendMessagePayload(payload);
  if (!validated.ok) return validated.response;
  const result = await zaloClient.sendText(validated.value);
  if (!result.ok) {
    return {
      status: 502,
      body: {
        ok: false,
        error: result.error ?? "Failed to send Zalo message"
      }
    };
  }
  return {
    status: 200,
    body: {
      ok: true,
      messageId: result.messageId,
      threadId: result.threadId
    }
  };
}

// src/gateway/webhooks.ts
var DEFAULT_TIMEOUT_MS = 1e4;
function withTimeout(signal, timeoutMs) {
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
    }
  };
}
var WebhookDispatcher = class {
  constructor(urls, options = {}) {
    this.urls = urls;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.token = options.token;
  }
  urls;
  fetchImpl;
  timeoutMs;
  token;
  hasTargets() {
    return this.urls.length > 0;
  }
  async dispatch(event, signal) {
    const delivered = await Promise.all(this.urls.map((url) => this.deliver(url, event, signal)));
    return { delivered };
  }
  async deliver(url, event, signal) {
    const timeout = withTimeout(signal, this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.token ? { authorization: "Bearer " + this.token } : {}
        },
        body: JSON.stringify(event),
        signal: timeout.signal
      });
      return {
        url,
        ok: response.ok,
        status: response.status,
        error: response.ok ? void 0 : `Webhook returned HTTP ${response.status}`
      };
    } catch (err) {
      return {
        url,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      };
    } finally {
      timeout.cleanup();
    }
  }
};

// src/gateway/routes/actions.ts
var SUPPORTED_ACTIONS = [
  "send",
  "reply-message",
  "add-reaction",
  "get-thread-info",
  "get-group-members",
  "list-friends",
  "list-groups",
  "mark-read"
];
var MAX_BODY_BYTES2 = 128 * 1024;
function json(status, body) {
  return { status, body };
}
function error(status, message, details) {
  return json(status, { ok: false, error: message, details });
}
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function requiredString(record, key) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function optionalBoolean(record, key) {
  const value = record[key];
  return typeof value === "boolean" ? value : void 0;
}
async function readRequestBody2(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES2) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}
function sendTextInput(payload) {
  if (!isRecord(payload)) return { ok: false, response: error(400, "Request body must be a JSON object") };
  const threadId = requiredString(payload, "threadId");
  const text = typeof payload.text === "string" ? payload.text : "";
  if (!threadId) return { ok: false, response: error(400, "threadId is required") };
  if (!text.trim()) return { ok: false, response: error(400, "text is required") };
  if (payload.isGroup !== void 0 && typeof payload.isGroup !== "boolean") return { ok: false, response: error(400, "isGroup must be a boolean") };
  return { ok: true, value: { threadId, text, isGroup: optionalBoolean(payload, "isGroup") } };
}
async function send(payload, client) {
  const parsed = sendTextInput(payload);
  if (!parsed.ok) return parsed.response;
  const result = await client.sendText(parsed.value);
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}
async function replyMessage(payload, client) {
  const parsed = sendTextInput(payload);
  if (!parsed.ok) return parsed.response;
  const messageId = isRecord(payload) ? requiredString(payload, "messageId") : void 0;
  const result = await client.replyMessage({ ...parsed.value, messageId });
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}
async function addReaction(payload, client) {
  if (!isRecord(payload)) return error(400, "Request body must be a JSON object");
  const threadId = requiredString(payload, "threadId");
  const messageId = requiredString(payload, "messageId");
  const reaction = requiredString(payload, "reaction");
  if (!threadId) return error(400, "threadId is required");
  if (!messageId) return error(400, "messageId is required");
  if (!reaction) return error(400, "reaction is required");
  const result = await client.addReaction({ threadId, messageId, reaction, isGroup: optionalBoolean(payload, "isGroup") });
  return result.ok ? json(200, { ok: true, data: result.data ?? {} }) : error(502, result.error ?? "Action failed");
}
async function getThreadInfo(payload, client) {
  if (!isRecord(payload)) return error(400, "Request body must be a JSON object");
  const threadId = requiredString(payload, "threadId");
  if (!threadId) return error(400, "threadId is required");
  const result = await client.getThreadInfo({ threadId, isGroup: optionalBoolean(payload, "isGroup") });
  return result.ok ? json(200, { ok: true, data: result.data }) : error(502, result.error ?? "Action failed");
}
async function getGroupMembers(payload, client) {
  if (!isRecord(payload)) return error(400, "Request body must be a JSON object");
  const threadId = requiredString(payload, "threadId");
  if (!threadId) return error(400, "threadId is required");
  const result = await client.getGroupMembers({ threadId });
  return result.ok ? json(200, { ok: true, data: result.data ?? [] }) : error(502, result.error ?? "Action failed");
}
async function listFriends(payload, client) {
  const input = isRecord(payload) ? {
    count: typeof payload.count === "number" ? payload.count : void 0,
    page: typeof payload.page === "number" ? payload.page : void 0
  } : void 0;
  const result = await client.listFriends(input);
  return result.ok ? json(200, { ok: true, data: result.data ?? [] }) : error(502, result.error ?? "Action failed");
}
async function listGroups(_payload, client) {
  const result = await client.listGroups();
  return result.ok ? json(200, { ok: true, data: result.data ?? [] }) : error(502, result.error ?? "Action failed");
}
async function markRead(payload, client) {
  if (!isRecord(payload)) return error(400, "Request body must be a JSON object");
  const threadId = requiredString(payload, "threadId");
  if (!threadId) return error(400, "threadId is required");
  const result = await client.markRead({ threadId, isGroup: optionalBoolean(payload, "isGroup") });
  return result.ok ? json(200, { ok: true, data: result.data ?? {} }) : error(502, result.error ?? "Action failed");
}
var actionRegistry = {
  send,
  "reply-message": replyMessage,
  "add-reaction": addReaction,
  "get-thread-info": getThreadInfo,
  "get-group-members": getGroupMembers,
  "list-friends": listFriends,
  "list-groups": listGroups,
  "mark-read": markRead
};
function isSupportedAction(action) {
  return Object.hasOwn(actionRegistry, action);
}
async function actionResponse(action, request, client) {
  if (!isSupportedAction(action)) return error(404, `Unsupported action: ${action}`, { supported: SUPPORTED_ACTIONS });
  let payload;
  try {
    payload = await readRequestBody2(request);
  } catch (err) {
    return error(400, err instanceof SyntaxError ? "Invalid JSON body" : err instanceof Error ? err.message : "Invalid request body");
  }
  return actionRegistry[action](payload, client);
}

// src/gateway/routes/directory.ts
function json2(status, body) {
  return { status, body };
}
function error2(status, message) {
  return json2(status, { ok: false, error: message });
}
function parsePositiveInt(value) {
  if (!value) return void 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : void 0;
}
async function friendsResponse(url, client) {
  const result = await client.listFriends({
    count: parsePositiveInt(url.searchParams.get("count")),
    page: parsePositiveInt(url.searchParams.get("page"))
  });
  return result.ok ? json2(200, { ok: true, data: result.data ?? [] }) : error2(502, result.error ?? "Failed to list friends");
}
async function groupsResponse(client) {
  const result = await client.listGroups();
  return result.ok ? json2(200, { ok: true, data: result.data ?? [] }) : error2(502, result.error ?? "Failed to list groups");
}
async function groupMembersResponse(groupId, client) {
  if (!groupId) return error2(400, "groupId is required");
  const result = await client.getGroupMembers({ threadId: groupId });
  return result.ok ? json2(200, { ok: true, data: result.data ?? [] }) : error2(502, result.error ?? "Failed to list group members");
}

// src/gateway/server.ts
function defaultRuntime() {
  return {
    name: "zalo-api-gateway",
    version: "0.1.0",
    node: process.version
  };
}
function sendJson(response, result) {
  const body = JSON.stringify(result.body);
  response.writeHead(result.status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body).toString(),
    ...result.headers
  });
  response.end(body);
}
function notFound() {
  return {
    status: 404,
    body: {
      ok: false,
      error: "Not found"
    }
  };
}
function methodNotAllowed() {
  return {
    status: 405,
    body: {
      ok: false,
      error: "Method not allowed"
    }
  };
}
function routeUrl(request) {
  const host = request.headers.host ?? "127.0.0.1";
  return new URL(request.url ?? "/", `http://${host}`);
}
function createGatewayServer(options = {}) {
  const config = options.config ?? loadGatewayConfig();
  const runtime = options.runtime ?? defaultRuntime();
  const zaloClient = options.zaloClient ?? new ZcaGatewayZaloClient();
  const webhookDispatcher = new WebhookDispatcher(config.webhooks, { token: config.webhookToken });
  const getZaloStatus = options.getZaloStatus ?? (async () => {
    const status = await zaloClient.status();
    return { status: status.status, authenticated: status.authenticated };
  });
  const inboundSubscription = zaloClient.onMessage((event) => {
    if (!webhookDispatcher.hasTargets()) return;
    void webhookDispatcher.dispatch(event).then((result) => {
      for (const delivery of result.delivered) {
        if (!delivery.ok) {
          console.warn(`[zalo-api-gateway] webhook delivery failed url=${delivery.url} error=${delivery.error ?? delivery.status ?? "unknown"}`);
        }
      }
    });
  });
  const server = createServer(async (request, response) => {
    try {
      const url = routeUrl(request);
      const path3 = url.pathname;
      if (path3 === "/health") {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        return sendJson(response, await healthResponse({ runtime, getZaloStatus }));
      }
      if (path3 === "/version") {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        return sendJson(response, versionResponse(runtime));
      }
      if (path3 === "/messages/send") {
        if (request.method !== "POST") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, await sendMessageResponse(request, zaloClient));
      }
      if (path3 === "/friends") {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, await friendsResponse(url, zaloClient));
      }
      if (path3 === "/groups") {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, await groupsResponse(zaloClient));
      }
      const groupMembersMatch = /^\/groups\/([^/]+)\/members$/.exec(path3);
      if (groupMembersMatch) {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, await groupMembersResponse(decodeURIComponent(groupMembersMatch[1]), zaloClient));
      }
      if (path3.startsWith("/actions/")) {
        if (request.method !== "POST") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        const action = decodeURIComponent(path3.slice("/actions/".length));
        return sendJson(response, await actionResponse(action, request, zaloClient));
      }
      return sendJson(response, notFound());
    } catch (err) {
      return sendJson(response, {
        status: 500,
        body: {
          ok: false,
          error: err instanceof Error ? err.message : "Internal server error"
        }
      });
    }
  });
  server.once("close", () => inboundSubscription.dispose());
  return { server, config, runtime, webhookDispatcher };
}
async function listenGateway(options = {}) {
  const gateway = createGatewayServer(options);
  await new Promise((resolve3, reject) => {
    gateway.server.once("error", reject);
    gateway.server.listen(gateway.config.port, gateway.config.host, () => {
      gateway.server.off("error", reject);
      resolve3();
    });
  });
  return gateway;
}

// src/bridge/hermes/config.ts
var DEFAULT_HOST2 = "127.0.0.1";
var DEFAULT_PORT2 = 8790;
var DEFAULT_TIMEOUT_MS2 = 12e4;
function parsePort2(raw) {
  if (!raw) return DEFAULT_PORT2;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid HERMES_BRIDGE_PORT: ${raw}`);
  }
  return port;
}
function parseTimeout(raw) {
  if (!raw) return DEFAULT_TIMEOUT_MS2;
  const timeout = Number.parseInt(raw, 10);
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error(`Invalid HERMES_TIMEOUT_MS: ${raw}`);
  }
  return timeout;
}
function parseList(raw) {
  if (!raw) return [];
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}
function loadHermesBridgeConfig(env = process.env) {
  return {
    host: env.HERMES_BRIDGE_HOST?.trim() || DEFAULT_HOST2,
    port: parsePort2(env.HERMES_BRIDGE_PORT),
    token: env.HERMES_BRIDGE_TOKEN?.trim() || void 0,
    hermesCli: env.HERMES_CLI?.trim() || "hermes",
    sessionPrefix: env.HERMES_SESSION_PREFIX?.trim() || "zalo",
    hermesTimeoutMs: parseTimeout(env.HERMES_TIMEOUT_MS),
    zaloGatewayUrl: env.ZALO_GATEWAY_URL?.trim() || "http://127.0.0.1:8787",
    zaloGatewayToken: env.ZALO_GATEWAY_TOKEN?.trim() || void 0,
    allowedSenders: parseList(env.HERMES_BRIDGE_ALLOWED_SENDERS),
    allowedThreads: parseList(env.HERMES_BRIDGE_ALLOWED_THREADS)
  };
}

// src/bridge/hermes/hermes-cli.ts
import { spawn } from "node:child_process";
var HermesCliRunner = class {
  constructor(command) {
    this.command = command;
  }
  command;
  async run(input) {
    return new Promise((resolve3) => {
      const child = spawn(this.command, ["--continue", input.sessionId, "-z", input.prompt], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve3({ ok: false, error: "Hermes CLI timed out" });
      }, input.timeoutMs);
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve3({ ok: false, error: err.message });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          return resolve3({ ok: true, text: stdout.trim() });
        }
        return resolve3({ ok: false, error: stderr.trim() || `Hermes CLI exited with code ${code}` });
      });
    });
  }
};

// src/bridge/hermes/orchestrator.ts
var DEDUP_TTL_MS = 10 * 60 * 1e3;
var DEDUP_MAX = 2e3;
var HermesBridgeOrchestrator = class {
  constructor(config, hermes, zaloGateway) {
    this.config = config;
    this.hermes = hermes;
    this.zaloGateway = zaloGateway;
  }
  config;
  hermes;
  zaloGateway;
  seenMessageIds = /* @__PURE__ */ new Map();
  async process(event) {
    const validated = this.validateEvent(event);
    if (!validated.ok) return { ok: true, ignored: true, reason: validated.reason };
    const message = validated.event;
    if (this.isDuplicate(message.messageId)) return { ok: true, ignored: true, reason: "duplicate" };
    if (!this.isAllowed(message)) return { ok: true, ignored: true, reason: "not allowed" };
    const hermesResult = await this.hermes.run({
      sessionId: `${this.config.sessionPrefix}:${message.threadId}`,
      prompt: this.formatPrompt(message),
      timeoutMs: this.config.hermesTimeoutMs
    });
    if (!hermesResult.ok) return { ok: false, error: hermesResult.error ?? "Hermes failed" };
    const text = hermesResult.text?.trim() ?? "";
    if (!text) return { ok: true, ignored: true, reason: "empty hermes reply" };
    const sendResult = await this.zaloGateway.sendMessage({
      threadId: message.threadId,
      isGroup: message.chatType === "group",
      text
    });
    if (!sendResult.ok) return { ok: false, hermesText: text, error: sendResult.error ?? "Failed to send Zalo reply" };
    return { ok: true, hermesText: text, messageId: sendResult.messageId };
  }
  validateEvent(event) {
    if (!event || typeof event !== "object" || Array.isArray(event)) return { ok: false, reason: "invalid event" };
    const record = event;
    if (record.type !== "message.created" || record.platform !== "zalo") return { ok: false, reason: "unsupported event" };
    if (typeof record.threadId !== "string" || !record.threadId.trim()) return { ok: false, reason: "missing threadId" };
    if (record.chatType !== "dm" && record.chatType !== "group") return { ok: false, reason: "invalid chatType" };
    if (typeof record.text !== "string" || !record.text.trim()) return { ok: false, reason: "empty text" };
    return { ok: true, event: record };
  }
  isAllowed(event) {
    if (this.config.allowedThreads.length > 0 && !this.config.allowedThreads.includes(event.threadId)) return false;
    if (this.config.allowedSenders.length > 0 && (!event.senderId || !this.config.allowedSenders.includes(event.senderId))) return false;
    return true;
  }
  isDuplicate(messageId) {
    if (!messageId) return false;
    const now = Date.now();
    if (this.seenMessageIds.has(messageId)) return true;
    if (this.seenMessageIds.size >= DEDUP_MAX) {
      for (const [id, ts] of this.seenMessageIds) {
        if (now - ts > DEDUP_TTL_MS) this.seenMessageIds.delete(id);
      }
      if (this.seenMessageIds.size >= DEDUP_MAX) {
        const oldest = this.seenMessageIds.keys().next().value;
        if (oldest) this.seenMessageIds.delete(oldest);
      }
    }
    this.seenMessageIds.set(messageId, now);
    return false;
  }
  formatPrompt(event) {
    const sender = event.senderName || event.senderId || "Zalo user";
    return `[Zalo ${event.chatType}] ${sender}: ${event.text}`;
  }
};

// src/bridge/hermes/server.ts
import { createServer as createServer2 } from "node:http";

// src/bridge/hermes/zalo-gateway-client.ts
var HttpZaloGatewayClient = class {
  constructor(baseUrl, token, fetchImpl = fetch) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }
  baseUrl;
  token;
  fetchImpl;
  async sendMessage(input) {
    try {
      const response = await this.fetchImpl(new URL("/messages/send", this.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.token ? { authorization: "Bearer " + this.token } : {}
        },
        body: JSON.stringify(input)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        return { ok: false, error: body.error ?? `Zalo Gateway returned HTTP ${response.status}` };
      }
      return { ok: true, messageId: body.messageId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
};

// src/bridge/hermes/server.ts
function sendJson2(response, result) {
  const body = JSON.stringify(result.body);
  response.writeHead(result.status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body).toString(),
    ...result.headers
  });
  response.end(body);
}
function routePath(request) {
  const host = request.headers.host ?? "127.0.0.1";
  return new URL(request.url ?? "/", `http://${host}`).pathname;
}
async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : void 0;
}
function createHermesBridgeServer(options = {}) {
  const config = options.config ?? loadHermesBridgeConfig();
  const hermesRunner = options.hermesRunner ?? new HermesCliRunner(config.hermesCli);
  const zaloGatewayClient = options.zaloGatewayClient ?? new HttpZaloGatewayClient(config.zaloGatewayUrl, config.zaloGatewayToken);
  const orchestrator = new HermesBridgeOrchestrator(config, hermesRunner, zaloGatewayClient);
  const server = createServer2(async (request, response) => {
    try {
      const path3 = routePath(request);
      if (path3 === "/health") {
        if (request.method !== "GET") return sendJson2(response, { status: 405, body: { ok: false, error: "Method not allowed" } });
        return sendJson2(response, { status: 200, body: { ok: true, service: "zalo-hermes-bridge" } });
      }
      if (path3 === "/webhooks/zalo") {
        if (request.method !== "POST") return sendJson2(response, { status: 405, body: { ok: false, error: "Method not allowed" } });
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson2(response, { status: auth.status, body: { ok: false, error: auth.error } });
        const event = await readJson(request);
        const result = await orchestrator.process(event);
        return sendJson2(response, { status: result.ok ? 200 : 502, body: result });
      }
      return sendJson2(response, { status: 404, body: { ok: false, error: "Not found" } });
    } catch (err) {
      return sendJson2(response, { status: 400, body: { ok: false, error: err instanceof SyntaxError ? "Invalid JSON body" : err instanceof Error ? err.message : "Bad request" } });
    }
  });
  return { server, config, orchestrator };
}
async function listenHermesBridge(options = {}) {
  const bridge = createHermesBridgeServer(options);
  await new Promise((resolve3, reject) => {
    bridge.server.once("error", reject);
    bridge.server.listen(bridge.config.port, bridge.config.host, () => {
      bridge.server.off("error", reject);
      resolve3();
    });
  });
  return bridge;
}

// src/gateway/zalo-client.mock.ts
var MockGatewayZaloClient = class {
  constructor(currentStatus = {
    status: "disconnected",
    authenticated: false,
    hasStoredCredentials: false
  }) {
    this.currentStatus = currentStatus;
  }
  currentStatus;
  handlers = /* @__PURE__ */ new Set();
  sentMessages = [];
  replies = [];
  reactions = [];
  markReadCalls = [];
  nextSendResult;
  nextReplyResult;
  nextActionResult;
  threadInfo = { threadId: "thread-1", isGroup: false, name: "Mock Thread" };
  groupMembers = [];
  friends = [];
  groups = [];
  async status() {
    return this.currentStatus;
  }
  setStatus(status) {
    this.currentStatus = status;
  }
  async sendText(input) {
    this.sentMessages.push(input);
    return {
      ok: true,
      messageId: `mock-${this.sentMessages.length}`,
      threadId: input.threadId,
      ...this.nextSendResult
    };
  }
  async replyMessage(input) {
    this.replies.push(input);
    return {
      ok: true,
      messageId: `reply-${this.replies.length}`,
      threadId: input.threadId,
      ...this.nextReplyResult
    };
  }
  async addReaction(input) {
    this.reactions.push(input);
    return this.nextActionResult ?? { ok: true, data: { reacted: true } };
  }
  async getThreadInfo(input) {
    return { ok: true, data: { ...this.threadInfo, threadId: input.threadId, isGroup: input.isGroup ?? this.threadInfo.isGroup } };
  }
  async getGroupMembers(_input) {
    return { ok: true, data: this.groupMembers };
  }
  async listFriends(_input = {}) {
    return { ok: true, data: this.friends };
  }
  async listGroups() {
    return { ok: true, data: this.groups };
  }
  async markRead(input) {
    this.markReadCalls.push(input);
    return this.nextActionResult ?? { ok: true, data: { marked: true } };
  }
  onMessage(handler) {
    this.handlers.add(handler);
    return {
      dispose: () => {
        this.handlers.delete(handler);
      }
    };
  }
  emit(event) {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
  listenerCount() {
    return this.handlers.size;
  }
};

// src/zalo/message-normalizer.ts
import { ThreadType as ThreadType2 } from "zca-js";
import * as crypto3 from "node:crypto";
import * as fs5 from "node:fs";
import sharp2 from "sharp";

// src/channel/file-downloader.ts
import * as fs3 from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as os from "os";

// src/safety/url-validator.ts
import { URL as URL2 } from "node:url";
import * as dns from "node:dns/promises";
import * as net from "node:net";
var MAX_DOWNLOAD_SIZE_BYTES = 50 * 1024 * 1024;
var DOWNLOAD_TIMEOUT_MS = 3e4;
function isPrivateIp(ip) {
  const normalized = ip.replace(/^::ffff:/i, "");
  if (net.isIPv4(normalized)) {
    const parts = normalized.split(".").map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  if (net.isIPv6(normalized)) {
    const lower = normalized.toLowerCase();
    if (lower === "::1") return true;
    if (lower === "::") return true;
    if (lower.startsWith("fe80:")) return true;
    if (/^f[cd]/i.test(lower)) return true;
    return false;
  }
  return true;
}
async function validateUrlForOutboundFetch(rawUrl) {
  let parsed;
  try {
    parsed = new URL2(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Blocked URL scheme: ${parsed.protocol} (only http/https allowed)`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials are not allowed");
  }
  let hostname = parsed.hostname;
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Blocked private/internal IP: ${hostname}`);
    }
    return parsed;
  }
  try {
    const addresses = await dns.resolve4(hostname).catch(() => []);
    const addresses6 = await dns.resolve6(hostname).catch(() => []);
    const allAddresses = [...addresses, ...addresses6];
    if (allAddresses.length === 0) {
      throw new Error(`DNS resolution failed for: ${hostname}`);
    }
    for (const ip of allAddresses) {
      if (isPrivateIp(ip)) {
        throw new Error(`Blocked: ${hostname} resolves to private/internal IP ${ip}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Blocked")) throw err;
    throw new Error(`DNS validation failed for ${hostname}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parsed;
}
async function safeFetch(rawUrl, options = {}) {
  const maxSize = options.maxSizeBytes ?? MAX_DOWNLOAD_SIZE_BYTES;
  const timeout = options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  if (!options.skipSsrfCheck) {
    await validateUrlForOutboundFetch(rawUrl);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(rawUrl, {
      signal: controller.signal,
      redirect: "follow"
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > maxSize) {
      throw new Error(`File too large: ${contentLength} bytes (max ${maxSize})`);
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }
    const chunks = [];
    let totalSize = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.length;
      if (totalSize > maxSize) {
        reader.cancel();
        throw new Error(`Download exceeded size limit: ${totalSize} bytes (max ${maxSize})`);
      }
      chunks.push(value);
    }
    return {
      buffer: Buffer.concat(chunks),
      contentType: response.headers.get("content-type")
    };
  } finally {
    clearTimeout(timer);
  }
}

// src/channel/file-downloader.ts
var MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
async function downloadFileFromUrl(url, workspaceDir) {
  try {
    const targetDir = workspaceDir || path.join(os.homedir(), ".openclaw/media/inbound");
    if (!fs3.existsSync(targetDir)) {
      fs3.mkdirSync(targetDir, { recursive: true });
    }
    const urlHash = crypto.createHash("sha256").update(url).digest("hex").substring(0, 12);
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").substring(0, 19);
    const ext = getSafeExtension(url) || "file";
    const filename = `${timestamp}-zalo-file-${urlHash}.${ext}`;
    const filePath = path.join(targetDir, filename);
    const resolvedPath = path.resolve(filePath);
    const resolvedDir = path.resolve(targetDir);
    if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
      console.error(`[file-downloader] Path traversal blocked: ${filePath}`);
      return void 0;
    }
    const isZaloCdn = /^https:\/\/(?:[a-z0-9-]+\.)*(?:zalo|zadn|zdn)\.(?:vn|me)\//i.test(url);
    const { buffer, contentType } = await safeFetch(url, {
      maxSizeBytes: MAX_FILE_SIZE_BYTES,
      skipSsrfCheck: isZaloCdn
    });
    if (contentType) {
      console.log(`[file-downloader] Downloaded ${contentType} from ${url}`);
    }
    fs3.writeFileSync(filePath, buffer);
    console.log(`[file-downloader] Saved to ${filePath} (${buffer.length} bytes)`);
    return filePath;
  } catch (err) {
    console.error(`[file-downloader] Error downloading ${url}:`, err);
    return void 0;
  }
}
function getSafeExtension(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    if (match) {
      return match[1].toLowerCase();
    }
  } catch {
  }
  return "";
}

// src/channel/image-downloader.ts
import * as fs4 from "fs";
import * as path2 from "path";
import * as crypto2 from "crypto";
import * as os2 from "os";
var MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
var ALLOWED_EXTENSIONS = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "tiff"]);
var ALLOWED_MIME_TYPES = /* @__PURE__ */ new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
  "image/tiff"
]);
var IMAGE_MAGIC_BYTES = [
  { prefix: [255, 216, 255], type: "jpeg" },
  // JPEG
  { prefix: [137, 80, 78, 71], type: "png" },
  // PNG
  { prefix: [71, 73, 70, 56], type: "gif" },
  // GIF (GIF87a/GIF89a)
  { prefix: [82, 73, 70, 70], type: "webp" },
  // WebP (RIFF container)
  { prefix: [66, 77], type: "bmp" }
  // BMP
];
function detectImageType(buffer) {
  for (const { prefix, type } of IMAGE_MAGIC_BYTES) {
    if (buffer.length >= prefix.length) {
      const match = prefix.every((byte, i) => buffer[i] === byte);
      if (match) return type;
    }
  }
  const head = buffer.subarray(0, 100).toString("utf8").trim().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml") && head.includes("<svg")) {
    return "svg";
  }
  return void 0;
}
async function downloadImageFromUrl(url, workspaceDir) {
  try {
    const targetDir = workspaceDir || path2.join(os2.homedir(), ".openclaw/media/inbound");
    if (!fs4.existsSync(targetDir)) {
      fs4.mkdirSync(targetDir, { recursive: true });
    }
    const urlHash = crypto2.createHash("sha256").update(url).digest("hex").substring(0, 12);
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").substring(0, 19);
    const ext = getSafeExtension2(url);
    const filename = `${timestamp}-zalo-${urlHash}.${ext}`;
    const filePath = path2.join(targetDir, filename);
    const resolvedPath = path2.resolve(filePath);
    const resolvedDir = path2.resolve(targetDir);
    if (!resolvedPath.startsWith(resolvedDir + path2.sep)) {
      console.error(`[image-downloader] Path traversal blocked: ${filePath}`);
      return void 0;
    }
    const isZaloCdn = /^https:\/\/(?:[a-z0-9-]+\.)*(?:zalo|zadn|zdn)\.(?:vn|me)\//i.test(url);
    const { buffer, contentType } = await safeFetch(url, {
      maxSizeBytes: MAX_IMAGE_SIZE_BYTES,
      skipSsrfCheck: isZaloCdn
    });
    const mimeBase = contentType?.split(";")[0]?.trim().toLowerCase();
    if (mimeBase && !ALLOWED_MIME_TYPES.has(mimeBase) && !mimeBase.startsWith("image/")) {
      console.warn(`[image-downloader] Rejected non-image content-type "${contentType}" from ${url}`);
      return void 0;
    }
    const detectedType = detectImageType(buffer);
    if (!detectedType) {
      const headStr = buffer.subarray(0, 200).toString("utf8").toLowerCase();
      if (headStr.includes("<!doctype") || headStr.includes("<html") || headStr.includes("<head")) {
        console.warn(`[image-downloader] Rejected HTML content disguised as image from ${url}`);
        return void 0;
      }
      console.warn(`[image-downloader] Unknown image format from ${url}, saving anyway`);
    }
    fs4.writeFileSync(filePath, buffer);
    return filePath;
  } catch (err) {
    console.error(`[image-downloader] Error downloading ${url}:`, err);
    return void 0;
  }
}
function getSafeExtension2(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    if (match) {
      const ext = match[1].toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) return ext;
    }
  } catch {
  }
  return "jpg";
}

// src/zalo/message-normalizer.ts
var DEDUP_TTL = 6e4;
var DEDUP_MAX2 = 2e3;
var processedMsgIds = /* @__PURE__ */ new Map();
function isDuplicateMsg(msgId) {
  if (!msgId) return false;
  const now = Date.now();
  if (processedMsgIds.has(msgId)) return true;
  if (processedMsgIds.size >= DEDUP_MAX2) {
    for (const [id, ts] of processedMsgIds) {
      if (now - ts > DEDUP_TTL) processedMsgIds.delete(id);
    }
    if (processedMsgIds.size >= DEDUP_MAX2) {
      const oldest = processedMsgIds.keys().next().value;
      if (oldest) processedMsgIds.delete(oldest);
    }
  }
  processedMsgIds.set(msgId, now);
  return false;
}
var SYSTEM_NOTIFICATION_PATTERNS = [
  /^Bạn vừa kết bạn với\b/i,
  /^You (?:are|were) (?:now )?(?:friends|connected) with\b/i,
  /^You just became friends with\b/i
];
var IMAGE_URL_RE = /\.(?:jpe?g|png|gif|webp|bmp|svg|tiff?)(?:[?#]|$)/i;
var GENERIC_FILE_URL_RE = /\.(?:pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar)(?:[?#]|$)/i;
function isSystemNotificationContent(content) {
  const normalized = content.trim();
  return SYSTEM_NOTIFICATION_PATTERNS.some((pattern) => pattern.test(normalized));
}
function pushMediaUrl(mediaUrls, mediaTypes, url, mimeType) {
  if (typeof url !== "string" || !url.trim()) return;
  const trimmed = url.trim();
  if (mediaUrls.includes(trimmed)) return;
  mediaUrls.push(trimmed);
  mediaTypes.push(mimeType);
}
function mediaMimeFromObject(obj) {
  const raw = [obj.type, obj.mediaType, obj.contentType, obj.mimeType, obj.msgType].map((value) => typeof value === "string" || typeof value === "number" ? String(value).toLowerCase() : "").join(" ");
  if (raw.includes("photo") || raw.includes("image")) return "image/jpeg";
  if (raw.includes("video")) return "video/mp4";
  if (raw.includes("audio") || raw.includes("voice")) return "audio/mpeg";
  if (raw.includes("file") || raw.includes("attach")) return "application/octet-stream";
  return void 0;
}
function looksLikeExplicitFileObject(obj, url) {
  const hasFileName = ["fileName", "filename", "name"].some((key) => typeof obj[key] === "string" && String(obj[key]).trim().length > 0);
  const hasFileSize = ["fileSize", "size"].some((key) => obj[key] !== void 0 && obj[key] !== null);
  return hasFileName || hasFileSize || GENERIC_FILE_URL_RE.test(url) || IMAGE_URL_RE.test(url);
}
function fileSha256(filePath) {
  try {
    return crypto3.createHash("sha256").update(fs5.readFileSync(filePath)).digest("hex");
  } catch {
    return void 0;
  }
}
function looksLikeHtmlFile(filePath) {
  try {
    const head = fs5.readFileSync(filePath).subarray(0, 512).toString("utf8").trim().toLowerCase();
    return head.includes("<!doctype") || head.includes("<html") || head.includes("<head");
  } catch {
    return false;
  }
}
function extractMediaFromObject(obj, mediaUrls, mediaTypes) {
  if (!obj || typeof obj !== "object") return "";
  const record = obj;
  const title = typeof record.title === "string" ? record.title : "";
  const description = typeof record.description === "string" ? record.description : "";
  const mimeType = mediaMimeFromObject(record);
  const photoUrl = record.hdUrl || record.normalUrl || record.oriUrl;
  if (photoUrl) {
    pushMediaUrl(mediaUrls, mediaTypes, photoUrl, "image/jpeg");
  }
  const href = typeof record.href === "string" ? record.href : typeof record.url === "string" ? record.url : "";
  if (href && (mimeType || looksLikeExplicitFileObject(record, href))) {
    pushMediaUrl(mediaUrls, mediaTypes, href, mimeType ?? (IMAGE_URL_RE.test(href) ? "image/jpeg" : "application/octet-stream"));
  }
  return title || description || (mediaUrls.length > 0 ? "[Media attachment]" : "");
}
function convertToZaloClawMessage(msg) {
  const data = msg.data;
  let content = "";
  const mediaUrls = [];
  const mediaTypes = [];
  if (typeof data.content === "string") {
    const trimmed = data.content.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null) {
          content = extractMediaFromObject(parsed, mediaUrls, mediaTypes);
          if (!content && !mediaUrls.length) content = data.content;
        } else {
          content = data.content;
        }
      } catch {
        content = data.content;
      }
    } else {
      content = data.content;
    }
  } else if (typeof data.content === "object" && data.content !== null) {
    content = extractMediaFromObject(data.content, mediaUrls, mediaTypes);
    if (!content && mediaUrls.length > 0) content = "[Media attachment]";
  }
  if (content && isSystemNotificationContent(content)) return null;
  if (!content.trim() && mediaUrls.length === 0) return null;
  const quote = data.quote;
  const isGroup = msg.type === ThreadType2.Group;
  const threadId = msg.threadId;
  const rawSenderId = data.uidFrom;
  const senderId = !isGroup && (!rawSenderId?.trim() || !/^\d+$/.test(rawSenderId.trim())) ? threadId : rawSenderId;
  const senderName = data.dName ?? "";
  const timestamp = data.ts ? parseInt(data.ts, 10) : Math.floor(Date.now() / 1e3);
  const mentions = isGroup && msg.data.mentions ? msg.data.mentions : void 0;
  return {
    threadId,
    msgId: data.msgId,
    cliMsgId: data.cliMsgId,
    type: isGroup ? 1 : 0,
    content: content || "[Media]",
    mediaUrls: mediaUrls.length > 0 ? mediaUrls : void 0,
    mediaTypes: mediaTypes.length > 0 ? mediaTypes : void 0,
    mentions: mentions ?? void 0,
    timestamp,
    quote: quote ? {
      msg: quote.msg || void 0,
      fromId: quote.ownerId || void 0,
      fromName: quote.fromD || void 0,
      msgId: quote.globalMsgId ? String(quote.globalMsgId) : void 0,
      ts: quote.ts || void 0
    } : void 0,
    metadata: {
      isGroup,
      groupId: isGroup ? threadId : void 0,
      senderName,
      fromId: senderId
    }
  };
}
function isImageAttachment(url, mediaType) {
  const type = mediaType?.toLowerCase() ?? "";
  return type.startsWith("image/") || IMAGE_URL_RE.test(url);
}
async function downloadInboundMedia(message) {
  const urls = message.mediaUrls ?? [];
  const mediaTypes = message.mediaTypes ?? [];
  const downloaded = [];
  const seenUrls = /* @__PURE__ */ new Set();
  const seenHashes = /* @__PURE__ */ new Set();
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    const mediaType = mediaTypes[i];
    const localPath = isImageAttachment(url, mediaType) ? await downloadImageFromUrl(url) : await downloadFileFromUrl(url);
    if (!localPath) continue;
    const hash = fileSha256(localPath);
    if (hash && seenHashes.has(hash)) {
      try {
        fs5.rmSync(localPath, { force: true });
      } catch {
      }
      continue;
    }
    if (hash) seenHashes.add(hash);
    if (!downloaded.includes(localPath)) downloaded.push(localPath);
  }
  return downloaded;
}
async function filterAttachableMediaPaths(paths) {
  const filtered = [];
  for (const filePath of paths) {
    try {
      const metadata = await sharp2(filePath).metadata();
      if (metadata.width && metadata.height) {
        const minSide = Math.min(metadata.width, metadata.height);
        const maxSide = Math.max(metadata.width, metadata.height);
        const aspectRatio = maxSide / minSide;
        if (minSide < 180) {
          console.warn(`[zaloclaw] Dropping tiny image attachment ${filePath} (${metadata.width}x${metadata.height})`);
          continue;
        }
        if (aspectRatio >= 4 && minSide < 300) {
          console.warn(`[zaloclaw] Dropping banner-like image attachment ${filePath} (${metadata.width}x${metadata.height})`);
          continue;
        }
      }
    } catch {
      if (IMAGE_URL_RE.test(filePath) || looksLikeHtmlFile(filePath)) {
        console.warn(`[zaloclaw] Dropping invalid image attachment ${filePath}`);
        continue;
      }
    }
    filtered.push(filePath);
  }
  return filtered;
}
export {
  HermesBridgeOrchestrator,
  HermesCliRunner,
  HttpZaloGatewayClient,
  MockGatewayZaloClient,
  SUPPORTED_ACTIONS,
  WebhookDispatcher,
  ZcaGatewayZaloClient,
  actionRegistry,
  actionResponse,
  convertToZaloClawMessage,
  createGatewayServer,
  createHermesBridgeServer,
  downloadInboundMedia,
  extractBearerToken,
  filterAttachableMediaPaths,
  friendsResponse,
  groupMembersResponse,
  groupsResponse,
  healthResponse,
  isAuthorized,
  isDuplicateMsg,
  isSupportedAction,
  isSystemNotificationContent,
  listenGateway,
  listenHermesBridge,
  loadGatewayConfig,
  loadHermesBridgeConfig,
  processedMsgIds,
  requireBearerToken,
  sendMessageResponse,
  validateSendMessagePayload,
  versionResponse
};
