/** Normalized transport metadata shared by connected-app adapters and event consumers. */
export interface ConnectorCandidateSource {
  platform: string;
  chatKind?: string;
  channelId?: string;
  threadId?: string;
  userId?: string;
  messageId?: string;
  replyToMessageId?: string;
  addressed?: boolean;
  sentMs?: number;
  isBot?: boolean;
}

export interface ConnectorCandidateReply {
  id: string;
  userId?: string;
  text?: string;
}

/** A connector event's stable shape; adapters may retain extra fields in their raw event data. */
export interface ConnectorCandidate {
  text: string;
  attachments?: string[];
  reply?: ConnectorCandidateReply;
  source: ConnectorCandidateSource;
}

const MAX_ID = 240;
const MAX_TEXT = 4_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown, max = MAX_ID): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const clean = String(value).trim();
  return clean ? clean.slice(0, max) : undefined;
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const found = text(value);
    if (found) return found;
  }
  return undefined;
}

function firstLongText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const found = text(value, MAX_TEXT);
    if (found) return found;
  }
  return undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function millis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function sourceRecord(input: Record<string, unknown>): Record<string, unknown> {
  const nested = record(input.source) ?? record(input.context) ?? record(input.metadata);
  return nested ? { ...input, ...nested } : input;
}

function attachmentUrls(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const urls = value.flatMap((item) => {
    const itemRecord = record(item);
    return [text(item), text(itemRecord?.url), text(itemRecord?.downloadUrl)].filter((url): url is string => Boolean(url));
  }).slice(0, 16);
  return urls.length ? urls : undefined;
}

/** Converts common adapter aliases into the fixed source shape used by prompts and logs. */
export function normalizeConnectorSource(input: unknown): ConnectorCandidateSource | null {
  const root = record(input);
  if (!root) return null;
  const source = sourceRecord(root);
  const platform = firstText(source.platform, source.platformName, source.network, source.channelPlatform);
  const chatKind = firstText(source.chat_kind, source.chatKind, source.kind);
  const channelId = firstText(source.channel_id, source.channelId, source.channel);
  const threadId = firstText(source.thread_id, source.threadId, source.thread_ts);
  const userId = firstText(source.user_id, source.userId, source.sender_id, source.senderId);
  const messageId = firstText(source.message_id, source.messageId);
  const replyToMessageId = firstText(source.reply_to_message_id, source.replyToMessageId, source.quoted_message_id, source.quote_id);
  if (!platform && !channelId && !threadId && !userId && !messageId && !replyToMessageId) return null;
  return {
    platform: platform ?? "unknown",
    ...(chatKind ? { chatKind } : {}),
    ...(channelId ? { channelId } : {}),
    ...(threadId ? { threadId } : {}),
    ...(userId ? { userId } : {}),
    ...(messageId ? { messageId } : {}),
    ...(replyToMessageId ? { replyToMessageId } : {}),
    ...(bool(source.addressed) !== undefined ? { addressed: bool(source.addressed) } : {}),
    ...(millis(source.sent_ms ?? source.sentMs ?? source.timestamp) !== undefined ? { sentMs: millis(source.sent_ms ?? source.sentMs ?? source.timestamp) } : {}),
    ...(bool(source.is_bot ?? source.isBot) !== undefined ? { isBot: bool(source.is_bot ?? source.isBot) } : {}),
  };
}

/** Normalizes a message-shaped event while keeping the original payload available to the caller. */
export function normalizeConnectorCandidate(input: unknown): ConnectorCandidate | null {
  const root = record(input);
  if (!root) return null;
  const source = normalizeConnectorSource(root);
  if (!source) return null;
  const quoted = record(root.reply) ?? record(root.quote) ?? record(root.quoted_message);
  const replyId = firstText(quoted?.id, quoted?.message_id, source.replyToMessageId);
  const reply = replyId ? {
    id: replyId,
    ...(firstText(quoted?.user_id, quoted?.userId) ? { userId: firstText(quoted?.user_id, quoted?.userId) } : {}),
    ...(text(quoted?.text, MAX_TEXT) ? { text: text(quoted?.text, MAX_TEXT) } : {}),
  } : undefined;
  const candidateText = firstLongText(root.text, root.caption, root.message_text, root.body, root.message) ?? "";
  const attachments = attachmentUrls(root.attachments);
  return {
    text: candidateText,
    ...(attachments ? { attachments } : {}),
    ...(reply ? { reply } : {}),
    source,
  };
}

/** A compact, stable label for model context; values remain untrusted until the caller frames them. */
export function connectorSourceLine(source: ConnectorCandidateSource, reply?: ConnectorCandidateReply): string {
  const parts = [
    source.platform,
    source.chatKind,
    source.channelId && `channel=${source.channelId}`,
    source.threadId && `thread=${source.threadId}`,
    source.userId && `user=${source.userId}`,
    source.messageId && `message=${source.messageId}`,
    source.replyToMessageId && `reply_to=${source.replyToMessageId}`,
    source.addressed !== undefined && `addressed=${source.addressed}`,
    source.isBot !== undefined && `bot=${source.isBot}`,
    reply?.id && `quoted=${reply.id}`,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}
