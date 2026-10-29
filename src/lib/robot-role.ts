import { inferRobotRole, ROBOT_ROLES, type RobotRole } from "../components/manzanilla/robot-model";

/**
 * Which dani-dex Manzanilla character a bot wears. The role picks the character
 * (held prop, motion set); the bot's own color stays its identity and is passed
 * to the renderer separately. Role assignment is semantic only - never a
 * nearest-shell color substitution.
 *
 * Ready-bot ids map explicitly where the name/title inference would miss;
 * everything else (custom bots) uses dani-dex's own inferRobotRole, so the
 * talent/expense/invoice characters stay reachable for finance and hiring bots.
 */
export const READY_BOT_ROLE: Record<string, RobotRole> = {
  assistant: "assistant",
  inbox: "inbox",
  research: "research",
  coder: "builder",
  community: "growth",
  ops: "launch",
  writer: "default",
  analyst: "research",
  "meeting-notes": "assistant",
  travel: "default",
  study: "research",
  humanizer: "default",
  "design-critic": "default",
  "call-coach": "sales",
  "plant-care": "default",
};

export function botRobotRole(bot: { readyBotId?: string | null; name?: string | null; title?: string | null; chiefOfStaff?: boolean | null }): RobotRole {
  if (bot.chiefOfStaff) return "chief";
  if (bot.readyBotId 
