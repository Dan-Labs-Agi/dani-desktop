/** What the person's config turns on for one computer session. Each is off unless set, and none reaches the driver. */
export interface ComputerGuards {
  stale?: boolean;
  loop?: boolean;
  typing?: boolean;
  anchor?: boolean;
  scroll?: boolean;
  untrusted?: boolean;
  guidance?: boolean;
  pointer?: boolean;
  evidence?: boolean;
  risk?: boolean;
  readWindow?: boolean;
  batch?: boolean;
}

const GUARD_ENV: Record<keyof ComputerGuards, string> = {
  stale: "OMB_COMPUTER_STALE",
  loop: "OMB_COMPUTER_LOOP",
  typing: "OMB_COMPUTER_TYPING",
  anchor: "OMB_COMPUTER_ANCHOR",
  scroll: "OMB_COMPUTER_SCROLL",
  untrusted: "OMB_COMPUTER_UNTRUSTED",
  guidance: "OMB_COMPUTER_GUIDANCE",
  pointer: "OMB_COMPUTER_POINTER",
  evidence: "OMB_COMPUTER_EVIDENCE",
  risk: "OMB_COMPUTER_RISK",
  readWindow: "OMB_COMPUTER_READ_WINDOW",
  batch: "OMB_COMPUTER_BATCH",
};

const NAMES = Object.keys(GUARD_ENV) as Array<keyof ComputerGuards>;

/** The environment the service is launched with: one variable per switch that is on. */
export function guardEnv(guards: ComputerGuards): Record<string, string> {
  return Object.fromEntries(NAMES.filter((name) => guards[name] === true).map((name) => [GUARD_ENV[name], "1"]));
}

/** The switches in an environment, and the environment without them: the driver is given only the latter. */
export function guardsFromEnv(env: NodeJS.ProcessEnv): { guards: ComputerGuards; rest: NodeJS.ProcessEnv } {
  const rest = { ...env };
  const guards: ComputerGuards = {};
  for (const name of NAMES) {
    if (env[GUARD_ENV[name]] === "1") guards[name] = true;
    delete rest[GUARD_ENV[name]];
  }
  return { guards, rest };
}
