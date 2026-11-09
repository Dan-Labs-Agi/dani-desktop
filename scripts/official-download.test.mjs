import { afterEach, expect, it, vi } from "vitest";
import { downloadBytes } from "./official-download.mjs";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup() {
  vi.useFakeTimers(); vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); return fetch;
}
it("retries a timed-out official request and an interrupted body, then returns complete bytes", async () => {
  const fetch = setup();
  fetch.mockRejectedValueOnce(new TypeError("fetch failed"))
    .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => { throw new TypeError("terminated"); } })
    .mockResolvedValueOnce(new Response("complete"));
  const result = downloadBytes("https://dl.google.com/android/repository/platform-tools-latest-darwin.zip");
  await vi.runAllTimersAsync(); expect(await result).toEqual(Buffer.from("complete")); expect(fetch).toHaveBeenCalledTimes(3);
});
it("fails after three Google failures with no alternate source", async () => {
  const fetch = setup(); fetch.mockImplementation(async () => new Response("timeout", { status: 504 }));
  const result = expect(downloadBytes("https://dl.google.com/file")).rejects.toThrow(/HTTP 504/);
  await vi.runAllTimersAsync(); await result; expect(fetch).toHaveBeenCalledTimes(3);
});
it("never retries or falls back for a nontransient refusal", async () => {
  const fetch = setup(); fetch.mockResolvedValueOnce(new Response("missing", { status: 404 }));
  await expect(downloadBytes("https://github.com/trycua/cua/file", { githubRelease: {} })).rejects.toThrow(/HTTP 404/);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each(["valid", "wrong-tag", "missing", "ambiguous", "unsafe-id"])("validates the official CUA asset identity: %s", async scenario => {
  const fetch = setup();
  for (let i = 0; i < 3; i++) fetch.mockResolvedValueOnce(new Response("timeout", { status: 504 }));
  const item = { name: "pinned.zip", id: scenario === "unsafe-id" ? "https://evil.invalid" : 123, url: "https://evil.invalid" };
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ tag_name: scenario === "wrong-tag" ? "other" : "v1", assets: scenario === "missing" ? [] : scenario === "ambiguous" ? [item, item] : [item] })));
  fetch.mockResolvedValueOnce(new Response("canonical"));
  const result = downloadBytes("https://github.com/trycua/cua/file", { githubRelease: { owner: "trycua", repo: "cua", tag: "v1", asset: "pinned.zip" } });
  const check = scenario === "valid" ? expect(result).resolves.toEqual(Buffer.from("canonical")) : expect(result).rejects.toThrow(/mismatch|missing or ambiguous/);
  await vi.runAllTimersAsync(); await check; expect(fetch).toHaveBeenCalledTimes(scenario === "valid" ? 5 : 4);
  if (scenario === "valid") expect(fetch.mock.calls[4][0]).toBe("https://api.github.com/repos/trycua/cua/releases/assets/123");
});
