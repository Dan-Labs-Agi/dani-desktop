import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activateDaniFree, daniFreeActivated, DaniFreeCatalog, DANI_FREE_REFRESH_MS, parseDaniFreeCatalog } from "./dani-free-catalog.ts";

const roots: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const kilo = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  pricing: { prompt: "0", completion: "0" }, isFree: true, supported_parameters: [], ...extra,
});
const opencode = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, type: "chat", modalities: { input: ["text"], output: ["text"] },
  cost: { text: { input: { price: 0, cache: { read: 0, write: 0 } }, output: { price: 0 } } }, ...extra,
});

describe("Dani free catalog admission", () => {
  it("admits every explicit-zero chat row, including routers and text-only models, with exact capabilities and privacy", () => {
    const parsed = parseDaniFreeCatalog("kilo", { data: [
      kilo("text-only", { mayTrainOnYourPrompts: true, description: "Prompts retained" }),
      kilo("vision", { architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }, supported_parameters: ["tools"] }),
      kilo("kilo-auto/free", { autoRouting: { models: ["text-only"] } }),
    ] });
    expect(parsed.options.map(({ id, tools, imageInput }) => ({ id, tools, imageInput }))).toEqual([
      { id: "text-only", tools: false, imageInput: false }, { id: "vision", tools: true, imageInput: true },
      { id: "kilo-auto/free", tools: false, imageInput: false },
    ]);
    expect(parsed.options[0]).toMatchObject({ mayTrainOnYourPrompts: true, privacyNotice: "Prompts retained" });
    expect(parseDaniFreeCatalog("opencode", { data: [opencode("plain"), opencode("vision", {
      modalities: { input: ["text", "image/png"], output: ["text"] }, capabilities: { tools: { supported: true } },
    })] }).options.map(({ id, tools, imageInput }) => ({ id, tools, imageInput }))).toEqual([
      { id: "opencode/plain", tools: false, imageInput: false }, { id: "opencode/vision", tools: true, imageInput: true },
    ]);
  });

  it("keeps free routers visible but chooses a concrete free model as the initial default", () => {
    const router = kilo("router", { autoRouting: { models: ["concrete"] } });
    const concrete = kilo("concrete", { supported_parameters: ["tools"] });
    const catalog = parseDaniFreeCatalog("kilo", { data: [router, concrete] });
    expect(catalog.default).toBe("concrete");
    expect(catalog.options.map((model) => model.id)).toEqual(["router", "concrete"]);
    expect(parseDaniFreeCatalog("kilo", { data: [router] }).default).toBe("router");
  });

  it("refuses unknown, paid, negative, expired and non-chat prices in both authoritative schemas", () => {
    const bad = [
      kilo("missing", { pricing: { prompt: "0" } }), kilo("paid-free", { pricing: { prompt: "0", completion: "1" } }),
      kilo("negative", { pricing: { prompt: "-1", completion: "0" } }), kilo("extra-charge", { pricing: { prompt: 0, completion: 0, image: 1 } }),
      kilo("blank", { pricing: { prompt: "", completion: "0" } }), kilo("false", { isFree: false }),
      kilo("expired", { expiration_date: "2020-01-01" }), kilo("embedding", { type: "embedding" }),
      kilo("image-only", { architecture: { input_modalities: ["text"], output_modalities: ["image"] } }),
    ];
    expect(parseDaniFreeCatalog("kilo", { data: bad }).options).toEqual([]);
    expect(parseDaniFreeCatalog("opencode", { data: [
      opencode("missing", { cost: { text: { input: { price: 0 } } } }),
      opencode("negative", { cost: { text: { input: { price: -1 }, output: { price: 0 } } } }),
      opencode("cache-paid", { cost: { text: { input: { price: 0, cache: { read: 1 } }, output: { price: 0 } } } }),
      opencode("structured-free", { type: "structured" }), opencode("expired", { expiresAt: "2020-01-01" }),
    ] }).options).toEqual([]);
    expect(() => parseDaniFreeCatalog("kilo", {})).toThrow("malformed");
  });
});

it("persists explicit activation without using provider credentials", () => {
  const root = mkdtempSync(join(tmpdir(), "dani-free-consent-")); roots.push(root);
  expect(daniFreeActivated(root)).toBe(false);
  activateDaniFree(root);
  expect(daniFreeActivated(root)).toBe(true);
  expect(JSON.parse(readFileSync(join(root, "activation.json"), "utf8"))).toEqual({ consented: true });
});

it("keeps successful freshness on errors, refuses stale authorization, removes successful-empty eligibility and reloads per-instance cache", async () => {
  const root = mkdtempSync(join(tmpdir(), "dani-free-catalog-")); roots.push(root);
  let now = 1000;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [kilo("exact")] }));
  const first = new DaniFreeCatalog("kilo", "one", { root, now: () => now, fetch: fetcher });
  await first.startup;
  expect(first.models.options.map((model) => model.id)).toEqual(["exact"]);
  expect(first.successfulAt).toBe(1000);
  await first.dispose();
  const cachedFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
  const cached = new DaniFreeCatalog("kilo", "one", { root, now: () => now, fetch: cachedFetch });
  await cached.startup;
  expect(cachedFetch).not.toHaveBeenCalled();
  now += DANI_FREE_REFRESH_MS;
  await expect(cached.requireModel("exact")).rejects.toThrow("offline");
  expect(cached.successfulAt).toBe(1000);
  expect(cached.models.options[0]).toMatchObject({ id: "exact", availability: "unavailable" });
  await cached.dispose();
  const emptyFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] }));
  const empty = new DaniFreeCatalog("kilo", "one", { root, now: () => now, fetch: emptyFetch });
  await empty.startup;
  expect(emptyFetch).toHaveBeenCalledOnce();
  expect(empty.models).toEqual({ default: "", options: [] });
  expect(empty.successfulAt).toBe(now);
  await expect(empty.requireModel("exact")).rejects.toThrow("not currently eligible");
  await empty.dispose();
});

it("refreshes daily without inference probes and stops scheduling after disposal", async () => {
  vi.useFakeTimers();
  const root = mkdtempSync(join(tmpdir(), "dani-free-daily-")); roots.push(root);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [] }));
  const catalog = new DaniFreeCatalog("kilo", "daily", { root, fetch: fetcher });
  await catalog.startup;
  await vi.advanceTimersByTimeAsync(DANI_FREE_REFRESH_MS);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([url]) => String(url).endsWith("/models"))).toBe(true);
  await catalog.dispose();
  await vi.advanceTimersByTimeAsync(DANI_FREE_REFRESH_MS);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
