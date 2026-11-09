import { describe, expect, it } from "vitest";

import { chiefChoices, chiefFor, chiefStepFits, createChiefPatch, hiddenFromSidebar, INTRO_CHIPS, introChips, myDefaultBot, setupSteps, someoneElsesDefaultBot } from "./default-bot";
import { partitionSidebarBots } from "./sidebar-layout";
import type { DefaultBotFields } from "../../shared/default-bot";

const bot = (id: string, fields: DefaultBotFields = {}): DefaultBotFields & { id: string } => ({ id, ...fields });

describe("DaniBot in the sidebar", () => {
  it("leaves out a DaniBot whose Show switch is off, and on a Team Cloud other people's, but keeps the viewer's own", () => {
    const bots = [
      bot("dani", { defaultBot: {} }),
      bot("ada-dani", { defaultBot: { person: "ada@example.com" } }),
      bot("bea-dani", { defaultBot: { person: "bea@example.com" } }),
      bot("writer"),
    ];
    const shown = (viewerEmail: string | null) => partitionSidebarBots(bots, { viewerEmail }).unsectionedBots.map((entry) => entry.id);
    expect(shown("ada@example.com")).toEqual(["dani", "ada-dani", "writer"]);
    expect(shown(null)).toEqual(["dani", "writer"]);
    bots[0] = bot("dani", { defaultBot: {}, sidebarHidden: true });
    expect(shown(null)).toEqual(["writer"]);
    expect(hiddenFromSidebar(bots[0]!, null)).toBe(true);
    expect(someoneElsesDefaultBot(bots[2]!, "ADA@example.com".toLowerCase())).toBe(true);
  });

  it("finds the viewer's own DaniBot: their own on a team, the place's otherwise, none until the viewer is known", () => {
    const team = [bot("ada-dani", { defaultBot: { person: "ada@example.com" } }), bot("writer")];
    expect(myDefaultBot(team, undefined)).toBeUndefined();
    expect(myDefaultBot(team, "ada@example.com")?.id).toBe("ada-dani");
    expect(myDefaultBot(team, "bea@example.com")).toBeUndefined();
    const place = [bot("writer"), bot("dani", { defaultBot: {} })];
    expect(myDefaultBot(place, null)?.id).toBe("dani");
    expect(myDefaultBot(place, "owner@example.com")?.id).toBe("dani");
  });
});

describe("DaniBot's identity is its mark, never its name", () => {
  it("keeps finding a renamed DaniBot for the Settings switch and the sidebar, and keeps it out of the list while its welcome is open", () => {
    const bots = [bot("writer"), { ...bot("dani", { defaultBot: {} }), name: "Jarvis" }];
    expect(myDefaultBot(bots, null)?.id).toBe("dani");
    expect(partitionSidebarBots(bots, { viewerEmail: null }).unsectionedBots.map((entry) => entry.id)).toEqual(["writer", "dani"]);
    expect(partitionSidebarBots(bots, { viewerEmail: null, welcoming: "dani" }).unsectionedBots.map((entry) => entry.id)).toEqual(["writer"]);
  });
});

describe("what DaniBot offers to set up", () => {
  const fresh = { aiReady: false, ownBots: 0, onCloud: false, team: false, remote: false };

  it("in Advanced mode, as on a new install before: an AI, bots, apps, the phone and the Cloud", () => {
    expect(setupSteps(fresh)).toEqual(["ai", "bots", "apps", "phone", "cloud"]);
    expect(setupSteps({ ...fresh, aiReady: true, onCloud: true })).toEqual(["bots", "apps", "phone"]);
    expect(setupSteps({ ...fresh, ownBots: 3 })).toEqual(["ai"]);
    expect(setupSteps({ ...fresh, team: true })).toEqual([]);
  });

  it("in Simple mode, chips for only what its look around found missing, in order: AI, apps, skills, phone, Cloud", () => {
    expect(introChips(fresh)).toEqual(["ai", "apps", "phone", "cloud"]);
    expect(introChips({ ...fresh, aiReady: true, importFound: true })).toEqual(["apps", "import", "phone", "cloud"]);
    expect(introChips({ ...fresh, aiReady: true, appsConnected: true, phonePaired: true })).toEqual(["cloud"]);
    expect(introChips({ ...fresh, aiReady: true, remote: true })).toEqual(["apps", "phone"]);
    expect(introChips({ ...fresh, aiReady: true, onCloud: true, importFound: false })).toEqual(["apps", "phone"]);
    expect(INTRO_CHIPS).toBe(3);
  });

  it("never offers a bot (the sidebar's + adds one), nor nags a person who is set up or a Team Cloud member", () => {
    expect(introChips(fresh)).not.toContain("bots");
    expect(introChips({ ...fresh, aiReady: true, ownBots: 3, importFound: true })).toEqual([]);
    expect(introChips({ ...fresh, ownBots: 3 })).toEqual(["ai"]);
    expect(introChips({ ...fresh, team: true })).toEqual([]);
  });
});

describe("the first run's Chief step", () => {
  const dani = { id: "dani", defaultBot: {}, chiefOfStaff: true };

  it("shows for a DaniBot not yet introduced, where it is the Chief or there is none", () => {
    expect(chiefStepFits([dani], dani)).toBe(true);
    expect(chiefStepFits([{ ...dani, chiefOfStaff: false }], { ...dani, chiefOfStaff: false })).toBe(true);
  });

  it("is skipped where another bot is the Chief, once DaniBot has met the person, and with no DaniBot", () => {
    const other = { ...dani, chiefOfStaff: false };
    expect(chiefStepFits([other, { id: "research", chiefOfStaff: true }], other)).toBe(false);
    expect(chiefStepFits([{ ...dani, welcomed: true }], { ...dani, welcomed: true })).toBe(false);
    expect(chiefStepFits([{ id: "research" }], undefined)).toBe(false);
  });

  it("keeps a Chief in another department out of it", () => {
    const other = { ...dani, chiefOfStaff: false };
    expect(chiefStepFits([other, { id: "sales", chiefOfStaff: true, section: "Sales" }], other)).toBe(true);
  });
});

describe("who becomes the Chief of Staff on the first run", () => {
  type Candidate = { id: string; defaultBot?: { person?: string }; chiefOfStaff?: boolean; section?: string; hidden?: boolean };
  const dani: Candidate = { id: "dani", defaultBot: {}, chiefOfStaff: true };
  const research: Candidate = { id: "research" };

  it("finds the Chief in DaniBot's own department, never a department's or a hidden one", () => {
    expect(chiefFor([dani, research], dani)?.id).toBe("dani");
    expect(chiefFor([{ ...dani, chiefOfStaff: false }, { ...research, chiefOfStaff: true }], dani)?.id).toBe("research");
    expect(chiefFor([{ ...dani, chiefOfStaff: false }, { id: "sales", section: "Sales", chiefOfStaff: true }], dani)).toBeUndefined();
    expect(chiefFor([{ ...dani, chiefOfStaff: false }, { id: "old", chiefOfStaff: true, hidden: true }], dani)).toBeUndefined();
  });

  it("offers the person's own bots there to choose from, never DaniBot, a hidden bot or someone else's", () => {
    const bots: Candidate[] = [dani, research, { id: "sales", section: "Sales" }, { id: "gone", hidden: true }, { id: "ada-dani", defaultBot: { person: "ada@example.com" } }];
    expect(chiefChoices(bots, dani, null).map((bot) => bot.id)).toEqual(["research"]);
    expect(chiefChoices([dani], dani, null)).toEqual([]);
  });

  it("Create makes DaniBot the Chief only where there is none, and never takes the role from a Chief someone has", () => {
    expect(createChiefPatch({ defaultBot: {} }, undefined)).toEqual({ welcomed: true, chiefOfStaff: true });
    expect(createChiefPatch({ defaultBot: {} }, dani)).toEqual({ welcomed: true });
    expect(createChiefPatch({ defaultBot: {}, sidebarHidden: true }, dani), "back in the sidebar").toEqual({ welcomed: true, sidebarHidden: false });
  });
});
