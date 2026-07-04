// src/env/load-dotenv.ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const index = trimmed.indexOf("=");
  if (index <= 0) return null;
  const key = trimmed.slice(0, index).trim();
  let value = trimmed.slice(index + 1).trim();
  if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }
  return [key, value];
}
function loadDotEnv(path = resolve(process.cwd(), ".env")) {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    process.env[key] ??= value;
  }
}
loadDotEnv();

// src/gateway/server.ts
import { createServer } from "node:http";

// src/gateway/policy.ts
var WILDCARD = "*";
function parsePolicyList(raw) {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((item) => item.trim()).filter(Boolean))];
}
function listValues(list) {
  return list ?? [];
}
function matches(list, value) {
  const values = listValues(list);
  if (values.includes(WILDCARD)) return true;
  return Boolean(value && values.includes(value));
}
function hasConfiguredAllowlists(policy) {
  return Array.isArray(policy.allowedSenders) || Array.isArray(policy.allowedThreads);
}
function allowedSender(policy, senderId) {
  return matches(policy.allowedSenders, senderId);
}
function allowedThread(policy, threadId) {
  return matches(policy.allowedThreads, threadId);
}
function decideInboundPolicy(event, policy) {
  if (matches(policy.deniedSenders, event.senderId)) return { allowed: false, reason: "sender_denied" };
  if (matches(policy.deniedThreads, event.threadId)) return { allowed: false, reason: "thread_denied" };
  if (!hasConfiguredAllowlists(policy)) return { allowed: true };
  if (event.chatType === "group") {
    return allowedThread(policy, event.threadId) ? { allowed: true } : { allowed: false, reason: "thread_not_allowed" };
  }
  return allowedSender(policy, event.senderId) ? { allowed: true } : { allowed: false, reason: "sender_not_allowed" };
}
function decideOutboundPolicy(input, policy) {
  if (matches(policy.deniedThreads, input.threadId)) return { allowed: false, reason: "thread_denied" };
  if (!hasConfiguredAllowlists(policy)) return { allowed: true };
  if (input.isGroup) {
    return allowedThread(policy, input.threadId) ? { allowed: true } : { allowed: false, reason: "thread_not_allowed" };
  }
  if (matches(policy.deniedSenders, input.threadId)) return { allowed: false, reason: "sender_denied" };
  return allowedSender(policy, input.threadId) ? { allowed: true } : { allowed: false, reason: "sender_not_allowed" };
}
function redactId(value) {
  if (!value) return "[UNKNOWN]";
  return "[REDACTED]";
}
function logPolicyDecision(event, decision, fields = {}) {
  const parts = [
    `[zalo-api-gateway] event=${event}`,
    decision.reason ? `reason=${decision.reason}` : void 0,
    `threadId=${redactId(fields.threadId)}`,
    fields.senderId !== void 0 ? `senderId=${redactId(fields.senderId)}` : void 0
  ].filter(Boolean);
  console.log(parts.join(" "));
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
    webhooks: parseWebhooks(env.ZALO_GATEWAY_WEBHOOKS),
    allowedSenders: parsePolicyList(env.ZALO_GATEWAY_ALLOWED_SENDERS),
    allowedThreads: parsePolicyList(env.ZALO_GATEWAY_ALLOWED_THREADS),
    deniedSenders: parsePolicyList(env.ZALO_GATEWAY_DENY_SENDERS),
    deniedThreads: parsePolicyList(env.ZALO_GATEWAY_DENY_THREADS)
  };
}

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

// src/gateway/zalo-client.ts
import { ThreadType as ThreadType2 } from "zca-js";

// src/client/zalo-client.ts
import { Zalo, LoginQRCallbackEventType } from "zca-js";

// src/client/credentials.ts
import { readFileSync as readFileSync2, writeFileSync, unlinkSync, existsSync as existsSync2, chmodSync, mkdirSync, copyFileSync } from "node:fs";
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
function migrateLegacyCredentialsIfNeeded(path = getCredentialsPath()) {
  if (existsSync2(path) || !existsSync2(LEGACY_CREDENTIALS_PATH)) return;
  const dir = dirname(path);
  if (!existsSync2(dir)) mkdirSync(dir, { recursive: true, mode: 448 });
  copyFileSync(LEGACY_CREDENTIALS_PATH, path);
  try {
    chmodSync(path, 384);
  } catch {
  }
}
function saveCredentials(data) {
  const path = getCredentialsPath();
  const dir = dirname(path);
  if (!existsSync2(dir)) {
    mkdirSync(dir, { recursive: true, mode: 448 });
  }
  writeFileSync(path, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 384 });
  try {
    chmodSync(path, 384);
  } catch {
  }
}
function loadCredentials() {
  const path = getCredentialsPath();
  migrateLegacyCredentialsIfNeeded(path);
  if (!existsSync2(path)) {
    return null;
  }
  try {
    const raw = readFileSync2(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function hasCredentials() {
  const path = getCredentialsPath();
  migrateLegacyCredentialsIfNeeded(path);
  return existsSync2(path);
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
async function loginWithQR(callback) {
  const zalo = new Zalo({ logging: false, imageMetadataGetter });
  const api = await zalo.loginQR(void 0, (event) => {
    if (event.type === LoginQRCallbackEventType.GotLoginInfo && event.data) {
      saveCredentials({
        imei: event.data.imei,
        cookie: event.data.cookie,
        userAgent: event.data.userAgent
      });
    }
    callback?.(event);
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
function normalizeAttachment(content) {
  if (!content || typeof content !== "object" || Array.isArray(content)) return void 0;
  const record = content;
  const rawType = String(record.type ?? record.msgType ?? "").toLowerCase();
  const href = typeof record.href === "string" ? record.href : typeof record.url === "string" ? record.url : void 0;
  const title = typeof record.title === "string" ? record.title : void 0;
  const description = typeof record.description === "string" ? record.description : void 0;
  const type = rawType.includes("voice") || rawType.includes("audio") ? "voice" : rawType.includes("image") || rawType.includes("photo") ? "image" : rawType.includes("video") ? "video" : rawType.includes("link") ? "link" : rawType.includes("file") ? "file" : rawType.includes("sticker") ? "sticker" : href ? "unknown" : void 0;
  return type ? { type, url: href, title, description, raw: content } : void 0;
}
function normalizeGatewayZaloEvent(message) {
  if (message.isSelf) return void 0;
  const content = message.data.content;
  const attachment = normalizeAttachment(content);
  const text = typeof content === "string" ? content : attachment?.title ?? attachment?.description ?? "";
  if (!text.trim() && !attachment) return void 0;
  const isGroup = message.type === ThreadType2.Group;
  return {
    type: "message.created",
    platform: "zalo",
    threadId: message.threadId,
    messageId: message.data.msgId || message.data.cliMsgId,
    senderId: isGroup ? message.data.uidFrom : message.threadId,
    senderName: message.data.dName,
    chatType: isGroup ? "group" : "dm",
    text,
    attachments: attachment ? [attachment] : void 0,
    timestamp: message.data.ts ? Number.parseInt(message.data.ts, 10) : Date.now(),
    raw: message
  };
}
var ZcaGatewayZaloClient = class {
  listenerStarted = false;
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
  async sendVoice(input) {
    const api = await getApi();
    const result = await api.sendVoice({ voiceUrl: input.voiceUrl, ttl: input.ttl }, input.threadId, input.isGroup ? ThreadType2.Group : ThreadType2.User);
    return { ok: true, messageId: String(result.msgId), threadId: input.threadId };
  }
  async sendAttachment(input) {
    const api = await getApi();
    const result = await api.sendMessage({ msg: input.text ?? "", attachments: input.attachment, ttl: input.ttl }, input.threadId, input.isGroup ? ThreadType2.Group : ThreadType2.User);
    const msgId = result.attachment[0]?.msgId ?? result.message?.msgId;
    return { ok: true, messageId: msgId === void 0 ? void 0 : String(msgId), threadId: input.threadId };
  }
  async sendLink(input) {
    const api = await getApi();
    const result = await api.sendLink({ link: input.link, msg: input.text, ttl: input.ttl }, input.threadId, input.isGroup ? ThreadType2.Group : ThreadType2.User);
    return { ok: true, messageId: String(result.msgId), threadId: input.threadId };
  }
  async sendVideo(input) {
    const api = await getApi();
    const result = await api.sendVideo({
      videoUrl: input.videoUrl,
      thumbnailUrl: input.thumbnailUrl,
      msg: input.text,
      ttl: input.ttl,
      duration: input.duration,
      width: input.width,
      height: input.height
    }, input.threadId, input.isGroup ? ThreadType2.Group : ThreadType2.User);
    return { ok: true, messageId: String(result.msgId), threadId: input.threadId };
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
  onMessage(handler) {
    let disposed = false;
    let cleanup;
    void getApi().then((api) => {
      if (disposed) return;
      const onRawMessage = (message) => {
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
      }
    };
  }
};

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
function badRequest(error4, details) {
  return {
    status: 400,
    body: { ok: false, error: error4, details }
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
async function sendMessageResponse(request, zaloClient, policy) {
  let payload;
  try {
    const raw = await readRequestBody(request);
    payload = raw.trim() ? JSON.parse(raw) : void 0;
  } catch (err) {
    return badRequest(err instanceof SyntaxError ? "Invalid JSON body" : err instanceof Error ? err.message : "Invalid request body");
  }
  const validated = validateSendMessagePayload(payload);
  if (!validated.ok) return validated.response;
  const decision = policy ? decideOutboundPolicy(validated.value, policy) : { allowed: true };
  if (!decision.allowed) {
    return {
      status: 403,
      body: { ok: false, error: "Forbidden", reason: decision.reason }
    };
  }
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
  "mark-read",
  "send-image",
  "send-file",
  "send-link",
  "send-video",
  "send-voice",
  "get-group-info",
  "get-group-members-info"
];
var MAX_BODY_BYTES2 = 128 * 1024;
function json(status, body) {
  return { status, body };
}
function error(status, message, details) {
  return json(status, { ok: false, error: message, details });
}
function forbidden(reason) {
  return json(403, { ok: false, error: "Forbidden", reason });
}
function checkOutbound(input, policy) {
  if (!policy) return void 0;
  const decision = decideOutboundPolicy(input, policy);
  return decision.allowed ? void 0 : forbidden(decision.reason);
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
function optionalNumber(record, key) {
  const value = record[key];
  return typeof value === "number" ? value : void 0;
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
async function send(payload, context) {
  const parsed = sendTextInput(payload);
  if (!parsed.ok) return parsed.response;
  const blocked = checkOutbound(parsed.value, context.policy);
  if (blocked) return blocked;
  const result = await context.client.sendText(parsed.value);
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}
async function replyMessage(payload, context) {
  const parsed = sendTextInput(payload);
  if (!parsed.ok) return parsed.response;
  const blocked = checkOutbound(parsed.value, context.policy);
  if (blocked) return blocked;
  const messageId = isRecord(payload) ? requiredString(payload, "messageId") : void 0;
  const result = await context.client.replyMessage({ ...parsed.value, messageId });
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}
async function addReaction(payload, context) {
  if (!isRecord(payload)) return error(400, "Request body must be a JSON object");
  const threadId = requiredString(payload, "threadId");
  const messageId = requiredString(payload, "messageId");
  const reaction = requiredString(payload, "reaction");
  if (!threadId) return error(400, "threadId is required");
  if (!messageId) return error(400, "messageId is required");
  if (!reaction) return error(400, "reaction is required");
  const isGroup = optionalBoolean(payload, "isGroup");
  const blocked = checkOutbound({ threadId, isGroup }, context.policy);
  if (blocked) return blocked;
  const result = await context.client.addReaction({ threadId, messageId, reaction, isGroup });
  return result.ok ? json(200, { ok: true, data: result.data ?? {} }) : error(502, result.error ?? "Action failed");
}
async function getThreadInfo(payload, context) {
  if (!isRecord(payload)) return error(400, "Request body must be a JSON object");
  const threadId = requiredString(payload, "threadId");
  if (!threadId) return error(400, "threadId is required");
  const result = await context.client.getThreadInfo({ threadId, isGroup: optionalBoolean(payload, "isGroup") });
  return result.ok ? json(200, { ok: true, data: result.data }) : error(502, result.error ?? "Action failed");
}
async function getGroupMembers(payload, context) {
  if (!isRecord(payload)) return error(400, "Request body must be a JSON object");
  const threadId = requiredString(payload, "threadId");
  if (!threadId) return error(400, "threadId is required");
  const result = await context.client.getGroupMembers({ threadId });
  return result.ok ? json(200, { ok: true, data: result.data ?? [] }) : error(502, result.error ?? "Action failed");
}
async function listFriends(payload, context) {
  const input = isRecord(payload) ? {
    count: typeof payload.count === "number" ? payload.count : void 0,
    page: typeof payload.page === "number" ? payload.page : void 0
  } : void 0;
  const result = await context.client.listFriends(input);
  return result.ok ? json(200, { ok: true, data: result.data ?? [] }) : error(502, result.error ?? "Action failed");
}
async function listGroups(_payload, context) {
  const result = await context.client.listGroups();
  return result.ok ? json(200, { ok: true, data: result.data ?? [] }) : error(502, result.error ?? "Action failed");
}
async function markRead(payload, context) {
  if (!isRecord(payload)) return error(400, "Request body must be a JSON object");
  const threadId = requiredString(payload, "threadId");
  if (!threadId) return error(400, "threadId is required");
  const isGroup = optionalBoolean(payload, "isGroup");
  const blocked = checkOutbound({ threadId, isGroup }, context.policy);
  if (blocked) return blocked;
  const result = await context.client.markRead({ threadId, isGroup });
  return result.ok ? json(200, { ok: true, data: result.data ?? {} }) : error(502, result.error ?? "Action failed");
}
function attachmentInput(payload, key) {
  if (!isRecord(payload)) return { ok: false, response: error(400, "Request body must be a JSON object") };
  const threadId = requiredString(payload, "threadId");
  const attachment = requiredString(payload, key) ?? requiredString(payload, "attachment");
  if (!threadId) return { ok: false, response: error(400, "threadId is required") };
  if (!attachment) return { ok: false, response: error(400, `${key} is required`) };
  return { ok: true, value: { threadId, attachment, text: typeof payload.text === "string" ? payload.text : void 0, isGroup: optionalBoolean(payload, "isGroup"), ttl: optionalNumber(payload, "ttl") } };
}
async function sendImage(payload, context) {
  const parsed = attachmentInput(payload, "imageUrl");
  if (!parsed.ok) return parsed.response;
  const blocked = checkOutbound(parsed.value, context.policy);
  if (blocked) return blocked;
  const result = await context.client.sendAttachment(parsed.value);
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}
async function sendFile(payload, context) {
  const parsed = attachmentInput(payload, "fileUrl");
  if (!parsed.ok) return parsed.response;
  const blocked = checkOutbound(parsed.value, context.policy);
  if (blocked) return blocked;
  const result = await context.client.sendAttachment(parsed.value);
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}
function linkInput(payload) {
  if (!isRecord(payload)) return { ok: false, response: error(400, "Request body must be a JSON object") };
  const threadId = requiredString(payload, "threadId");
  const link = requiredString(payload, "link") ?? requiredString(payload, "url");
  if (!threadId) return { ok: false, response: error(400, "threadId is required") };
  if (!link) return { ok: false, response: error(400, "link is required") };
  return { ok: true, value: { threadId, link, text: typeof payload.text === "string" ? payload.text : void 0, isGroup: optionalBoolean(payload, "isGroup"), ttl: optionalNumber(payload, "ttl") } };
}
async function sendLink(payload, context) {
  const parsed = linkInput(payload);
  if (!parsed.ok) return parsed.response;
  const blocked = checkOutbound(parsed.value, context.policy);
  if (blocked) return blocked;
  const result = await context.client.sendLink(parsed.value);
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}
function videoInput(payload) {
  if (!isRecord(payload)) return { ok: false, response: error(400, "Request body must be a JSON object") };
  const threadId = requiredString(payload, "threadId");
  const videoUrl = requiredString(payload, "videoUrl");
  const thumbnailUrl = requiredString(payload, "thumbnailUrl");
  if (!threadId) return { ok: false, response: error(400, "threadId is required") };
  if (!videoUrl) return { ok: false, response: error(400, "videoUrl is required") };
  if (!thumbnailUrl) return { ok: false, response: error(400, "thumbnailUrl is required") };
  return { ok: true, value: { threadId, videoUrl, thumbnailUrl, text: typeof payload.text === "string" ? payload.text : void 0, isGroup: optionalBoolean(payload, "isGroup"), ttl: optionalNumber(payload, "ttl"), duration: optionalNumber(payload, "duration"), width: optionalNumber(payload, "width"), height: optionalNumber(payload, "height") } };
}
async function sendVideo(payload, context) {
  const parsed = videoInput(payload);
  if (!parsed.ok) return parsed.response;
  const blocked = checkOutbound(parsed.value, context.policy);
  if (blocked) return blocked;
  const result = await context.client.sendVideo(parsed.value);
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}
function sendVoiceInput(payload) {
  if (!isRecord(payload)) return { ok: false, response: error(400, "Request body must be a JSON object") };
  const threadId = requiredString(payload, "threadId");
  const voiceUrl = requiredString(payload, "voiceUrl");
  if (!threadId) return { ok: false, response: error(400, "threadId is required") };
  if (!voiceUrl) return { ok: false, response: error(400, "voiceUrl is required") };
  return { ok: true, value: { threadId, voiceUrl, isGroup: optionalBoolean(payload, "isGroup"), ttl: typeof payload.ttl === "number" ? payload.ttl : void 0 } };
}
async function sendVoice(payload, context) {
  const parsed = sendVoiceInput(payload);
  if (!parsed.ok) return parsed.response;
  const blocked = checkOutbound(parsed.value, context.policy);
  if (blocked) return blocked;
  const result = await context.client.sendVoice(parsed.value);
  return result.ok ? json(200, { ok: true, data: result }) : error(502, result.error ?? "Action failed");
}
async function getGroupInfo(payload, context) {
  return getThreadInfo(payload, context);
}
async function getGroupMembersInfo(payload, context) {
  return getGroupMembers(payload, context);
}
var actionRegistry = {
  send,
  "reply-message": replyMessage,
  "add-reaction": addReaction,
  "get-thread-info": getThreadInfo,
  "get-group-members": getGroupMembers,
  "list-friends": listFriends,
  "list-groups": listGroups,
  "mark-read": markRead,
  "send-image": sendImage,
  "send-file": sendFile,
  "send-link": sendLink,
  "send-video": sendVideo,
  "send-voice": sendVoice,
  "get-group-info": getGroupInfo,
  "get-group-members-info": getGroupMembersInfo
};
function isSupportedAction(action) {
  return Object.hasOwn(actionRegistry, action);
}
async function actionResponse(action, request, client, policy) {
  if (!isSupportedAction(action)) return error(404, `Unsupported action: ${action}`, { supported: SUPPORTED_ACTIONS });
  let payload;
  try {
    payload = await readRequestBody2(request);
  } catch (err) {
    return error(400, err instanceof SyntaxError ? "Invalid JSON body" : err instanceof Error ? err.message : "Invalid request body");
  }
  return actionRegistry[action](payload, { client, policy });
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
function includesQuery(values, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => value?.toLowerCase().includes(needle));
}
function filterFriends(items, query) {
  return items.filter((item) => includesQuery([item.userId, item.displayName, item.zaloName, item.username], query));
}
function filterGroups(items, query) {
  return items.filter((item) => includesQuery([item.groupId, item.name], query));
}
function filterMembers(items, query) {
  return items.filter((item) => includesQuery([item.userId, item.displayName], query));
}
async function friendsResponse(url, client) {
  const result = await client.listFriends({
    count: parsePositiveInt(url.searchParams.get("count")),
    page: parsePositiveInt(url.searchParams.get("page"))
  });
  if (!result.ok) return error2(502, result.error ?? "Failed to list friends");
  const query = url.searchParams.get("query") ?? "";
  return json2(200, { ok: true, data: filterFriends(result.data ?? [], query) });
}
async function groupsResponse(url, client) {
  const result = await client.listGroups();
  if (!result.ok) return error2(502, result.error ?? "Failed to list groups");
  const query = url.searchParams.get("query") ?? "";
  return json2(200, { ok: true, data: filterGroups(result.data ?? [], query) });
}
async function groupMembersResponse(groupId, url, client) {
  if (!groupId) return error2(400, "groupId is required");
  const result = await client.getGroupMembers({ threadId: groupId });
  if (!result.ok) return error2(502, result.error ?? "Failed to list group members");
  const query = url.searchParams.get("query") ?? "";
  return json2(200, { ok: true, data: filterMembers(result.data ?? [], query) });
}

// src/gateway/policy-store.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";
var POLICY_FILE = "gateway-policy.json";
function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))];
}
function policyPath(env = process.env) {
  return join2(getGatewayDataDir(env), POLICY_FILE);
}
function normalizePolicyConfig(input) {
  return {
    allowedSenders: cleanList(input.allowedSenders),
    allowedThreads: cleanList(input.allowedThreads),
    deniedSenders: cleanList(input.deniedSenders),
    deniedThreads: cleanList(input.deniedThreads)
  };
}
var GatewayPolicyStore = class {
  constructor(initialPolicy, path = policyPath()) {
    this.path = path;
    this.policy = this.load(initialPolicy);
  }
  path;
  policy;
  current() {
    return this.policy;
  }
  update(next) {
    this.policy = normalizePolicyConfig({ ...this.policy, ...next });
    this.save();
    return this.policy;
  }
  add(key, ids) {
    this.policy = normalizePolicyConfig({ ...this.policy, [key]: [...this.policy[key], ...ids] });
    this.save();
    return this.policy;
  }
  remove(key, id) {
    this.policy = normalizePolicyConfig({ ...this.policy, [key]: this.policy[key].filter((item) => item !== id) });
    this.save();
    return this.policy;
  }
  load(fallback) {
    if (!existsSync4(this.path)) return normalizePolicyConfig(fallback);
    try {
      return normalizePolicyConfig(JSON.parse(readFileSync3(this.path, "utf8")));
    } catch {
      return normalizePolicyConfig(fallback);
    }
  }
  save() {
    mkdirSync2(dirname2(this.path), { recursive: true });
    writeFileSync2(this.path, `${JSON.stringify(this.policy, null, 2)}
`, { mode: 384 });
  }
};

// src/gateway/routes/policy.ts
var MAX_BODY_BYTES3 = 64 * 1024;
function json3(status, body) {
  return { status, body };
}
function error3(status, message, details) {
  return json3(status, { ok: false, error: message, details });
}
async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES3) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}
function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, response: error3(400, "Request body must be a JSON object") };
  }
  const record = payload;
  for (const key of ["allowedSenders", "allowedThreads", "deniedSenders", "deniedThreads"]) {
    if (record[key] !== void 0 && (!Array.isArray(record[key]) || record[key].some((item) => typeof item !== "string"))) {
      return { ok: false, response: error3(400, `${key} must be an array of strings`) };
    }
  }
  return { ok: true, value: normalizePolicyConfig(record) };
}
async function policyResponse(request, store) {
  if (request.method === "GET") return json3(200, { ok: true, data: store.current() });
  if (request.method !== "PUT") return error3(405, "Method not allowed");
  let payload;
  try {
    payload = await readJson(request);
  } catch (err) {
    return error3(400, err instanceof SyntaxError ? "Invalid JSON body" : err instanceof Error ? err.message : "Invalid request body");
  }
  const validated = validatePayload(payload);
  if (!validated.ok) return validated.response;
  return json3(200, { ok: true, data: store.update(validated.value) });
}
function idsPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, response: error3(400, "Request body must be a JSON object") };
  const ids = payload.ids;
  if (!Array.isArray(ids) || ids.some((item) => typeof item !== "string")) return { ok: false, response: error3(400, "ids must be an array of strings") };
  return { ok: true, ids: [...new Set(ids.map((item) => item.trim()).filter(Boolean))] };
}
async function policyListResponse(request, store, key, id) {
  if (request.method === "POST") {
    let payload;
    try {
      payload = await readJson(request);
    } catch (err) {
      return error3(400, err instanceof SyntaxError ? "Invalid JSON body" : err instanceof Error ? err.message : "Invalid request body");
    }
    const validated = idsPayload(payload);
    if (!validated.ok) return validated.response;
    return json3(200, { ok: true, data: store.add(key, validated.ids) });
  }
  if (request.method === "DELETE" && id) return json3(200, { ok: true, data: store.remove(key, decodeURIComponent(id)) });
  return error3(405, "Method not allowed");
}

// src/gateway/routes/login.ts
import { LoginQRCallbackEventType as LoginQRCallbackEventType2 } from "zca-js";
var session;
var loginPromise2;
function json4(status, body, headers) {
  return { status, body, headers };
}
function publicSession() {
  return session ?? { status: "idle", authenticatedHint: hasStoredCredentials() };
}
async function startLoginQrResponse() {
  if (loginPromise2 && session) return json4(200, { ok: true, data: publicSession() });
  session = {
    sessionId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: hasStoredCredentials() ? "refreshing" : "idle",
    startedAt: Date.now()
  };
  loginPromise2 = (async () => {
    try {
      if (hasStoredCredentials()) {
        try {
          await loginWithCredentials();
          if (session) session.status = "authenticated";
          return;
        } catch {
          if (session) session.status = "idle";
        }
      }
      await loginWithQR((event) => {
        if (!session) return;
        if (event.type === LoginQRCallbackEventType2.QRCodeGenerated) {
          session.status = "qr_generated";
          session.qrImageBase64 = event.data.image;
        }
        if (event.type === LoginQRCallbackEventType2.QRCodeScanned) {
          session.status = "scanned";
          session.displayName = event.data.display_name;
        }
        if (event.type === LoginQRCallbackEventType2.QRCodeExpired) session.status = "expired";
        if (event.type === LoginQRCallbackEventType2.QRCodeDeclined) session.status = "declined";
        if (event.type === LoginQRCallbackEventType2.GotLoginInfo) session.status = "authenticated";
      });
      if (session) session.status = "authenticated";
    } catch (err) {
      if (session) {
        session.status = "failed";
        session.error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      loginPromise2 = void 0;
    }
  })();
  return json4(202, { ok: true, data: publicSession() });
}
function loginQrStatusResponse() {
  return json4(200, { ok: true, data: publicSession() });
}
function loginQrImageResponse() {
  if (!session?.qrImageBase64) return json4(404, { ok: false, error: "QR image is not available" });
  const body = Buffer.from(session.qrImageBase64, "base64");
  return {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": body.length.toString()
    },
    body
  };
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
  if (Buffer.isBuffer(result.body)) {
    response.writeHead(result.status, result.headers);
    response.end(result.body);
    return;
  }
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
  const policyStore = options.policyStore ?? new GatewayPolicyStore(config);
  const getZaloStatus = options.getZaloStatus ?? (async () => {
    const status = await zaloClient.status();
    return { status: status.status, authenticated: status.authenticated };
  });
  const inboundSubscription = zaloClient.onMessage((event) => {
    if (!webhookDispatcher.hasTargets()) return;
    const decision = decideInboundPolicy(event, policyStore.current());
    if (!decision.allowed) {
      logPolicyDecision("policy.inbound.blocked", decision, { threadId: event.threadId, senderId: event.senderId });
      return;
    }
    logPolicyDecision("policy.inbound.allowed", decision, { threadId: event.threadId, senderId: event.senderId });
    void webhookDispatcher.dispatch(event).then((result) => {
      for (const delivery of result.delivered) {
        if (!delivery.ok) {
          console.warn(`[zalo-api-gateway] event=webhook.delivery.failed url=${delivery.url} error=${delivery.error ?? delivery.status ?? "unknown"}`);
        }
      }
    });
  });
  const server = createServer(async (request, response) => {
    try {
      const url = routeUrl(request);
      const path = url.pathname;
      if (path === "/health") {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        return sendJson(response, await healthResponse({ runtime, getZaloStatus }));
      }
      if (path === "/version") {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        return sendJson(response, versionResponse(runtime));
      }
      if (path === "/login/qr/start") {
        if (request.method !== "POST") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, await startLoginQrResponse());
      }
      if (path === "/login/qr/status") {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, loginQrStatusResponse());
      }
      if (path === "/login/qr/image") {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, loginQrImageResponse());
      }
      if (path === "/messages/send") {
        if (request.method !== "POST") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, await sendMessageResponse(request, zaloClient, policyStore.current()));
      }
      if (path === "/policy") {
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, await policyResponse(request, policyStore));
      }
      const policyListMatch = /^\/policy\/(allowed-senders|allowed-threads|denied-senders|denied-threads)(?:\/([^/]+))?$/.exec(path);
      if (policyListMatch) {
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        const keyMap = {
          "allowed-senders": "allowedSenders",
          "allowed-threads": "allowedThreads",
          "denied-senders": "deniedSenders",
          "denied-threads": "deniedThreads"
        };
        return sendJson(response, await policyListResponse(request, policyStore, keyMap[policyListMatch[1]], policyListMatch[2]));
      }
      if (path === "/friends") {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, await friendsResponse(url, zaloClient));
      }
      if (path === "/groups") {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, await groupsResponse(url, zaloClient));
      }
      const groupMembersMatch = /^\/groups\/([^/]+)\/members$/.exec(path);
      if (groupMembersMatch) {
        if (request.method !== "GET") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        return sendJson(response, await groupMembersResponse(decodeURIComponent(groupMembersMatch[1]), url, zaloClient));
      }
      if (path.startsWith("/actions/")) {
        if (request.method !== "POST") return sendJson(response, methodNotAllowed());
        const auth = requireBearerToken(request, config.token);
        if (!auth.ok) return sendJson(response, { status: auth.status, body: { ok: false, error: auth.error } });
        const action = decodeURIComponent(path.slice("/actions/".length));
        return sendJson(response, await actionResponse(action, request, zaloClient, policyStore.current()));
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
  return { server, config, runtime, webhookDispatcher, policyStore };
}
async function listenGateway(options = {}) {
  const gateway2 = createGatewayServer(options);
  await new Promise((resolve2, reject) => {
    gateway2.server.once("error", reject);
    gateway2.server.listen(gateway2.config.port, gateway2.config.host, () => {
      gateway2.server.off("error", reject);
      resolve2();
    });
  });
  return gateway2;
}

// src/gateway/index.ts
var gateway = await listenGateway();
console.log(`[zalo-api-gateway] listening on http://${gateway.config.host}:${gateway.config.port}`);
var shutdown = async () => {
  await new Promise((resolve2, reject) => {
    gateway.server.close((err) => err ? reject(err) : resolve2());
  });
};
process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
