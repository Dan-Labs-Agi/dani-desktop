import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { removeTempDir } from "../../testing/cleanup.ts";
import { discoverHermesConfiguredApiModels, readHermesConfiguredApiRoutes } from "./hermes-configured-providers.ts";

const homes: string[] = [];
afterEach(async () => { for (const home of homes.splice(0)) await removeTempDir(home); });
const fixture = () => {
  const home = mkdtempSync(join(tmpdir(), "hermes-proxy-registry-"));
  homes.push(home);
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  return home;
};

describe("configured root API proxy registry", () => {
  it("discovers every configured exact proxy model without launching its old agent or exposing credentials", async () => {
    const home = fixture();
    writeFileSync(join(home, ".pi", "agent", "models.json"), JSON.stringify({ providers: {
      configured: { name: "Configured Proxy", api: "openai-completions", baseUrl: "http://127.0.0.1:18900/v1", apiKey: "PROXY_TOKEN", models: [{ id: "proxy-only-model", input: ["text", "image"] }] },
    } }));
    const routes = readHermesConfiguredApiRoutes({ HOME: home, PROXY_TOKEN: "synthetic-proxy-token" }, { instances: {} });
    expect(routes).toHaveLength(1);
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-proxy-token");
      return Response.json({ data: [{ id: "proxy-only-model", supported_parameters: ["tools"], modalities: { input: ["text", "image"] } }, { id: "second-live-model", tool_call: true }] });
    });
    const options = await discoverHermesConfiguredApiModels(routes, fetcher);
    expect(options.map(option => option.id)).toEqual([`custom:${routes[0]!.name}:proxy-only-model`, `custom:${routes[0]!.name}:second-live-model`]);
    expect(options.every(option => option.provider === "Configured Proxy" && option.availability === "available" && option.tools === true)).toBe(true);
    expect(JSON.stringify(options)).not.toContain("synthetic-proxy-token");
    expect(JSON.stringify(options)).not.toContain("18900");
  });

  it("does not fabricate a bearer token for configured anonymous local APIs or infer tools from listing", async () => {
    const home = fixture();
    writeFileSync(join(home, ".pi", "agent", "models.json"), JSON.stringify({ providers: {
      local: { baseUrl: "http://127.0.0.1:18901/v1", models: [{ id: "text-only" }] },
    } }));
    const routes = readHermesConfiguredApiRoutes({ HOME: home }, { instances: {} });
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return Response.json({ data: [{ id: "text-only" }] });
    });
    const options = await discoverHermesConfiguredApiModels(routes, fetcher);
    expect(options[0]).toMatchObject({ availability: "unavailable", unavailableReason: expect.stringMatching(/tool-call support/) });
  });

  it.each([4187, 4190])("keeps known nontransparent proxy %s unavailable without probing inference or inventing readiness", async port => {
    const home = fixture();
    writeFileSync(join(home, ".pi", "agent", "models.json"), JSON.stringify({ providers: {
      unsafe: { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "configured-local-key", models: [{ id: "declared", tools: true }] },
    } }));
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ id: "discovered", tool_call: true }] }));
    const options = await discoverHermesConfiguredApiModels(readHermesConfiguredApiRoutes({ HOME: home }, { instances: {} }), fetcher);
    expect(fetcher).toHaveBeenCalledWith(`http://127.0.0.1:${port}/v1/models`, expect.objectContaining({ method: "GET" }));
    expect(options.some(option => option.id.endsWith(":discovered"))).toBe(true);
    expect(options.every(option => option.availability === "unavailable")).toBe(true);
  });

  it("does not contact disabled or non-allowlisted OpenCode providers", () => {
    const home = fixture();
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    writeFileSync(join(home, ".config", "opencode", "opencode.json"), JSON.stringify({
      disabled_providers: ["disabled"], enabled_providers: ["allowed", "disabled"],
      provider: Object.fromEntries(["allowed", "disabled", "outside"].map(id => [id, {
        npm: "@ai-sdk/openai-compatible", options: { baseURL: `http://127.0.0.1:18910/${id}/v1`, apiKey: "fixture-key" },
        models: { model: { tools: true } },
      }])),
    }));
    const routes = readHermesConfiguredApiRoutes({ HOME: home }, { instances: {} });
    expect(routes.map(route => route.label)).toEqual(["allowed"]);
    expect(routes[0]?.baseUrl).toBe("http://127.0.0.1:18910/allowed/v1");
  });

  it("keeps a Pi per-model endpoint and protocol override off the provider's base route", async () => {
    const home = fixture();
    writeFileSync(join(home, ".pi", "agent", "models.json"), JSON.stringify({ providers: {
      scoped: { baseUrl: "http://127.0.0.1:18911/v1", apiKey: "$PROXY_TOKEN", authHeader: false, models: [
        { id: "base", tools: true },
        { id: "overridden", api: "openai-responses", baseUrl: "http://127.0.0.1:18912/v1", tools: true },
      ] },
    } }));
    const routes = readHermesConfiguredApiRoutes({ HOME: home, PROXY_TOKEN: "fixture-resolved-key" }, { instances: {} });
    expect(routes.map(route => [route.baseUrl, route.apiMode, route.apiKey])).toEqual([
      ["http://127.0.0.1:18911/v1", "chat_completions", "fixture-resolved-key"],
      ["http://127.0.0.1:18912/v1", "codex_responses", "fixture-resolved-key"],
    ]);
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [
      { id: "base", tool_call: true }, { id: "overridden", tool_call: true }, { id: "extra", tool_call: true },
    ] }));
    const options = await discoverHermesConfiguredApiModels(routes, fetcher);
    expect(options.some(option => option.id === `custom:${routes[0]!.name}:overridden`)).toBe(false);
    expect(options.filter(option => option.id.startsWith(`custom:${routes[1]!.name}:`)).map(option => option.id))
      .toEqual([`custom:${routes[1]!.name}:overridden`]);
  });

  it("refuses conflicting same-endpoint credentials before any catalog request", async () => {
    const home = fixture();
    writeFileSync(join(home, ".pi", "agent", "models.json"), JSON.stringify({ providers: {
      a: { baseUrl: "http://127.0.0.1:18913/v1", headers: { Authorization: "Bearer fixture-a" }, models: [{ id: "one", tools: true }] },
      b: { baseUrl: "http://127.0.0.1:18913/v1", headers: { Authorization: "Bearer fixture-b" }, models: [{ id: "two", tools: true }] },
    } }));
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("Conflicting credentials must not leave this fixture"); });
    const options = await discoverHermesConfiguredApiModels(readHermesConfiguredApiRoutes({ HOME: home }, { instances: {} }), fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(options.map(option => [option.label, option.availability])).toEqual([["one", "unavailable"], ["two", "unavailable"]]);
    expect(JSON.stringify(options)).not.toMatch(/fixture-a|fixture-b/);
  });

  it("does not widen a fixed workspace model assignment using public catalog rows", async () => {
    const home = fixture();
    const routes = readHermesConfiguredApiRoutes({ HOME: home }, { instances: {
      assigned: { driver: "openai-compat", displayName: "Assigned", enabled: true,
        config: { url: "http://127.0.0.1:18914/v1", managedModels: ["permitted"] } },
    } });
    const options = await discoverHermesConfiguredApiModels(routes, async () => Response.json({ data: [
      { id: "permitted", tool_call: true }, { id: "not-assigned", tool_call: true },
    ] }));
    expect(options.map(option => option.label)).toEqual(["permitted"]);
    expect(options[0]?.availability).toBe("available");
  });
  it.each([
    ["http://127.0.0.1:18915/v1", "$MISSING_KEY"],
    ["https://provider.example/v1", "${MISSING_KEY}"],
    ["http://127.0.0.1:18915/v1", "!credential-command"],
    ["http://127.0.0.1:18915/v1", "{file:private-key}"],
  ])("keeps unresolved credential declarations unavailable instead of anonymous: %s %s", async (baseUrl, apiKey) => {
    const home = fixture();
    writeFileSync(join(home, ".pi", "agent", "models.json"), JSON.stringify({ providers: {
      missing: { baseUrl, apiKey, models: [{ id: "declared", tools: true }] },
    } }));
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ id: "declared", tool_call: true }] }));
    const options = await discoverHermesConfiguredApiModels(readHermesConfiguredApiRoutes({ HOME: home }, { instances: {} }), fetcher);
    expect(options).toEqual([expect.objectContaining({ label: "declared", availability: "unavailable" })]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not use Claude subscription credentials as a third-party native API key", async () => {
    const home = fixture();
    writeFileSync(join(home, ".pi", "agent", "models.json"), JSON.stringify({ providers: {
      claude: { baseUrl: "https://api.anthropic.com", api: "anthropic-messages", apiKey: "sk-ant-oat01-fixture", models: [{ id: "claude-test", tools: true }] },
    } }));
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ id: "claude-test", tool_call: true }] }));
    const options = await discoverHermesConfiguredApiModels(readHermesConfiguredApiRoutes({ HOME: home }, { instances: {} }), fetcher);
    expect(options).toEqual([expect.objectContaining({ label: "claude-test", availability: "unavailable" })]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(options)).not.toContain("sk-ant-oat01-fixture");
  });

  it("never marks an advertised model with an unrouteable native identifier available", async () => {
    const home = fixture();
    writeFileSync(join(home, ".pi", "agent", "models.json"), JSON.stringify({ providers: {
      local: { baseUrl: "http://127.0.0.1:18916/v1", models: [] },
    } }));
    const options = await discoverHermesConfiguredApiModels(readHermesConfiguredApiRoutes({ HOME: home }, { instances: {} }),
      async () => Response.json({ data: [{ id: "model with spaces", tool_call: true }, { id: "valid-model", tool_call: true }] }));
    expect(options.find(option => option.label === "model with spaces")?.availability).toBe("unavailable");
    expect(options.find(option => option.label === "valid-model")?.availability).toBe("available");
  });
  it("rotates its own materialized header credential while refusing a distinct conflicting identity", () => {
    const home = fixture();
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const registry = join(home, ".pi", "agent", "models.json");
    const env = { HOME: home, HERMES_HOME: join(home, ".hermes") };
    const save = (token: string) => writeFileSync(registry, JSON.stringify({ providers: {
      owned: { baseUrl: "http://127.0.0.1:18917/v1", headers: { Authorization: `Bearer ${token}` }, models: [{ id: "one", tools: true }] },
    } }));
    save("old-fixture-key");
    const previous = readHermesConfiguredApiRoutes(env, { instances: {} }).find(route => route.label === "owned")!;
    writeFileSync(join(home, ".hermes", "config.yaml"), JSON.stringify({ providers: {
      [previous.name]: { base_url: previous.baseUrl, extra_headers: previous.headers },
    } }));
    save("new-fixture-key");
    const rotated = readHermesConfiguredApiRoutes(env, { instances: {} }).find(route => route.label === "owned");
    expect(rotated?.unavailableReason).toBeUndefined();
    expect(rotated?.headers.Authorization).toBe("Bearer new-fixture-key");
    writeFileSync(join(home, ".hermes", "config.yaml"), JSON.stringify({ providers: {
      another: { base_url: previous.baseUrl, extra_headers: previous.headers },
    } }));
    expect(readHermesConfiguredApiRoutes(env, { instances: {} }).find(route => route.label === "owned")?.discoveryBlocked).toBe(true);
  });
  it("blocks conflicting credentials on native-equivalent endpoint spellings before discovery", async () => {
    const home = fixture();
    const nativeHome = join(home, ".hermes");
    mkdirSync(nativeHome);
    writeFileSync(join(nativeHome, "config.yaml"), JSON.stringify({ providers: {
      foreign: { base_url: "https://API.EXAMPLE.COM:443/v1", extra_headers: { Authorization: "Bearer foreign-fixture" } },
    } }));
    writeFileSync(join(home, ".pi", "agent", "models.json"), JSON.stringify({ providers: {
      selected: { baseUrl: "https://api.example.com/v1", headers: { Authorization: "Bearer selected-fixture" }, models: [{ id: "one", tools: true }] },
    } }));
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("Ambiguous credentials must stay local"); });
    const options = await discoverHermesConfiguredApiModels(readHermesConfiguredApiRoutes({ HOME: home, HERMES_HOME: nativeHome }, { instances: {} }), fetcher);
    expect(options).toEqual([expect.objectContaining({ label: "one", availability: "unavailable" })]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("discovers every paginated Claude API model through the configured route", async () => {
    const home = fixture();
    const routes = readHermesConfiguredApiRoutes({ HOME: home }, {
      instances: {}, anthropic: { key: "sk-ant-api03-fixture" },
    });
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      if (!headers.has("x-api-key")) return Response.json({ error: "unauthorized" }, { status: 401 });
      expect(headers.get("x-api-key")).toBe("sk-ant-api03-fixture");
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      return Response.json(url.searchParams.get("after_id") === "claude-first"
        ? { data: [{ id: "claude-second" }], has_more: false, last_id: "claude-second" }
        : { data: [{ id: "claude-first" }], has_more: true, last_id: "claude-first" });
    });
    const options = await discoverHermesConfiguredApiModels(routes, fetcher);
    expect(options.map(option => option.id)).toEqual([
      `custom:${routes[0]!.name}:claude-first`, `custom:${routes[0]!.name}:claude-second`,
    ]);
    expect(options.every(option => option.provider === "Claude" && option.availability === "available" && option.tools === true)).toBe(true);
    expect(fetcher.mock.calls.every(([, init]) => !init?.body)).toBe(true);
  });

  it("does not advertise header-authenticated Anthropic routes that native execution cannot preserve", async () => {
    const home = fixture();
    writeFileSync(join(home, ".pi", "agent", "models.json"), JSON.stringify({ providers: {
      gateway: { api: "anthropic-messages", baseUrl: "https://gateway.fixture.test", headers: { Authorization: "Bearer gateway-fixture" },
        models: [{ id: "claude-test", tools: true }] },
    } }));
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ id: "claude-test", tool_call: true }] }));
    const options = await discoverHermesConfiguredApiModels(readHermesConfiguredApiRoutes({ HOME: home }, { instances: {} }), fetcher);
    expect(options).toEqual([expect.objectContaining({ label: "claude-test", availability: "unavailable" })]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
