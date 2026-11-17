import { describe, expect, it } from "vitest";
import { declinedSinceLastRequest, SIGN_IN_DECLINED } from "./sign-in-request.ts";

const user = { role: "user", kind: "text" };
const card = (site: string, state: Record<string, unknown> = {}, from?: string) =>
  ({ role: "bot", kind: "signin", signIn: { site, ...state }, ...(from ? { from: { botId: from } } : {}) });

describe("a sign-in the person already declined", () => {
  it("is held against asking again for the same site in the same request", () => {
    expect(declinedSinceLastRequest([user, card("bank.example", { cancelled: true })], "bank.example", "b1", false)).toBe(true);
  });

  it("starts afresh when the person writes again, since they may now want to try", () => {
    expect(declinedSinceLastRequest([card("bank.example", { cancelled: true }), user], "bank.example", "b1", false)).toBe(false);
  });

  it("does not count a card that is open, done, superseded or for another site", () => {
    for (const other of [card("bank.example"), card("bank.example", { done: true }), card("bank.example", { superseded: true }), card("mail.example", { cancelled: true })]) {
      expect(declinedSinceLastRequest([user, other], "bank.example", "b1", false)).toBe(false);
    }
  });

  it("counts only the asking bot's own card in a room", () => {
    const path = [user, card("bank.example", { cancelled: true }, "b2")];
    expect(declinedSinceLastRequest(path, "bank.example", "b1", true)).toBe(false);
    expect(declinedSinceLastRequest(path, "bank.example", "b2", true)).toBe(true);
    expect(declinedSinceLastRequest(path, "bank.example", "b1", false)).toBe(true);
  });

  it("looks past other rows between the question and the new ask", () => {
    const path = [user, card("bank.example", { cancelled: true }), { role: "bot", kind: "text" }, { role: "bot", kind: "activity" }];
    expect(declinedSinceLastRequest(path, "bank.example", "b1", false)).toBe(true);
  });

  it("tells the bot to stop, in plain words that name no plumbing", () => {
    expect(SIGN_IN_DECLINED).toMatch(/Do not ask again/);
    expect(SIGN_IN_DECLINED).not.toMatch(/card|token|capability|endpoint/i);
  });
});
