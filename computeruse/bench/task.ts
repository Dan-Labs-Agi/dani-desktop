import { z } from "zod";

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
  world: z.enum(["local-vm", "container"]),
  setup: z.array(setupStepSchema),
  goal: z.string().trim().min(1),
  timeoutMs: z.number().int().min(1_000).max(300_000),
  requiredEndState: z.array(stateAssertionSchema).min(1),
  forbiddenSideEffects: z.array(stateAssertionSchema),
  cleanup: z.array(relativePath).min(1),
}).strict();

export type ComputerTask = z.infer<typeof computerTaskSchema>;
export type StateAssertion = z.infer<typeof stateAssertionSchema>;
