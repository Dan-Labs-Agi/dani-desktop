// Dani's follow-up after its first look around, under its intro (HelperIntro). The server writes it once, in English,
// as a real message the model and the sidebar's preview read; clients say it in the viewer's language from its facts.
// ENGLISH mirrors src/locales/en.json helperIntro.followup.*. It never names the AI it thinks with.

export interface HelperFollowupFacts {
  /** Provider setup state, not proof of an inference call. v2 distinguishes installed/unverified Dani Free. */
  ai: "own" | "backup" | "none" | "unverified";
  version?: 2;
  appsKnown?: boolean;
  countsKnown?: boolean;
  /** The apps every bot here can use, by name. */
  apps: string[];
  /** The person's other bots, and the routines running here, when it looked. */
  bots: number;
  routines: number;
}

export interface HelperFollowupField {
  helperFollowup?: HelperFollowupFacts;
}

/** At most this many app names; the rest are counted. */
export const FOLLOWUP_APP_NAMES = 3;

export const FOLLOWUP_ENGLISH = {
  "helperIntro.setup.checking": "I'll check this app's local setup: connected apps, other bots and enabled routines. This does not check your inbox or tasks.",
  "helperIntro.setup.unknownCounts": "I couldn't confirm the bot and routine counts.",
  "helperIntro.setup.summary": "Local setup check: {bots}, {routines}.",
  "helperIntro.setup.apps": "Connected apps listed here: {apps}.",
  "helperIntro.setup.noApps": "No connected apps are listed here.",
  "helperIntro.setup.unknownApps": "I couldn't confirm the connected-app list.",
  "helperIntro.setup.unverified": "Dani Free tools are installed. A live model conversation has not been verified.",
  "helperIntro.setup.provider": "A model provider is configured. This setup check did not run a model conversation.",
  "helperIntro.setup.noAi": "No model provider is ready in this app's setup.",
  "helperIntro.setup.backup": "A backup model is listed in setup. This check did not run a model conversation.",
  "helperIntro.setup.scope": "I haven't checked your inbox or unfinished tasks, and this check does not start ongoing monitoring.",

  "helperIntro.followup.found": "I looked around and nothing's waiting on you yet.",
  "helperIntro.followup.empty": "There's no unfinished work, no other bots or routines, and no apps are connected so far.",
  "helperIntro.followup.counts": "You have {bots} and {routines}, and no apps are connected so far.",
  "helperIntro.followup.botsNone": "no other bots",
  "helperIntro.followup.botOne": "1 other bot",
  "helperIntro.followup.bots": "{count} other bots",
  "helperIntro.followup.routinesNone": "no routines",
  "helperIntro.followup.routineOne": "1 routine",
  "helperIntro.followup.routines": "{count} routines",
  "helperIntro.followup.offer": "If you'd like me to keep an eye on your day, I can connect your email and calendar so I can flag what matters each morning. Just say the word, or hand me whatever's on your plate today.",
  "helperIntro.followup.apps": "I can already use {apps}. Hand me whatever's on your plate today, or ask me to set up a bot for something you do every week.",
  "helperIntro.followup.more": "{count} more",
  "helperIntro.followup.noAi": "I looked around. Before I can do real work, I need an AI to think with. Sign in with an account you already have, like Claude or ChatGPT, and I'll take it from there.",
  "helperIntro.followup.backup": "I looked around. For now I'm thinking with a free backup model. Sign in with an account you already have, like Claude or ChatGPT, and I'll take it from there.",
} as const;

export type FollowupKey = keyof typeof FOLLOWUP_ENGLISH;
type Say = (key: FollowupKey, params?: Record<string, string | number>) => string;

function counted(say: Say, count: number, none: FollowupKey, one: FollowupKey, many: FollowupKey): string {
  return count <= 0 ? say(none) : count === 1 ? say(one) : say(many, { count });
}

/** The follow-up in `say`'s language; `list` joins app names as that language does. */
export function followupText(facts: HelperFollowupFacts, say: Say, list: (items: string[]) => string): string {
  if (facts.version === 2) {
    const counts = facts.countsKnown === false ? say("helperIntro.setup.unknownCounts") : say("helperIntro.setup.summary", {
      bots: counted(say, facts.bots, "helperIntro.followup.botsNone", "helperIntro.followup.botOne", "helperIntro.followup.bots"),
      routines: counted(say, facts.routines, "helperIntro.followup.routinesNone", "helperIntro.followup.routineOne", "helperIntro.followup.routines"),
    });
    const apps = facts.appsKnown === false ? say("helperIntro.setup.unknownApps") : facts.apps.length ? say("helperIntro.setup.apps", { apps: list(facts.apps) }) : say("helperIntro.setup.noApps");
    const ai = say(facts.ai === "unverified" ? "helperIntro.setup.unverified" : facts.ai === "none" ? "helperIntro.setup.noAi" : facts.ai === "backup" ? "helperIntro.setup.backup" : "helperIntro.setup.provider");
    return `${counts} ${apps} ${ai} ${say("helperIntro.setup.scope")}`;
  }
  if (facts.ai === "unverified") return say("helperIntro.setup.unverified");
  if (facts.ai === "none") return say("helperIntro.followup.noAi");
  if (facts.ai === "backup") return say("helperIntro.followup.backup");
  const found = say("helperIntro.followup.found");
  if (facts.apps.length) {
    const shown = facts.apps.slice(0, FOLLOWUP_APP_NAMES);
    const rest = facts.apps.length - shown.length;
    return `${found} ${say("helperIntro.followup.apps", { apps: list(rest > 0 ? [...shown, say("helperIntro.followup.more", { count: rest })] : shown) })}`;
  }
  const middle = facts.bots <= 0 && facts.routines <= 0 ? say("helperIntro.followup.empty") : say("helperIntro.followup.counts", {
    bots: counted(say, facts.bots, "helperIntro.followup.botsNone", "helperIntro.followup.botOne", "helperIntro.followup.bots"),
    routines: counted(say, facts.routines, "helperIntro.followup.routinesNone", "helperIntro.followup.routineOne", "helperIntro.followup.routines"),
  });
  return `${found} ${middle} ${say("helperIntro.followup.offer")}`;
}

/** The English the server stores, which the model reads. */
export function englishFollowup(facts: HelperFollowupFacts): string {
  const fill = (key: FollowupKey, params?: Record<string, string | number>) =>
    FOLLOWUP_ENGLISH[key].replace(/\{(\w+)\}/g, (match, name: string) => (params && name in params ? String(params[name]) : match));
  return followupText(facts, fill, (items) => new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(items));
}
