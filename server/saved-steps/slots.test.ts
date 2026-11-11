import { describe, expect, it } from "vitest";
import { exactRequest, requestKey } from "./key.ts";
import type { Recipe, RecipeStep } from "./rules.ts";
import { MAX_SLOTS, refillRecipe } from "./slots.ts";

const field: RecipeStep["element"] = { role: "AXTextField", label: "Description", path: ["AXGroup:Form"] };
const typing = (value: string): RecipeStep =>
  ({ tool: "set_value", args: { value }, app: { name: "Expenses" }, window: { title: "New expense" }, element: field });
const clicking: RecipeStep = { tool: "click", args: {}, app: { name: "Expenses" }, window: { title: "New expense" },
  element: { role: "AXButton", label: "Add row", path: ["AXGroup:Form"] } };

const recipe = (request: string, steps: RecipeStep[]): Recipe =>
  ({ id: "r1", key: requestKey(request), request: exactRequest(request), steps, createdAt: 1, lastUsedAt: 1 });

const august = recipe("file my august expense report", [clicking, typing("august")]);

describe("a recipe refilled from a new request", () => {
  it("fills the typed span from the new words, keeping the rest of the recipe", () => {
    const filled = refillRecipe(august, "file my september expense report")!;
    expect(filled.steps[1]!.args.value).toBe("september");
    expect(filled.steps[0]).toEqual(clicking);
    expect(filled.id).toBe(august.id);
    expect(filled.request).toBe("file my september expense report");
    expect(filled.key).toBe(requestKey("file my september expense report"));
  });

  it("keeps the words the person wrote, as they wrote them", () => {
    expect(refillRecipe(august, "file my Q3 FY26 expense report")!.steps[1]!.args.value).toBe("Q3 FY26");
    expect(refillRecipe(august, "Please file my October expense report")!.steps[1]!.args.value).toBe("October");
  });

  it("fills one span used by several steps from one slot", () => {
    const twice = recipe("tag the august folder", [typing("august"), typing("august")]);
    const filled = refillRecipe(twice, "tag the october folder");
    expect(filled?.steps.map((step) => step.args.value)).toEqual(["october", "october"]);
  });

  it("is nothing at all when the new request does not fit the recipe's shape", () => {
    for (const other of [
      "file my august expense",
      "submit my september expense report",
      "file my september expense report now please extra",
      "",
    ]) expect(refillRecipe(august, other)).toBeNull();
  });

  it("never fills a slot from a word that points at a moment, which means something else each time", () => {
    for (const moment of ["this", "the latest", "today", "that"]) {
      expect(refillRecipe(august, `file my ${moment} expense report`)).toBeNull();
    }
  });

  it("never fills a slot with a final action or a secret, however the new request words it", () => {
    for (const value of ["delete", "transfer", "password", "card number"]) {
      expect(refillRecipe(august, `file my ${value} expense report`)).toBeNull();
    }
  });

  it("refuses a recipe whose whole request is one slot: it would answer anything", () => {
    expect(refillRecipe(recipe("august", [typing("august")]), "october")).toBeNull();
    expect(refillRecipe(recipe("do august", [typing("august")]), "do october")).toBeNull();
  });

  it("leaves the same key in other words or other case to the exact path, which refuses it", () => {
    for (const same of ["file my august expense report", "Please file my AUGUST expense report!", "  file  my august expense report  "]) {
      expect(refillRecipe(august, same)).toBeNull();
    }
  });

  it("refuses a recipe with no typed words: the exact key already answers those", () => {
    expect(refillRecipe(recipe("open the expense form", [clicking]), "open the expense form")).toBeNull();
  });

  it("refuses to refill a link: a new host is a different place, not a new value", () => {
    const opening: RecipeStep = { tool: "launch_app", args: { name: "Safari", urls: ["https://pay.example.com/august"] } };
    expect(refillRecipe(recipe("open https://pay.example.com/august", [opening]), "open https://pay.example.com/october")).toBeNull();
  });

  it("refuses spans that cannot be told apart, and more slots than it will carry", () => {
    expect(refillRecipe(recipe("copy aug to august", [typing("aug"), typing("august")]), "copy sep to september")).toBeNull();
    expect(refillRecipe(recipe("set a to a and b", [typing("a"), typing("b")]), "set x to x and y")).toBeNull();
    const many = Array.from({ length: MAX_SLOTS + 1 }, (_, index) => typing(`value${index}`));
    const request = many.map((_, index) => `field value${index}`).join(" and ");
    expect(refillRecipe(recipe(request, many), request.replace(/value/g, "other"))).toBeNull();
  });

  it("refuses two spans that are one hole in the key, so no step can claim it", () => {
    const cased = recipe("copy August into august", [typing("August"), typing("august")]);
    expect(refillRecipe(cased, "copy October into october")).toBeNull();
  });

  it("refuses a span that shows up more than once in the request it was learned from", () => {
    expect(refillRecipe(recipe("copy august into august report", [typing("august")]), "copy october into october report")).toBeNull();
  });
});
