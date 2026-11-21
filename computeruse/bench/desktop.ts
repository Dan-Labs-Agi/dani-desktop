// A desktop as data: windows of elements, a list that scrolls, files and settings. It answers the calls cua-driver does,
// in the shapes it does, and carries the failures the checks exist for: a click that lands on nothing, typing that does
// not take, list rows that move under a stale index. Nothing here opens a window or touches a real file.
import { z } from "zod";
import type { ComputerSnapshot } from "./scorers/state.ts";

const text = z.string();
const effectSchema = z.discriminatedUnion("do", [
  z.object({ do: z.literal("writeFile"), path: text.min(1), content: text }).strict(),
  z.object({ do: z.literal("deleteFile"), path: text.min(1) }).strict(),
  z.object({ do: z.literal("setSetting"), name: text.min(1), value: text }).strict(),
  z.object({ do: z.literal("setApi"), key: text.min(1), value: text }).strict(),
  z.object({ do: z.literal("openWindow"), id: z.number().int().positive() }).strict(),
  z.object({ do: z.literal("closeWindow") }).strict(),
]);

const elementSchema = z.object({
  role: text.min(1),
  label: text.optional(),
  value: text.optional(),
  /** Run, in order, when the element is clicked. Fields hold what was typed: `{Body}` in a value is the field labelled Body. */
  on: z.array(effectSchema).optional(),
  /** The first clicks the element swallows without doing anything: a click that reaches the window and lands on nothing. */
  inertClicks: z.number().int().min(0).optional(),
  /** The first times typing into the field is ignored. */
  dropSets: z.number().int().min(0).optional(),
}).strict();

const windowSchema = z.object({
  id: z.number().int().positive(),
  title: text.min(1),
  app: text.min(1),
  pid: z.number().int().positive().optional(),
  open: z.boolean().optional(),
  elements: z.array(elementSchema),
  /** A list that shows `page` of its rows after the fixed elements; clicking a row selects it. */
  scroll: z.object({ rows: z.array(text).min(1), page: z.number().int().min(1), offset: z.number().int().min(0).optional() }).strict().optional(),
}).strict();

export const desktopSchema = z.object({ windows: z.array(windowSchema).min(1) }).strict();
export type DesktopSpec = z.infer<typeof desktopSchema>;
export type DesktopEffect = z.infer<typeof effectSchema>;

export interface DesktopSeed {
  files?: Record<string, string>;
  settings?: Record<string, string>;
  databases?: Record<string, Array<Record<string, unknown>>>;
}

export interface DesktopResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: true;
}

const DEFAULT_PID = 100;
const EDITABLE = /text ?field|text ?area|combo ?box|search ?field/i;
const COUNTED = new Set(["click", "double_click", "right_click", "type_text", "set_value", "press_key", "hotkey", "scroll", "launch_app"]);

interface Slot { value: string; clicks: number; sets: number }
interface Live { index: number; role: string; label?: string; slot?: number; row?: string }

const ok = (message: string, structuredContent?: Record<string, unknown>): DesktopResult =>
  ({ content: [{ type: "text", text: message }], ...(structuredContent ? { structuredContent } : {}) });
const refuse = (message: string): DesktopResult => ({ content: [{ type: "text", text: message }], isError: true });
const isResult = (value: Live | DesktopResult): value is DesktopResult => "content" in value;

export function createDesktop(input: DesktopSpec, seed: DesktopSeed = {}) {
  const spec = desktopSchema.parse(input);
  const files: Record<string, string> = { ...seed.files };
  const settings: Record<string, string> = { ...seed.settings };
  const databases = Object.fromEntries(Object.entries(seed.databases ?? {}).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  const api: Record<string, string> = {};
  const windows = new Map(spec.windows.map((window) => [window.id, {
    spec: window,
    open: window.open !== false,
    offset: window.scroll?.offset ?? 0,
    reads: 0,
    slots: window.elements.map((element): Slot => ({ value: element.value ?? "", clicks: 0, sets: 0 })),
  }]));
  type Live_ = NonNullable<ReturnType<typeof windows.get>>;

  const maxOffset = (window: Live_) => Math.max(0, (window.spec.scroll?.rows.length ?? 0) - (window.spec.scroll?.page ?? 0));
  const layout = (window: Live_): Live[] => {
    const elements: Live[] = [{ index: 1, role: "AXWindow" }];
    window.spec.elements.forEach((element, slot) => elements.push({ index: elements.length + 1, role: element.role, ...(element.label === undefined ? {} : { label: element.label }), slot }));
    const scroll = window.spec.scroll;
    if (scroll) for (const row of scroll.rows.slice(window.offset, window.offset + scroll.page)) elements.push({ index: elements.length + 1, role: "AXRow", label: row, row });
    return elements;
  };
  const valueOf = (window: Live_, label: string) => {
    const slot = window.spec.elements.findIndex((element) => element.label === label);
    return slot >= 0 ? window.slots[slot]!.value : "";
  };
  const fill = (window: Live_, template: string) => template.replace(/\{([^}]+)\}/g, (_whole, label: string) => valueOf(window, label));

  const run = (window: Live_, effects: readonly DesktopEffect[]) => {
    for (const effect of effects) {
      if (effect.do === "writeFile") files[effect.path] = fill(window, effect.content);
      else if (effect.do === "deleteFile") delete files[effect.path];
      else if (effect.do === "setSetting") settings[effect.name] = fill(window, effect.value);
      else if (effect.do === "setApi") api[effect.key] = fill(window, effect.value);
      else if (effect.do === "openWindow") { const other = windows.get(effect.id); if (other) other.open = true; }
      else window.open = false;
    }
  };

  const find = (args: Record<string, unknown>): Live_ | null => {
    const id = args.window_id;
    const window = typeof id === "number" ? windows.get(id) : undefined;
    return window?.open ? window : null;
  };

  const target = (window: Live_, args: Record<string, unknown>): Live | DesktopResult | null => {
    const elements = layout(window);
    if (typeof args.element_token === "string") {
      const found = elements.find((element) => args.element_token === `s${window.reads}-e${element.index}`);
      return found ?? refuse("That element token is from an earlier read of this window; read the window again.");
    }
    if (typeof args.element_index === "number") return elements.find((element) => element.index === args.element_index) ?? refuse(`No element ${args.element_index} in this window.`);
    return typeof args.x === "number" && typeof args.y === "number" ? null : refuse("The call names no element and no point.");
  };

  const scrolled = (window: Live_, by: number) => {
    window.offset = Math.min(maxOffset(window), Math.max(0, window.offset + by));
  };

  const handlers: Record<string, (args: Record<string, unknown>) => DesktopResult> = {
    get_window_state(args) {
      const window = find(args);
      if (!window) return refuse("No open window has that id.");
      window.reads += 1;
      const elements = layout(window).map((element) => {
        const value = element.slot === undefined ? undefined : window.slots[element.slot]!.value;
        return {
          element_index: element.index, element_token: `s${window.reads}-e${element.index}`, role: element.role,
          ...(element.label === undefined ? {} : { label: element.label }),
          depth: element.index === 1 ? 0 : 1, ...(element.index === 1 ? {} : { parent_index: 1 }),
          ...(value !== undefined && (EDITABLE.test(element.role) || value !== "") ? { value } : {}),
        };
      });
      return ok(`${window.spec.title}: ${elements.length} elements`, {
        pid: window.spec.pid ?? DEFAULT_PID, window_id: window.spec.id, app_name: window.spec.app, window_title: window.spec.title, elements, elements_complete: true,
      });
    },
    list_windows: () => ok("windows", { windows: [...windows.values()].filter((window) => window.open).map((window) => ({
      window_id: window.spec.id, pid: window.spec.pid ?? DEFAULT_PID, title: window.spec.title, app_name: window.spec.app })) }),
    list_apps: () => ok("apps", { apps: [...new Set([...windows.values()].map((window) => window.spec.app))].map((name) => ({ pid: DEFAULT_PID, name, running: true })) }),
    launch_app: () => ok("launched", { pid: DEFAULT_PID }),
    click(args) {
      const window = find(args);
      if (!window) return refuse("No open window has that id.");
      const element = target(window, args);
      if (element && isResult(element)) return element;
      if (!element) return ok("Clicked a point; nothing was under it.");
      if (element.row !== undefined) {
        api.selected = element.row;
        api[`clicked.${element.row}`] = "yes";
        return ok(`Clicked ${element.row}`);
      }
      if (element.slot === undefined) return ok("Clicked the window.");
      const slot = window.slots[element.slot]!;
      slot.clicks += 1;
      if (slot.clicks <= (window.spec.elements[element.slot]!.inertClicks ?? 0)) return ok(`Clicked ${element.label ?? element.role}.`);
      run(window, window.spec.elements[element.slot]!.on ?? []);
      return ok(`Clicked ${element.label ?? element.role}.`);
    },
    set_value(args) {
      return entering(args, typeof args.value === "string" ? args.value : null, false);
    },
    type_text(args) {
      return entering(args, typeof args.text === "string" ? args.text : null, true);
    },
    scroll(args) {
      const window = find(args);
      if (!window?.spec.scroll) return refuse("That window has nothing to scroll.");
      const amount = typeof args.amount === "number" ? args.amount : window.spec.scroll.page;
      if (args.direction === "down") scrolled(window, amount);
      else if (args.direction === "up") scrolled(window, -amount);
      return ok("Scrolled.");
    },
    press_key(args) {
      const window = find(args);
      if (window?.spec.scroll && (args.key === "PageDown" || args.key === "PageUp")) scrolled(window, (args.key === "PageDown" ? 1 : -1) * window.spec.scroll.page);
      return ok(`Pressed ${String(args.key)}.`);
    },
    set_agent_cursor_enabled(args) {
      api["cursor.enabled"] = String(args.enabled === true);
      return ok("cursor");
    },
    set_agent_cursor_motion(args) {
      if (typeof args.glide_duration_ms === "number") api["cursor.glide"] = String(args.glide_duration_ms);
      return ok("cursor motion");
    },
  };
  handlers.double_click = handlers.click!;
  handlers.right_click = handlers.click!;
  handlers.hotkey = () => ok("Pressed keys.");

  function entering(args: Record<string, unknown>, text: string | null, append: boolean): DesktopResult {
    const window = find(args);
    if (!window) return refuse("No open window has that id.");
    const element = target(window, args);
    if (!element) return refuse("Typing needs an element.");
    if (isResult(element)) return element;
    if (element.slot === undefined || !EDITABLE.test(element.role)) return refuse("That element cannot be edited.");
    if (text === null) return refuse("Nothing to type.");
    const slot = window.slots[element.slot]!;
    slot.sets += 1;
    if (slot.sets <= (window.spec.elements[element.slot]!.dropSets ?? 0)) return ok("Typed.");
    slot.value = append ? slot.value + text : text;
    return ok("Typed.");
  }

  return {
    handle(tool: string, args: Record<string, unknown>): DesktopResult {
      if (COUNTED.has(tool)) api[`calls.${tool}`] = String(Number(api[`calls.${tool}`] ?? 0) + 1);
      const handler = handlers[tool];
      return handler ? handler(args) : refuse(`This desktop has no tool called ${tool}.`);
    },
    snapshot(): ComputerSnapshot {
      return { files: { ...files }, databases: Object.fromEntries(Object.entries(databases).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))])),
        settings: { ...settings }, api: { ...api }, packages: new Set<string>(), extracted: {} };
    },
  };
}
