import { describe, expect, it } from "vitest";
import { assertImageTransport, CHAT_IMAGE_BUDGET, chatImageBudget, chatImage, chatToolImages, keepNewestScreenshots, SCREENSHOT_DROPPED, type ChatContentPart } from "./chat-images.ts";

describe("chat image transport and retained budget", () => {
  it("rejects encoded text and mismatched MIME claims while preserving a PNG", () => {
    const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBv0AAAAASUVORK5CYII=";
    expect(chatImage({ mimeType: "image/png", data }).image_url.url).toBe(`data:image/png;base64,${data}`);
    expect(() => chatImage({ mimeType: "image/jpeg", data })).toThrow("MIME");
    expect(() => chatImage({ mimeType: "image/png", data: Buffer.from("not an image").toString("base64") })).toThrow("MIME");
  });
  it("counts input and successive screenshot batches against one budget", () => {
    const retain = chatImageBudget();
    const part = { type: "image_url" as const, image_url: { url: "x".repeat(CHAT_IMAGE_BUDGET / 2) } };
    retain([part]);
    retain("ordinary text");
    retain([part]);
    expect(() => retain([{ type: "image_url", image_url: { url: "x" } }])).toThrow("cannot be retained");
    expect(() => chatImageBudget()([part])).not.toThrow();
  });
  it.each(["https://api.example.com/v1", "http://localhost:8000/v1", "http://127.0.0.1:8000/v1", "http://[::1]:8000/v1"])("allows encrypted or loopback transport: %s", url => {
    expect(() => assertImageTransport(url)).not.toThrow();
  });
  it.each(["http://api.example.com/v1", "http://localhost.example.com/v1", "http://192.168.1.4/v1", "ftp://localhost/v1"])("refuses remote cleartext or unsupported transport: %s", url => {
    expect(() => assertImageTransport(url)).toThrow("require HTTPS");
  });

  it("gives a dropped screenshot back to the budget", () => {
    const retain = chatImageBudget();
    const part = { type: "image_url" as const, image_url: { url: "x".repeat(CHAT_IMAGE_BUDGET / 2) } };
    retain([part, part]);
    expect(() => retain([part])).toThrow("cannot be retained");
    retain.release(part.image_url.url.length);
    expect(() => retain([part])).not.toThrow();
  });
});

describe("keeping only the newest tool screenshots", () => {
  const shot = (id: string) => ({ type: "image_url" as const, image_url: { url: "data:image/png;base64," + id } });
  const turn = (id: string) => ({ role: "user", content: chatToolImages(id, [shot(id)]) });
  const urls = (messages: Array<{ content: string | ChatContentPart[] | null }>) =>
    messages.flatMap((message) => Array.isArray(message.content) ? message.content : []).flatMap((part) => part.type === "image_url" ? [part.image_url.url.slice(-1)] : []);

  it("leaves the newest two with their pixels and turns each older one into a line of text", () => {
    const messages = [turn("a"), { role: "assistant", content: "ok" }, turn("b"), turn("c"), turn("d")];
    const freed = keepNewestScreenshots(messages, 2);
    expect(urls(messages)).toEqual(["c", "d"]);
    expect(freed).toBe(2 * shot("a").image_url.url.length);
    expect(messages[0]!.content).toEqual([{ type: "text", text: "Screenshot result from tool call a:" }, { type: "text", text: SCREENSHOT_DROPPED }]);
  });

  it("counts images, not messages, when one batch returned several", () => {
    const batch = { role: "user", content: [...chatToolImages("a", [shot("a")]), ...chatToolImages("b", [shot("b")]), ...chatToolImages("c", [shot("c")])] };
    keepNewestScreenshots([batch], 2);
    expect(urls([batch])).toEqual(["b", "c"]);
  });

  it("never touches an image the person attached, or text", () => {
    const attached = { role: "user", content: [{ type: "text" as const, text: "Look at this" }, shot("p")] };
    const messages = [attached, { role: "user", content: "plain" }, turn("a"), turn("b"), turn("c")];
    keepNewestScreenshots(messages, 1);
    expect(urls(messages)).toEqual(["p", "c"]);
    expect(messages[1]!.content).toBe("plain");
  });

  it("frees nothing when the screenshots already fit, and can drop every one", () => {
    const messages = [turn("a"), turn("b")];
    expect(keepNewestScreenshots(messages, 2)).toBe(0);
    expect(keepNewestScreenshots(messages, 0)).toBeGreaterThan(0);
    expect(urls(messages)).toEqual([]);
  });
});
