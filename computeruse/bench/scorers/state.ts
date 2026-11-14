import type { StateAssertion } from "../task.ts";
import { isDeepStrictEqual } from "node:util";

export interface ComputerSnapshot {
  readonly files: Readonly<Record<string, string>>;
  readonly databases: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  readonly settings: Readonly<Record<string, string>>;
  readonly api: Readonly<Record<string, unknown>>;
  readonly packages: ReadonlySet<string>;
  readonly extracted: Readonly<Record<string, string>>;
}

export interface AssertionScore { passed: boolean; description: string }

function sameValue(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

export function scoreAssertion(assertion: StateAssertion, state: ComputerSnapshot): AssertionScore {
  switch (assertion.kind) {
    case "file": {
      const content = state.files[assertion.path];
      return { passed: assertion.exists ? content !== undefined && (assertion.content === undefined || content === assertion.content) : content === undefined,
        description: `file ${assertion.path}` };
    }
    case "database":
      return { passed: (state.databases[assertion.name] ?? []).some((row) =>
        Object.entries(assertion.row).every(([key, value]) => sameValue(row[key], value))), description: `database ${assertion.name}` };
    case "setting":
      return { passed: state.settings[assertion.name] === assertion.value, description: `setting ${assertion.name}` };
    case "api":
      return { passed: sameValue(state.api[assertion.key], assertion.value), description: `api ${assertion.key}` };
    case "package":
      return { passed: state.packages.has(assertion.name) === assertion.installed, description: `package ${assertion.name}` };
    case "extracted":
      return { passed: state.extracted[assertion.key] === assertion.value, description: `extracted ${assertion.key}` };
  }
}

export function scoreTask(
  required: readonly StateAssertion[],
  forbidden: readonly StateAssertion[],
  state: ComputerSnapshot,
): { passed: boolean; required: AssertionScore[]; forbidden: AssertionScore[] } {
  const requiredScores = required.map((assertion) => scoreAssertion(assertion, state));
  const forbiddenScores = forbidden.map((assertion) => scoreAssertion(assertion, state));
  return {
    passed: requiredScores.every((score) => score.passed) && forbiddenScores.every((score) => !score.passed),
    required: requiredScores,
    forbidden: forbiddenScores,
  };
}
