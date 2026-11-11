import { afterEach, expect, it, vi } from "vitest";
import { createOpenAIChatRuntime } from "./openai-chat.ts";

afterEach(() => vi.unstubAllGlobals());

it("keeps anonymous model requests keyless and explicit, with no text-emulated tools", async () => {
  const requests: RequestInit[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    requests.push(init);
    return Response.json({ choices: [{ message: { content: "answer" }, finish_reason: "stop" }] });
  }));
  const instance = createOpenAIChatRuntime({
    input: { instanceId: "anonymous-test", displayName: "Dani", enabled: true, config: {}, environment: { KILO_API_KEY: "do-not-send" } },
    driverKind: "daniFree", apiKey: "", anonymous: true, apiUrl: "https://ai-gateway.kilo.ai/api/v1",
    models: () => ({ default: "first", options: [{ id: "first", label: "First" }, { id: "explicit", label: "Explicit" }] }),
    requestBody: (model, messages, stream) => ({ model, messages, stream }),
    httpErrorLabel: "Dani", missingKeyError: "missing", unavailableReason: "missing", timeoutMs: 1000,
    nativeLog: { source: "test", outgoing: () => ({}), incoming: () => ({}) },
  });
  try {
    await expect(instance.snapshot()).resolves.toMatchObject({ state: "available", authenticated: true });
    await expect(instance.generateText!("hello", { model: "explicit" })).resolves.toBe("answer");
    expect(new Headers(requests[0]!.headers).has("authorization")).toBe(false);
    expect(requests[0]!.body).not.toContain("do-not-send");
    expect(JSON.parse(requests[0]!.body as string)).toMatchObject({ model: "explicit" });
  } finally {
    await instance.dispose();
  }
});
