import { expect, it } from "vitest";
import type { Coordinator, HandoffView } from "../coordinator.ts";
import { runtimeWorkPending } from "./runtime-work-pending.ts";

const root = (patch: Partial<HandoffView> = {}) => ({ id: "root", threadId: "thread", status: "source", startedAt: 100, ...patch }) as HandoffView;
const world = (roots: HandoffView[], children: HandoffView[] = [], outstanding: HandoffView[] = []) => ({
  active: () => roots, children: () => children, outstandingFor: () => outstanding,
}) as Pick<Coordinator, "active" | "children" | "outstandingFor">;

it("leaves a cut native turn to RoutineManager, not the restored job root", () => {
  expect(runtimeWorkPending(world([root({ status: "queued", restart: "rerun" })]), "thread")).toBe(false);
  expect(runtimeWorkPending(world([root({ status: "resume", restart: "rerun" })]), "thread")).toBe(false);
});
it("retains live children even when their native root was cut", () => {
  const child = root({ parentId: "root", threadId: "worker" });
  expect(runtimeWorkPending(world([root({ restart: "rerun" })], [], [child]), "thread")).toBe(true);
});
it("keeps real parked and queued work pending", () => {
  for (const status of ["queued", "waiting", "resume"] as const) {
    expect(runtimeWorkPending(world([root({ status })]), "thread")).toBe(true);
  }
});
it("only waits for children from this running turn which owe a reply", () => {
  expect(runtimeWorkPending(world([root()]), "thread")).toBe(false);
  expect(runtimeWorkPending(world([root()], [root({ createdAt: 99, reply: "resume" })]), "thread")).toBe(false);
  expect(runtimeWorkPending(world([root()], [root({ createdAt: 101, reply: "none" })]), "thread")).toBe(false);
  expect(runtimeWorkPending(world([root()], [root({ createdAt: 101, reply: "resume" })]), "thread")).toBe(true);
});
