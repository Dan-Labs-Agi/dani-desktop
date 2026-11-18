import { expect, it, vi } from "vitest";
import type { Coordinator, HandoffView } from "../coordinator.ts";
import type { TurnStop } from "../turn-outcome.ts";
import { knownProviderPrerequisite, retirePreviousProviderBlock } from "./provider-block.ts";

it("only recognizes known account prerequisites without uncertain or refused effects", () => {
  for (const flags of [{ setup: true }, { limit: "engine" as const }, { limitResetsAt: 123 }]) {
    expect(knownProviderPrerequisite({ flags })).toBe(true);
    for (const patch of [{ unknownEffect: true }, { cancelled: true }, { flags: { ...flags, toolError: true } },
      { flags: { ...flags, permissionDenied: true } }, { flags: { ...flags, recovery: "blocked" } }] as Partial<TurnStop>[]) {
      expect(knownProviderPrerequisite({ flags, ...patch })).toBe(false);
    }
  }
  expect(knownProviderPrerequisite(undefined)).toBe(false);
  expect(knownProviderPrerequisite({ error: "usage limit" })).toBe(false);
});

it("retires only the newest direct root of the previous request in this thread", () => {
  const row = (patch: Partial<HandoffView>) => ({ id: "old", threadId: "thread", createdAt: 1, ...patch }) as HandoffView;
  const retireProviderBlock = vi.fn(() => true);
  const coordinator = { all: () => [row({}), row({ id: "new", createdAt: 2 }), row({ id: "unowned", createdAt: 10 }),
    row({ id: "child", parentId: "new", createdAt: 11 }), row({ id: "room", groupId: "g", createdAt: 12 }),
    row({ id: "elsewhere", threadId: "other", createdAt: 13 })], retireProviderBlock } satisfies Pick<Coordinator, "all" | "retireProviderBlock">;
  const generations = new Set(["old", "new", "child", "room", "elsewhere"]);
  expect(retirePreviousProviderBlock(coordinator, "thread", generations, { flags: { setup: true } })).toBe(true);
  expect(retireProviderBlock).toHaveBeenCalledExactlyOnceWith("new");
  retireProviderBlock.mockClear();
  expect(retirePreviousProviderBlock(coordinator, "thread", generations, { unknownEffect: true, flags: { setup: true } })).toBe(false);
  expect(retirePreviousProviderBlock(coordinator, "thread", undefined, { flags: { setup: true } })).toBe(false);
  expect(retireProviderBlock).not.toHaveBeenCalled();
});
