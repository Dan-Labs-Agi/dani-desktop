import { describe, expect, it } from "vitest";
import { botRobotRole, READY_BOT_ROLE, ALL_ROBOT_ROLES } from "./robot-role";

describe("botRobotRole", () => {
  it("gives the chief of staff the violet chief character", () => {
    expect(botRobotRole({ chiefOfStaff: true, name: "Dani Bot" })).toBe("chief");
  });
  it("maps every ready-bot id to a real dani-dex role", () => {
    for (const [id, role] of Object.entries(READY_BOT_ROLE)) {
      expect(ALL_ROBOT_ROLES, `${id} -> ${role}`).toContain(role);
    }
    expect(Object.keys(READY_BOT_ROLE)).toHaveLength(15);
  });
  it("maps the semantically fitting ready bots", () => {
    expect(botRobotRole({ readyBotId: "coder" })).toBe("builder");
    expect(botRobotRole({ readyBotId: "inbox" })).toBe("inbox");
    expect(botRobotRole({ readyBotId: "call-coach" })).toBe("sales");
  });
  it("falls back to dani-dex name inference for custom bots", () => {
    expect(botRobotRole({ name: "Invoice Collector" })).toBe("invoice");
    expect(botRobotRole({ name: "Talent Scout" })).toBe("talent");
    expect(botRobotRole({ name: "Bookkeeper" })).toBe("expense");
    expect(botRobotRole({ name: "Helpdesk" })).toBe("support");
    expect(botRobotRole({ name: "Something Else" })).toBe("default");
  });
  it("keeps all 13 dani-dex characters reachable", () => {
    expect(ALL_ROBOT_ROLES).toHaveLength(13);
    const used = new Set([...Object.values(READY_BOT_ROLE), "chief", "invoice", "talent", "expense", "support"]);
    for (const role of ALL_ROBOT_ROLES) expect(used, role).toContain(role);
  });
});
