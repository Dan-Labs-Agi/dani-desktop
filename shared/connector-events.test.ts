import { describe, expect, it } from "vitest";

import { connectorSourceLine, normalizeConnectorCandidate, normalizeConnectorSource } from "./connector-events.ts";

describe("connector event normalization", () => {
  it("maps adapter aliases into one source shape and retains quoted context", () => {
    const candidate = normalizeConnectorCandidate({
      text: "Can you check this?",
      source: { platform: "slack", chat_kind: "thread", channel_id: "C123", thread_ts: "T1", user_id: "U9", message_id: "M2", reply_to_message_id: "M1", addressed: true },
      reply: { message_id: "M1", user_id: "U8", text: "The earlier request" },
      attachments: [{ url: "https://example.test/file" }],
    });
    expect(candidate).toEqual({
      text: "Can you check this?",
      attachments: ["https://example.test/file"],
      reply: { id: "M1", userId: "U8", text: "The earlier request" },
      source: { platform: "slack", chatKind: "thread", channelId: "C123", threadId: "T1", userId: "U9", messageId: "M2", replyToMessageId: "M1", addressed: true },
    });
    expect(connectorSourceLine(candidate!.source, candidate!.reply)).toContain("reply_to=M1");
    expect(connectorSourceLine(candidate!.source, candidate!.reply)).toContain("quoted=M1");
  });

  it("accepts flat event metadata but rejects unrelated records", () => {
    expect(normalizeConnectorSource({ platform: "telegram", channelId: "chat-1", sentMs: "2026-11-14T00:00:00Z" })).toMatchObject({ platform: "telegram", channelId: "chat-1", sentMs: expect.any(Number) });
    expect(normalizeConnectorSource({ subject: "Order #7", sender: "ada@example.test" })).toBeNull();
  });
});
