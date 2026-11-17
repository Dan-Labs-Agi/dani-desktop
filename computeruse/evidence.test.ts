import { describe, expect, it, vi } from "vitest";
import { emptyCounters } from "./counters.ts";
import { COMPUTER_EVIDENCE_PATH, createEvidenceReporter, evidenceUrl, parseEvidence, postEvidence } from "./evidence.ts";

describe("parsing evidence a bridge posted", () => {
  const good = { actions: 3, changed: 2, unchanged: 1, unobserved: 0, refusals: { stale: 1 }, readBacks: 6, addedMs: 420 };

  it("accepts the counters the bridge keeps", () => {
    expect(parseEvidence(good)).toEqual(good);
    expect(parseEvidence(emptyCounters())).toEqual(emptyCounters());
  });

  it("refuses anything that is not plain counters, rather than guessing", () => {
    for (const bad of [null, undefined, "3 actions", [], 7, { ...good, actions: -1 }, { ...good, changed: 1.5 }, { ...good, addedMs: "9" },
      { ...good, refusals: [] }, { ...good, refusals: "stale" }, { actions: 1 }]) {
      expect(parseEvidence(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("clamps a count that no real session reaches, and ignores fields it does not know", () => {
    const parsed = parseEvidence({ ...good, actions: 9e12, readBacks: 9e12, addedMs: 9e15, extra: "<script>" })!;
    expect(parsed.actions).toBe(1_000_000);
    expect(parsed.readBacks).toBe(1_000_000);
    expect(parsed.addedMs).toBe(86_400_000);
    expect(parsed).not.toHaveProperty("extra");
  });

  it("keeps a refusal only under a short plain name, and only a few of them", () => {
    const parsed = parseEvidence({ ...good, refusals: {
      stale: 2, "very-long-name-that-no-stage-has-ever-had": 1, "<b>x</b>": 1, "with space": 1, loop: 1, a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1,
    } })!;
    expect(Object.keys(parsed.refusals).every((name) => /^[a-z][a-z-]{0,23}$/.test(name))).toBe(true);
    expect(Object.keys(parsed.refusals).length).toBeLessThanOrEqual(8);
    expect(parsed.refusals.stale).toBe(2);
    expect(parsed.refusals).not.toHaveProperty("<b>x</b>");
  });
});

describe("where evidence is posted", () => {
  it("is a path on the server the gate already talks to", () => {
    expect(evidenceUrl("http://127.0.0.1:8799/api/internal/computer-control?botId=b1")).toBe(`http://127.0.0.1:8799${COMPUTER_EVIDENCE_PATH}`);
  });
});

describe("posting evidence", () => {
  it("sends the totals as JSON under the turn's bearer, and nothing else", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(null, { status: 200 }); }) as unknown as typeof fetch;
    const counters = emptyCounters();
    counters.actions = 2;
    await postEvidence("http://127.0.0.1:8799/api/internal/computer/evidence", "turn-token", fetchImpl)(counters);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.init.method).toBe("POST");
    expect(seen[0]!.init.headers).toMatchObject({ authorization: "Bearer turn-token", "content-type": "application/json" });
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual(counters);
  });
});

describe("the evidence reporter", () => {
  const counters = () => { const value = emptyCounters(); value.actions = 1; return value; };

  it("posts the totals soon after an action, once however many actions came in between", async () => {
    vi.useFakeTimers();
    try {
      const post = vi.fn(async () => {});
      const reporter = createEvidenceReporter({ post, counters, delayMs: 200 });
      reporter.note(); reporter.note(); reporter.note();
      expect(post).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(250);
      expect(post).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("posts what is pending right now when asked, and nothing when nothing changed", async () => {
    const post = vi.fn(async () => {});
    const reporter = createEvidenceReporter({ post, counters, delayMs: 10_000 });
    await reporter.flush();
    expect(post).not.toHaveBeenCalled();
    reporter.note();
    await reporter.flush();
    await reporter.flush();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("never throws or hangs on a server that is gone or slow", async () => {
    const reporter = createEvidenceReporter({ post: () => Promise.reject(new Error("refused")), counters, delayMs: 5 });
    reporter.note();
    await expect(reporter.flush()).resolves.toBeUndefined();
    const slow = createEvidenceReporter({ post: () => new Promise(() => {}), counters, delayMs: 5, timeoutMs: 20 });
    slow.note();
    await expect(slow.flush()).resolves.toBeUndefined();
  });
});
