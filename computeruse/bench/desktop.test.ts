import { describe, expect, it } from "vitest";
import { createDesktop, type DesktopSpec } from "./desktop.ts";

const notes: DesktopSpec = {
  windows: [{
    id: 1, title: "Notes", app: "Notes",
    elements: [
      { role: "AXTextField", label: "Body", value: "" },
      { role: "AXButton", label: "Save", on: [{ do: "writeFile", path: "note.txt", content: "{Body}" }] },
    ],
  }],
};
const WINDOW = { pid: 100, window_id: 1 };

const read = (desktop: ReturnType<typeof createDesktop>, args: Record<string, unknown> = WINDOW) =>
  desktop.handle("get_window_state", args).structuredContent as { elements: Array<Record<string, any>>; window_title: string; app_name: string };
const indexOf = (state: ReturnType<typeof read>, label: string) => state.elements.find((element) => element.label === label)!.element_index as number;

describe("the fake desktop", () => {
  it("reads a window as the driver does: a root, then its elements with indexes and tokens", () => {
    const state = read(createDesktop(notes));
    expect(state).toMatchObject({ pid: 100, window_id: 1, window_title: "Notes", app_name: "Notes", elements_complete: true });
    expect(state.elements[0]).toMatchObject({ element_index: 1, role: "AXWindow", depth: 0 });
    expect(state.elements.slice(1).map((element) => [element.role, element.label, element.depth, element.parent_index])).toEqual([
      ["AXTextField", "Body", 1, 1], ["AXButton", "Save", 1, 1],
    ]);
    expect(state.elements.every((element) => typeof element.element_token === "string")).toBe(true);
  });

  it("types into a field and runs a button's effect with what the fields hold", () => {
    const desktop = createDesktop(notes);
    const state = read(desktop);
    desktop.handle("set_value", { ...WINDOW, element_index: indexOf(state, "Body"), value: "hello" });
    expect(read(desktop).elements.find((element) => element.label === "Body")!.value).toBe("hello");
    desktop.handle("click", { ...WINDOW, element_index: indexOf(state, "Save") });
    expect(desktop.snapshot().files["note.txt"]).toBe("hello");
  });

  it("appends typed text to a field's text, as the driver does, and replaces it for set_value", () => {
    const desktop = createDesktop(notes);
    const body = indexOf(read(desktop), "Body");
    desktop.handle("type_text", { ...WINDOW, element_index: body, text: "ab" });
    desktop.handle("type_text", { ...WINDOW, element_index: body, text: "cd" });
    expect(read(desktop).elements.find((element) => element.label === "Body")!.value).toBe("abcd");
    desktop.handle("set_value", { ...WINDOW, element_index: body, value: "x" });
    expect(read(desktop).elements.find((element) => element.label === "Body")!.value).toBe("x");
  });

  it("refuses an element token from an earlier read, as the driver does, and counts the calls it was given", () => {
    const desktop = createDesktop(notes);
    const first = read(desktop);
    const save = first.elements.find((element) => element.label === "Save")!;
    read(desktop);
    const stale = desktop.handle("click", { ...WINDOW, element_token: save.element_token });
    expect(stale.isError).toBe(true);
    expect(desktop.snapshot().api["calls.click"]).toBe("1");
  });

  it("swallows the first clicks and sets a button is told to, then behaves", () => {
    const desktop = createDesktop({ windows: [{ id: 1, title: "W", app: "A", elements: [
      { role: "AXButton", label: "Apply", inertClicks: 1, on: [{ do: "setSetting", name: "applied", value: "yes" }] },
      { role: "AXTextField", label: "Name", dropSets: 1 },
    ] }] });
    const state = read(desktop, { pid: 1, window_id: 1 });
    const apply = indexOf(state, "Apply");
    desktop.handle("click", { pid: 1, window_id: 1, element_index: apply });
    expect(desktop.snapshot().settings.applied).toBeUndefined();
    desktop.handle("click", { pid: 1, window_id: 1, element_index: apply });
    expect(desktop.snapshot().settings.applied).toBe("yes");
    const name = indexOf(state, "Name");
    desktop.handle("set_value", { pid: 1, window_id: 1, element_index: name, value: "ann" });
    expect(read(desktop, { pid: 1, window_id: 1 }).elements.find((element) => element.label === "Name")!.value ?? "").toBe("");
    desktop.handle("set_value", { pid: 1, window_id: 1, element_index: name, value: "ann" });
    expect(read(desktop, { pid: 1, window_id: 1 }).elements.find((element) => element.label === "Name")!.value).toBe("ann");
  });

  it("changes nothing for a click at a point", () => {
    const desktop = createDesktop(notes);
    const before = JSON.stringify(read(desktop).elements.map((element) => [element.label, element.value]));
    expect(desktop.handle("click", { ...WINDOW, x: 5, y: 5 }).isError).not.toBe(true);
    expect(JSON.stringify(read(desktop).elements.map((element) => [element.label, element.value]))).toBe(before);
  });

  it("rejects a window or element that is not there, in words, without throwing", () => {
    const desktop = createDesktop(notes);
    expect(desktop.handle("get_window_state", { pid: 1, window_id: 99 }).isError).toBe(true);
    expect(desktop.handle("click", { ...WINDOW, element_index: 99 }).isError).toBe(true);
    expect(desktop.handle("no_such_tool", {}).isError).toBe(true);
  });

  it("keeps the file, setting, api and package state apart from what is on screen", () => {
    const desktop = createDesktop(notes, { files: { "a.txt": "1" }, settings: { theme: "light" } });
    expect(desktop.snapshot()).toMatchObject({ files: { "a.txt": "1" }, settings: { theme: "light" }, api: {}, extracted: {} });
    expect(desktop.snapshot().packages.size).toBe(0);
  });
});

describe("a scrolling list", () => {
  const list: DesktopSpec = { windows: [{
    id: 1, title: "Files", app: "Finder",
    elements: [{ role: "AXStaticText", label: "Files" }],
    scroll: { rows: ["A", "B", "C", "D", "E", "F", "G", "H"], page: 4 },
  }] };

  it("shows a page of rows after the fixed elements, and moves them when scrolled", () => {
    const desktop = createDesktop(list);
    const rows = (state: ReturnType<typeof read>) => state.elements.filter((element) => element.role === "AXRow").map((element) => element.label);
    expect(rows(read(desktop, { pid: 1, window_id: 1 }))).toEqual(["A", "B", "C", "D"]);
    desktop.handle("scroll", { pid: 1, window_id: 1, direction: "down", amount: 2 });
    expect(rows(read(desktop, { pid: 1, window_id: 1 }))).toEqual(["C", "D", "E", "F"]);
  });

  it("gives the same index to a different row once the list has moved, which is how a stale index misses", () => {
    const desktop = createDesktop(list);
    const before = read(desktop, { pid: 1, window_id: 1 });
    const second = before.elements.find((element) => element.label === "B")!.element_index;
    desktop.handle("scroll", { pid: 1, window_id: 1, direction: "down", amount: 2 });
    desktop.handle("click", { pid: 1, window_id: 1, element_index: second });
    expect(desktop.snapshot().api.selected).toBe("D");
    expect(desktop.snapshot().api).toMatchObject({ "clicked.D": "yes" });
    expect(desktop.snapshot().api).not.toHaveProperty("clicked.B");
  });

  it("stops at the end and the start, changing nothing there", () => {
    const desktop = createDesktop(list);
    desktop.handle("scroll", { pid: 1, window_id: 1, direction: "down", amount: 99 });
    const end = JSON.stringify(read(desktop, { pid: 1, window_id: 1 }).elements);
    desktop.handle("scroll", { pid: 1, window_id: 1, direction: "down", amount: 3 });
    expect(JSON.stringify(read(desktop, { pid: 1, window_id: 1 }).elements.map((element) => element.label))).toBe(JSON.stringify(JSON.parse(end).map((element: any) => element.label)));
    expect(read(desktop, { pid: 1, window_id: 1 }).elements.filter((element) => element.role === "AXRow").map((element) => element.label)).toEqual(["E", "F", "G", "H"]);
    desktop.handle("scroll", { pid: 1, window_id: 1, direction: "up", amount: 99 });
    expect(read(desktop, { pid: 1, window_id: 1 }).elements.filter((element) => element.role === "AXRow")[0]!.label).toBe("A");
  });

  it("pages with the page keys", () => {
    const desktop = createDesktop(list);
    desktop.handle("press_key", { pid: 1, window_id: 1, key: "PageDown" });
    expect(read(desktop, { pid: 1, window_id: 1 }).elements.filter((element) => element.role === "AXRow")[0]!.label).toBe("E");
  });
});

describe("windows that open and close", () => {
  const dialog: DesktopSpec = { windows: [
    { id: 1, title: "Editor", app: "Edit", elements: [{ role: "AXButton", label: "Save", on: [{ do: "openWindow", id: 2 }] }] },
    { id: 2, title: "Replace file?", app: "Edit", open: false, elements: [{ role: "AXButton", label: "Replace", on: [{ do: "writeFile", path: "doc.txt", content: "v2" }, { do: "closeWindow" }] }] },
  ] };

  it("lists only the windows that are open", () => {
    const desktop = createDesktop(dialog);
    const titles = () => (desktop.handle("list_windows", {}).structuredContent as { windows: Array<{ title: string }> }).windows.map((window) => window.title);
    expect(titles()).toEqual(["Editor"]);
    desktop.handle("click", { pid: 100, window_id: 1, element_index: 2 });
    expect(titles()).toEqual(["Editor", "Replace file?"]);
    desktop.handle("click", { pid: 100, window_id: 2, element_index: 2 });
    expect(titles()).toEqual(["Editor"]);
    expect(desktop.snapshot().files["doc.txt"]).toBe("v2");
  });
});

describe("what the desktop remembers about the driver's use", () => {
  it("notes the cursor being turned on and given a glide", () => {
    const desktop = createDesktop(notes);
    desktop.handle("set_agent_cursor_enabled", { enabled: true });
    desktop.handle("set_agent_cursor_motion", { glide_duration_ms: 400 });
    expect(desktop.snapshot().api).toMatchObject({ "cursor.enabled": "true", "cursor.glide": "400" });
  });
});
