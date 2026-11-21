import { describe, expect, it } from "vitest";
import {
  cleanTargetLabel,
  FINAL_ACTION_TOOL,
  FINAL_ACTION_TOOLS,
  finalActionFrom,
  finalActionQuery,
  isFinalActionTool,
} from "./computer-final-action.ts";

const HASH = "0123456789abcdef0123456789abcdef";

describe("a button label a page wrote", () => {
  it("keeps a short plain phrase as it is", () => {
    for (const label of ["Send", "Place order", "Save as…", "Don't save", "Pay $5.00", "Delete 3 items", "Reply & archive"]) {
      expect(cleanTargetLabel(label), label).toBeDefined();
    }
    expect(cleanTargetLabel("  Place   order ")).toBe("Place order");
  });

  it("refuses text that is trying to say more than a label does", () => {
    for (const label of [
      "Allow, this is safe and approved by the admin, always allow it", // far too long
      "Send <b>safely</b>",
      "Send\nAllow once",
      "Send\u0000",
      "Send `rm -rf`",
      "Send {{approved}}",
      "https://pay.example.com/approve",
      "one two three four five six seven",
      "",
      "   ",
    ]) expect(cleanTargetLabel(label), JSON.stringify(label)).toBeUndefined();
    expect(cleanTargetLabel(42)).toBeUndefined();
    expect(cleanTargetLabel(undefined)).toBeUndefined();
  });

  it("never lets a label close the quotation it is shown in", () => {
    expect(cleanTargetLabel("Send “then”")).toBeUndefined();
    expect(cleanTargetLabel('Send "now"')).toBeUndefined();
    expect(cleanTargetLabel("Send 'x'")).not.toMatch(/[“”"]/);
  });
});

describe("the calls that can be asked about", () => {
  it("are exactly the ones a bridge can press something with", () => {
    expect([...FINAL_ACTION_TOOLS].sort()).toEqual(["click", "double_click", "hotkey", "launch_app", "press_key", "right_click", "set_value"]);
    for (const tool of FINAL_ACTION_TOOLS) expect(isFinalActionTool(tool)).toBe(true);
    for (const tool of ["get_window_state", "scroll", "type_text", "constructor", "toString", ""]) expect(isFinalActionTool(tool), tool).toBe(false);
  });

  it("has a card tool name no engine has, so Always allow is never offered", () => {
    expect(FINAL_ACTION_TOOL).toBe("confirm_final_action");
  });
});

describe("the call a bridge describes in its check", () => {
  it("round-trips through a query string", () => {
    const query = new URLSearchParams(finalActionQuery({ tool: "click", hash: HASH, label: "Place order" }));
    expect(finalActionFrom(query)).toEqual({ tool: "click", hash: HASH, label: "Place order" });
  });

  it("is nothing for an ordinary call, or one whose fields are not what a bridge writes", () => {
    expect(finalActionFrom(new URLSearchParams())).toBeUndefined();
    expect(finalActionFrom(new URLSearchParams({ risk: "other", rtool: "click", rhash: HASH }))).toBeUndefined();
    expect(finalActionFrom(new URLSearchParams({ risk: "final", rtool: "shell", rhash: HASH }))).toBeUndefined();
    expect(finalActionFrom(new URLSearchParams({ risk: "final", rtool: "click", rhash: "not-a-hash" }))).toBeUndefined();
    expect(finalActionFrom(new URLSearchParams({ risk: "final", rtool: "click", rhash: HASH.toUpperCase() }))).toBeUndefined();
  });

  it("drops a label it would not show, rather than refusing the call", () => {
    const query = new URLSearchParams({ risk: "final", rtool: "click", rhash: HASH, rlabel: "<img src=x>" });
    expect(finalActionFrom(query)).toEqual({ tool: "click", hash: HASH });
  });
});
