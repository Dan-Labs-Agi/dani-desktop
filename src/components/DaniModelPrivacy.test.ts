// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstanceInfo } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { simpleModelMenu } from "@/lib/simple-model-menu";
import { SimpleModelMenu } from "./SimpleModelMenu";
import { ModelRow } from "./ModelPickerFull";
import { modelMenuKey } from "./model-menu-keys";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const notice = "KiloCode trial terms: prompts may be retained. " + "Full model-specific conditions apply. ".repeat(30) + "Read https://example.test/legal?model=one&trial=true and https://example.test/privacy. Final mandatory sentence.";
const option = { id: "one", label: "OpenCode · Helpful One", tools: true, imageInput: false, mayTrainOnYourPrompts: true, privacyNotice: notice };
const instance: InstanceInfo = { instanceId: "dani", driverKind: "daniFree", displayName: "Dani", snapshot: { state: "available", authenticated: true }, models: { default: "one", options: [option] } };
const selection = { instanceId: "dani", model: "one" };
let host: HTMLDivElement, root: Root;
const onPick = vi.fn();
beforeEach(() => {
  setLocale("en"); onPick.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

for (const surface of ["simple", "advanced"] as const) describe(`${surface} Dani model privacy`, () => {
  const show = async (blocked = false, privacyNotice = notice) => {
    const offered: InstanceInfo = { ...instance, models: { ...instance.models, options: [{ ...option, orgBlocked: blocked ? true : undefined, privacyNotice }] } };
    await act(async () => root.render(surface === "advanced"
      ? createElement(ModelRow, { option: offered.models.options[0]!, current: true, defaultId: "one", daniFree: true, onPick })
      : createElement(SimpleModelMenu, {
        menu: simpleModelMenu({ instances: [offered], listed: [offered], selection, bot: { name: "Dani", selection }, query: "", expanded: new Set(), probing: new Set(), loading: false }),
        query: "", bot: { name: "Dani", color: "chrome" }, botModel: { label: "Helpful One", title: "Helpful One" }, idPrefix: "privacy-test",
        onQuery: vi.fn(), onPick, onPickCurrent: vi.fn(), onFollowBot: vi.fn(), onToggle: vi.fn(), onSetUp: vi.fn(), onCheckAgain: vi.fn(), onManage: vi.fn(),
      })));
  };

  it("keeps rows concise while preserving the entire model notice and clickable legal URLs in a separate disclosure", async () => {
    await show();
    const pick = [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((button) => button.textContent?.includes("Tools supported"))!;
    expect(pick).toBeDefined();
    expect(pick.textContent).toContain("Text only");
    expect(pick.textContent).toContain("Prompts may train models");
    expect(pick.textContent).not.toContain("Full model-specific conditions");
    expect(pick.getAttribute("aria-label")).not.toMatch(/KiloCode|OpenCode|trial terms/);
    expect(pick.querySelector("button, a, summary")).toBeNull();
    const disclosure = host.querySelector<HTMLDetailsElement>("details[data-dani-model-notice]")!;
    expect(disclosure).not.toBeNull();
    expect(disclosure.open).toBe(false);
    const summary = disclosure.querySelector("summary")!;
    expect(summary.textContent).toMatch(/privacy|terms/i);
    expect(summary.getAttribute("aria-label")).toContain("Helpful One");
    expect(disclosure.querySelector("[data-dani-notice-text]")).toBeNull();
    summary.focus();
    const close = vi.fn();
    const typed = { current: null };
    const native = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    Object.defineProperties(native, { target: { value: summary }, currentTarget: { value: host } });
    await act(async () => modelMenuKey(native as unknown as ReactKeyboardEvent<HTMLElement>, { query: "", typed, close }));
    expect(disclosure.open).toBe(true);
    expect(document.activeElement).toBe(summary);
    expect(onPick).not.toHaveBeenCalled();
    expect(disclosure.querySelector("[data-dani-notice-text]")?.textContent).toBe(notice);
    expect([...disclosure.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "https://example.test/legal?model=one&trial=true", "https://example.test/privacy",
    ]);
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    Object.defineProperties(tab, { target: { value: summary }, currentTarget: { value: host } });
    modelMenuKey(tab as unknown as ReactKeyboardEvent<HTMLElement>, { query: "", typed, close });
    expect(close).not.toHaveBeenCalled();
    await act(async () => pick.click());
    expect(onPick).toHaveBeenCalledOnce();
  });

  it("leaves privacy details accessible without enabling a policy-blocked model", async () => {
    await show(true);
    const pick = [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((button) => button.textContent?.includes("Tools supported"))!;
    expect(pick.disabled).toBe(true);
    expect(host.querySelector("details[data-dani-model-notice] summary")).not.toBeNull();
    await act(async () => pick.click());
    expect(onPick).not.toHaveBeenCalled();
  });

  it("treats catalog Markdown as untrusted and never creates executable HTML, unsafe links, or remote images", async () => {
    await show(false, "Mandatory terms. <script>window.catalogInjected = true</script> [unsafe](javascript:alert%281%29) [local](file:///private/secret) ![tracking](https://example.test/pixel) [Legal terms](https://example.test/terms).");
    const summary = host.querySelector<HTMLElement>("details[data-dani-model-notice] summary")!;
    await act(async () => summary.click());
    expect(host.querySelector("script, img, iframe")).toBeNull();
    expect([...host.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["https://example.test/terms"]);
    expect(host.textContent).toContain("Mandatory terms.");
    expect(host.textContent).toContain("unsafe");
    expect(onPick).not.toHaveBeenCalled();
  });
});
