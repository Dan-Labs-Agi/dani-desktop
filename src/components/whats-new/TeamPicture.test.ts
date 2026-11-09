// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { AvatarInstance } from "@/components/robot/robot-avatar-engine";

const engine = vi.hoisted(() => ({ instances: new Map<HTMLElement, AvatarInstance>() }));
// Keep the real React avatar adapter. Only its shared GPU registration is replaced.
vi.mock("@/components/robot/robot-avatar-engine", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/robot/robot-avatar-engine")>(),
  registerAvatar: (instance: AvatarInstance) => {
    engine.instances.set(instance.element, instance);
    return () => engine.instances.delete(instance.element);
  },
}));
const { TeamPicture } = await import("./TeamPicture");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const render = async (active = true) => { await act(async () => { root.render(createElement(TeamPicture, { active })); }); };
const mascots = () => [...host.querySelectorAll<HTMLElement>("[data-robot-role]")];
const avatars = () => {
  expect(mascots()).toHaveLength(8);
  const instances = mascots().map(node => engine.instances.get(node));
  expect(instances.every(Boolean), "all eight real avatar adapters registered").toBe(true);
  return instances as AvatarInstance[];
};
const texts = () => [...host.querySelectorAll("text")].map(node => node.textContent);

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D); setLocale("en"); host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); expect(engine.instances.size).toBe(0); delete document.documentElement.dataset.reducedMotion; });

it("is one labelled picture: four teammates, each with a Chief of Staff of their own, around the team's shared bots in two departments", async () => {
  await render();
  const picture = host.querySelector('svg[role="img"]')!;
  expect(picture.getAttribute("aria-label")).toBe("Ada, Ben, Cleo and Dara, each with their own Chief of Staff, share the team's Support and Sales bots on one Team Cloud.");
  expect(texts()).toEqual(["Support", "Sales", "A", "Ada", "B", "Ben", "C", "Cleo", "D", "Dara"]);
  expect(mascots().map(node => node.dataset.robotRole), "the departments' bots, then each person's Chief").toEqual(["sprout", "tuft", "bow", "cap", "dani", "dani", "dani", "dani"]);
  expect(host.querySelectorAll('path[d^="M0 5.5"]'), "a crown on each Chief").toHaveLength(4);
  expect(mascots()).toHaveLength(8);
  const before = avatars().map(instance => ({ ...instance }));
  await act(async () => {
    for (const node of mascots()) node.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 170, clientY: 90 }));
    document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 330, clientY: 150 }));
  });
  expect(avatars(), "the real avatar adapter does not follow pointer movement").toEqual(before);
});

it("work moves to the shared bots only while it may: never under reduced motion, nor on a slide that isn't on screen", async () => {
  await render();
  expect(host.querySelectorAll("animateMotion")).toHaveLength(8);
  expect(avatars().every(instance => instance.animated === true)).toBe(true);
  await render(false);
  expect(host.querySelectorAll("animateMotion")).toHaveLength(0);
  expect(avatars().every(instance => instance.animated === false)).toBe(true);
  await render(true);
  document.documentElement.dataset.reducedMotion = "true";
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(host.querySelectorAll("animateMotion")).toHaveLength(0);
  expect(avatars().every(instance => instance.animated === false)).toBe(true);
});
