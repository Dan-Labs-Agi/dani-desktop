import { expect, it } from "vitest";
import { createReceiptWriter } from "../action-receipt.ts";
import { emptyCounters, snapshotCounters } from "../counters.ts";

it("records observed effects without retaining arguments or driver text", async () => {
  const write = createReceiptWriter();
  const counts = emptyCounters();
  const result = await write("click", async () => { counts.changed++; return { content: [{ type: "text", text: "private driver data" }] }; }, () => snapshotCounters(counts));
  const receipt = (result.structuredContent as { actionReceipt: unknown }).actionReceipt;
  expect(receipt).toMatchObject({ sequence: 1, tool: "click", outcome: "driver-reported", observation: "changed" });
  expect(JSON.stringify(receipt)).not.toContain("private driver data");
});

it("records thrown actions as unknown effects and advances the sequence", async () => {
  const write = createReceiptWriter();
  const counts = () => emptyCounters();
  await write("click", async () => ({}), counts);
  const result = await write("click", async () => { throw new Error("secret"); }, counts);
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({ actionReceipt: { sequence: 2, outcome: "error", observation: "not-checked" } });
  expect(JSON.stringify(result)).not.toContain("secret");
});
