import { readFileSync, statSync } from "node:fs";
import type { SendTurnInput } from "../contracts.ts";

export interface ChatImagePart { type: "image_url"; image_url: { url: string } }
export interface ChatTextPart { type: "text"; text: string }
export type ChatContentPart = ChatTextPart | ChatImagePart;
const IMAGE_BYTES = 20 * 1024 * 1024;
const MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const CHAT_IMAGE_BUDGET = 32 * 1024 * 1024;

const encodedImages = (parts: string | ChatContentPart[] | null) =>
  Array.isArray(parts) ? parts.reduce((total, part) => total + (part.type === "image_url" ? part.image_url.url.length : 0), 0) : 0;

/** Bound retained base64 before JSON serialization or another model call. `release` gives back what a dropped screenshot held. */
export function chatImageBudget() {
  let used = 0;
  const retain = (parts: string | ChatContentPart[] | null) => {
    const added = encodedImages(parts);
    if (used + added > CHAT_IMAGE_BUDGET) throw new Error("Turn image budget exceeded (32 MiB encoded); screenshot cannot be retained. An operation may already have taken effect; inspect its state before retrying.");
    used += added;
  };
  return Object.assign(retain, { release: (encoded: number) => { used = Math.max(0, used - encoded); } });
}

export function assertImageTransport(url: string) {
  const endpoint = new URL(url);
  const loopback = endpoint.hostname === "localhost" || endpoint.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) {
    throw new Error("Images and computer tools require HTTPS for remote API endpoints; HTTP is supported only on loopback.");
  }
}

export function chatImage(item: { mimeType?: unknown; data?: unknown }): ChatImagePart {
  const { mimeType, data } = item;
  if (typeof mimeType !== "string" || !MIME.has(mimeType) || typeof data !== "string" ||
      !data.length || data.length > Math.ceil(IMAGE_BYTES / 3) * 4 || data.length % 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new Error("Invalid or oversized MCP image");
  }
  const bytes = Buffer.from(data, "base64");
  const matches = mimeType === "image/png" ? bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) && bytes.toString("ascii", 12, 16) === "IHDR"
    : mimeType === "image/jpeg" ? bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mimeType === "image/gif" ? bytes.length >= 13 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))
    : bytes.length >= 16 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (bytes.length > IMAGE_BYTES || bytes.toString("base64") !== data || !matches) throw new Error("Image bytes do not match the declared MIME type");
  return { type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } };
}

export function chatUserContent(turn: SendTurnInput): string | ChatContentPart[] {
  if (!turn.images?.length) return turn.text;
  const budget = chatImageBudget();
  return [{ type: "text", text: turn.text }, ...turn.images.map(image => {
    if (statSync(image.path).size > IMAGE_BYTES) throw new Error("Image exceeds 20 MB");
    const part = chatImage({ mimeType: image.mime, data: readFileSync(image.path).toString("base64") });
    budget([part]);
    return part;
  })];
}

const SCREENSHOT_LEAD = "Screenshot result from tool call ";
export const SCREENSHOT_DROPPED = "[an earlier screenshot, dropped to keep the conversation small]";
/** A screenshot a person asked the model to look at is worth more than the newest tool one: only tool screenshots are capped. */
export const NEWEST_SCREENSHOTS_KEPT = 2;

export function chatToolImages(callId: string, images?: ChatImagePart[]): ChatContentPart[] {
  return images?.length ? [{ type: "text", text: `${SCREENSHOT_LEAD}${callId}:` }, ...images] : [];
}

const isToolScreenshots = (message: { role: string; content: string | ChatContentPart[] | null }): message is { role: string; content: ChatContentPart[] } =>
  message.role === "user" && Array.isArray(message.content) && message.content[0]?.type === "text" && message.content[0].text.startsWith(SCREENSHOT_LEAD);

/** Replaces every tool screenshot but the newest `keep` with a line of text, in place, and returns the encoded size it freed. */
export function keepNewestScreenshots(messages: Array<{ role: string; content: string | ChatContentPart[] | null }>, keep: number): number {
  let seen = 0;
  let freed = 0;
  for (let at = messages.length - 1; at >= 0; at--) {
    const message = messages[at]!;
    if (!isToolScreenshots(message)) continue;
    const content = message.content.slice();
    for (let part = content.length - 1; part >= 0; part--) {
      const image = content[part]!;
      if (image.type !== "image_url" || ++seen <= keep) continue;
      freed += image.image_url.url.length;
      content[part] = { type: "text", text: SCREENSHOT_DROPPED };
    }
    message.content = content;
  }
  return freed;
}
