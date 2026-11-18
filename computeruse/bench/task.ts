import { z } from "zod";
import { desktopSchema } from "./desktop.ts";

const relativePath = z.string().min(1).refine((value) =>
  !value.startsWith("/") && !value.startsWith("\\") && !/^[a-z]:/iu.test(value) &&
  value.split(/[\\/]/u).every((part) => part !== ".." && part !== ""),
  "path must stay inside the task workspace");

export const setupStepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: relativePath, content: z.string() }).strict(),
  z.object({ kind: z.literal("database"), name: z.string().min(1), rows: z.array(z.record(z.string(), z.unknown())) }).strict(),
  z.object({ kind: z.literal("setting"), name: z.string().min(1), value: z.string() }).strict(),
  z.object({ kind: z.literal("browser"), page: relativePath, html: z.string() }).strict(),
]);

export const stateAssertionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: relativePath, exists: z.boolean(), content: z.string().optional() }).strict()
    .refine((value) => value.exists || value.content === undefined, "absent files cannot have expected content"),
  z.object({ kind: z.literal("database"), name: z.string().min(1), row: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ kind: z.literal("setting"), name: z.string().min(1), value: z.string() }).strict(),
  z.object({ kind: z.literal("api"), key: z.string().min(1), value: z.unknown() }).strict(),
  z.object({ kind: z.literal("package"), name: z.string().min(1), installed: z.boolean() }).strict(),
  z.object({ kind: z.literal("extracted"), key: z.string().min(1), value: z.string() }).strict(),
]);

export const computerTaskSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  tier: z.number().int().min(1).max(3),
  world: z.enum(["local-vm", "container", "fixture"]),
  setup: z.array(setupStepSchema),
  goal: z.string().trim().min(1),
  timeoutMs: z.number().int().min(1_000).max(300_000),
  requiredEndState: z.array(stateAssertionSchema).min(1),
  forbiddenSideEffects: z.array(stateAssertionSchema),
  cleanup: z.array(relativePath).min(1),
}).strict();

export type ComputerTask = z.infer<typeof computerTaskSchema>;
export type StateAssertion = z.infer<typeof stateAssertionSchema>;

const text = z.string().min(1);

/** What the scripted agent does, in order. It addresses things the way a model does: by window title and element label,
 * from its own last read of the window, which is what lets a stale index go wrong. */
export const intentSchema = z.discriminatedUnion("do", [
  z.object({ do: z.literal("read"), window: text, record: z.object({ key: text, startsWith: text }).strict().optional() }).strict(),
  z.object({ do: z.literal("click"), window: text, label: text, via: z.enum(["index", "token"]).optional(),
    fresh: z.boolean().optional(), repeat: z.number().int().min(1).max(10).optional(),
    /** The click does no harm done twice, so a window that shows no change is worth trying again. */
    safeToRepeat: z.literal(true).optional() }).strict(),
  z.object({ do: z.literal("set"), window: text, label: text, value: z.string() }).strict(),
  z.object({ do: z.literal("scroll"), window: text, direction: z.enum(["down", "up"]), amount: z.number().int().min(1).optional(),
    times: z.number().int().min(1).max(10).optional() }).strict(),
  z.object({ do: z.literal("extract"), window: text, as: text, after: text.optional(), last: z.literal(true).optional(),
    /** Read what the field with this label holds. `optional`: a field whose value the agent was not given reads as empty. */
    readField: text.optional(), optional: z.literal(true).optional() }).strict()
    .refine((value) => [value.after, value.last, value.readField].filter((entry) => entry !== undefined).length === 1,
      "name exactly one of: the element to read after, the last element, or a field whose value to read")
    .refine((value) => value.optional === undefined || value.readField !== undefined, "only a field's value can be optional"),
]);

/** A task for the fixture world: the schema's own fields, the desktop it runs on, who answers the person's questions,
 * and the scripted agent's steps. */
export const benchTaskSchema = computerTaskSchema.extend({
  world: z.literal("fixture"),
  desktop: desktopSchema,
  /** How the person answers a confirmation: the scripted agent never answers one itself. */
  person: z.enum(["allow", "deny"]),
  /** What the person tells a model, with none of the scenario's traps given away. A task without one is not run by a model:
   * its end state describes the scripted agent's behaviour (two tries, then stop), not a result a person asked for. */
  ask: z.string().trim().min(1).optional(),
  intents: z.array(intentSchema).min(1).max(40),
});

export type BenchTask = z.infer<typeof benchTaskSchema>;
export type Intent = z.infer<typeof intentSchema>;
