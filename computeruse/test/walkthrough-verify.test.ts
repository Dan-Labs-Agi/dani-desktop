import { describe, expect, it } from "vitest";
import { checkExpectation, expectationProblem, type WindowReading } from "../walkthrough-verify.ts";

const reading = (over: Partial<WindowReading> = {}): WindowReading => ({
  title: "Checkout - Shop", complete: true,
  elements: [
    { index: 1, role: "Edit", label: "Name", value: "Ann" },
    { index: 2, role: "Button", label: "Pay" },
    { index: 3, role: "Button", label: "Pay" },
    { index: 4, role: "Text", label: "Receipt" },
  ],
  ...over,
});

describe("checking what a step should have done", () => {
  it("passes when every part holds, saying what held", () => {
    const verdict = checkExpectation({ present: { label: "receipt" }, absent: { label: "Cancel" }, field: { label: "Name", equals: "Ann" }, titleIncludes: "checkout" }, reading());
    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain("\"receipt\" is there");
    expect(verdict.detail).toContain("\"Cancel\" is gone");
  });

  it("fails when any part does not, and names each that did not", () => {
    const verdict = checkExpectation({ present: { label: "Thanks" }, titleIncludes: "Done" }, reading());
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("\"Thanks\" is not there");
    expect(verdict.detail).toContain("the window title does not have \"Done\"");
  });

  it("looks at a role when one is given", () => {
    expect(checkExpectation({ present: { label: "Receipt", role: "Button" } }, reading()).ok).toBe(false);
    expect(checkExpectation({ present: { label: "Receipt", role: "text" } }, reading()).ok).toBe(true);
  });

  it("cannot say something is gone from a window it read only in part", () => {
    const verdict = checkExpectation({ absent: { label: "Cancel" } }, reading({ complete: false }));
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("read in part");
    expect(checkExpectation({ absent: { label: "Pay" } }, reading()).detail).toContain("still there");
  });

  it("checks a field only when exactly one control has the label, and never prints what it holds", () => {
    expect(checkExpectation({ field: { label: "Pay", equals: "x" } }, reading()).detail).toContain("several controls");
    expect(checkExpectation({ field: { label: "Nothing", equals: "x" } }, reading()).detail).toContain("no control");
    const wrong = checkExpectation({ field: { label: "Name", equals: "Bob" } }, reading());
    expect(wrong.ok).toBe(false);
    expect(wrong.detail).not.toMatch(/Ann|Bob/);
  });

  it("refuses a check on a field named for a secret, and a check that names nothing", () => {
    expect(expectationProblem({ field: { label: "Card number", equals: "4111" } })).toContain("secret");
    expect(expectationProblem({ field: { label: "Password", equals: "x" } })).toContain("secret");
    expect(expectationProblem({})).toContain("has to name something");
    expect(expectationProblem({ present: { label: "Done" } })).toBeNull();
  });
});
