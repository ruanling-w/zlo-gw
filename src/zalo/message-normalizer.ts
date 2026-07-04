import { ThreadType, type GroupMessage, type Message } from "zca-js";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import sharp from "sharp";
import { downloadFileFromUrl } from "../channel/file-downloader.js";
import { downloadImageFromUrl } from "../channel/image-downloader.js";
import type { ZaloClawMessage } from "../runtime/types.js";

const DEDUP_TTL = 60_000;
const DEDUP_MAX = 2000;
const processedMsgIds = new Map<string, number>();

function isDuplicateMsg(msgId: string | undefined): boolean {
  if (!msgId) return false;
  const now = Date.now();
  if (processedMsgIds.has(msgId)) return true;
  if (processedMsgIds.size >= DEDUP_MAX) {
    for (const [id, ts] of processedMsgIds) {
      if (now - ts > DEDUP_TTL) processedMsgIds.delete(id);
    }
    if (processedMsgIds.size >= DEDUP_MAX) {
      const oldest = processedMsgIds.keys().next().value;
      if (oldest) processedMsgIds.delete(oldest);
    }
  }
  processedMsgIds.set(msgId, now);
  return false;
}

const SYSTEM_NOTIFICATION_PATTERNS = [
  /^Bạn vừa kết bạn với\b/i,
  /^You (?:are|were) (?:now )?(?:friends|connected) with\b/i,
  /^You just became friends with\b/i,
];

const IMAGE_URL_RE = /\.(?:jpe?g|png|gif|webp|bmp|svg|tiff?)(?:[?#]|$)/i;
const GENERIC_FILE_URL_RE = /\.(?:pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar)(?:[?#]|$)/i;

function isSystemNotificationContent(content: string): boolean {
  const normalized = content.trim();
  return SYSTEM_NOTIFICATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function pushMediaUrl(mediaUrls: string[], mediaTypes: string[], url: unknown, mimeType: string): void {
  if (typeof url !== "string" || !url.trim()) return;
  const trimmed = url.trim();
  if (mediaUrls.includes(trimmed)) return;
  mediaUrls.push(trimmed);
  mediaTypes.push(mimeType);
}

function mediaMimeFromObject(obj: Record<string, unknown>): string | undefined {
  const raw = [obj.type, obj.mediaType, obj.contentType, obj.mimeType, obj.msgType]
    .map((value) => typeof value === "string" || typeof value === "number" ? String(value).toLowerCase() : "")
    .join(" ");

  if (raw.includes("photo") || raw.includes("image")) return "image/jpeg";
  if (raw.includes("video")) return "video/mp4";
  if (raw.includes("audio") || raw.includes("voice")) return "audio/mpeg";
  if (raw.includes("file") || raw.includes("attach")) return "application/octet-stream";
  return undefined;
}

function looksLikeExplicitFileObject(obj: Record<string, unknown>, url: string): boolean {
  const hasFileName = ["fileName", "filename", "name"].some((key) => typeof obj[key] === "string" && String(obj[key]).trim().length > 0);
  const hasFileSize = ["fileSize", "size"].some((key) => obj[key] !== undefined && obj[key] !== null);
  return hasFileName || hasFileSize || GENERIC_FILE_URL_RE.test(url) || IMAGE_URL_RE.test(url);
}

function fileSha256(filePath: string): string | undefined {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return undefined;
  }
}

function looksLikeHtmlFile(filePath: string): boolean {
  try {
    const head = fs.readFileSync(filePath).subarray(0, 512).toString("utf8").trim().toLowerCase();
    return head.includes("<!doctype") || head.includes("<html") || head.includes("<head");
  } catch {
    return false;
  }
}

function extractMediaFromObject(obj: unknown, mediaUrls: string[], mediaTypes: string[]): string {
  if (!obj || typeof obj !== "object") return "";
  const record = obj as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : "";
  const description = typeof record.description === "string" ? record.description : "";
  const mimeType = mediaMimeFromObject(record);

  const photoUrl = record.hdUrl || record.normalUrl || record.oriUrl;
  if (photoUrl) {
    pushMediaUrl(mediaUrls, mediaTypes, photoUrl, "image/jpeg");
  }

  const href = typeof record.href === "string" ? record.href : (typeof record.url === "string" ? record.url : "");
  if (href && (mimeType || looksLikeExplicitFileObject(record, href))) {
    pushMediaUrl(mediaUrls, mediaTypes, href, mimeType ?? (IMAGE_URL_RE.test(href) ? "image/jpeg" : "application/octet-stream"));
  }

  return title || description || (mediaUrls.length > 0 ? "[Media attachment]" : "");
}

function convertToZaloClawMessage(msg: Message): ZaloClawMessage | null {
  const data = msg.data;
  let content = "";
  const mediaUrls: string[] = [];
  const mediaTypes: string[] = [];

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

  const quote = data.quote as { ownerId?: string; msg?: string; fromD?: string; globalMsgId?: unknown; ts?: number } | undefined;
  const isGroup = msg.type === ThreadType.Group;
  const threadId = msg.threadId;
  const rawSenderId = data.uidFrom;
  const senderId = (!isGroup && (!rawSenderId?.trim() || !/^\d+$/.test(rawSenderId.trim())))
    ? threadId
    : rawSenderId;
  const senderName = data.dName ?? "";
  const timestamp = data.ts ? parseInt(data.ts, 10) : Math.floor(Date.now() / 1000);
  const mentions = isGroup && (msg as GroupMessage).data.mentions
    ? (msg as GroupMessage).data.mentions
    : undefined;

  return {
    threadId,
    msgId: data.msgId,
    cliMsgId: data.cliMsgId,
    type: isGroup ? 1 : 0,
    content: content || "[Media]",
    mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
    mediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
    mentions: mentions ?? undefined,
    timestamp,
    quote: quote ? {
      msg: quote.msg || undefined,
      fromId: quote.ownerId || undefined,
      fromName: quote.fromD || undefined,
      msgId: quote.globalMsgId ? String(quote.globalMsgId) : undefined,
      ts: quote.ts || undefined,
    } : undefined,
    metadata: {
      isGroup,
      groupId: isGroup ? threadId : undefined,
      senderName,
      fromId: senderId,
    },
  };
}

function isImageAttachment(url: string, mediaType?: string): boolean {
  const type = mediaType?.toLowerCase() ?? "";
  return type.startsWith("image/") || IMAGE_URL_RE.test(url);
}

async function downloadInboundMedia(message: ZaloClawMessage): Promise<string[]> {
  const urls = message.mediaUrls ?? [];
  const mediaTypes = message.mediaTypes ?? [];
  const downloaded: string[] = [];
  const seenUrls = new Set<string>();
  const seenHashes = new Set<string>();

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    const mediaType = mediaTypes[i];
    const localPath = isImageAttachment(url, mediaType)
      ? await downloadImageFromUrl(url)
      : await downloadFileFromUrl(url);
    if (!localPath) continue;
    const hash = fileSha256(localPath);
    if (hash && seenHashes.has(hash)) {
      try { fs.rmSync(localPath, { force: true }); } catch {}
      continue;
    }
    if (hash) seenHashes.add(hash);
    if (!downloaded.includes(localPath)) downloaded.push(localPath);
  }

  return downloaded;
}

async function filterAttachableMediaPaths(paths: string[]): Promise<string[]> {
  const filtered: string[] = [];

  for (const filePath of paths) {
    try {
      const metadata = await sharp(filePath).metadata();
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
  convertToZaloClawMessage,
  downloadInboundMedia,
  filterAttachableMediaPaths,
  isDuplicateMsg,
  isSystemNotificationContent,
  processedMsgIds,
};

export {
  convertToZaloClawMessage as _convertToZaloClawMessage,
  filterAttachableMediaPaths as _filterAttachableMediaPaths,
  isDuplicateMsg as _isDuplicateMsg,
  isSystemNotificationContent as _isSystemNotificationContent,
  processedMsgIds as _processedMsgIds,
};
