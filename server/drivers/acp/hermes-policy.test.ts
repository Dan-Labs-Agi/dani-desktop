import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { removeTempDir } from "../../testing/cleanup.ts";

const python = process.env.DANI_HERMES_POLICY_PYTHON || join(homedir(), ".hermes/hermes-agent/venv/bin/python3");
const probe = fileURLToPath(new URL("../../testing/hermes-native-policy-probe.py", import.meta.url));
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await removeTempDir(dir); });

it.skipIf(!existsSync(python))("enforces browser-only native constructor inventory and dispatch in qualified Hermes", () => {
  const home = mkdtempSync(join(tmpdir(), "dani-hermes-policy-")); dirs.push(home);
  writeFileSync(join(home, "config.yaml"), "model:\n  default: test-model\n  provider: custom:test\nproviders:\n  test:\n    base_url: http://127.0.0.1:9/v1\n    api_key: fixture-not-a-secret\ntools:\n  tool_search:\n    enabled: off\n");
  const out = execFileSync(python, [probe], {
    env: { ...process.env, HERMES_HOME: home, HERMES_ACP_SKIP_CONFIGURED_MCP: "1", PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8", timeout: 45_000,
  });
  const result = JSON.parse(out.trim().split("\n").at(-1)!);
  expect(result.version).toBe("0.21.3");
  expect(result.policy).toBe("browser-only");
  expect(result.nativeTools).toEqual([]);
  expect(result.tools).toContain("mcp__browser__dani_policy_probe");
  expect(result.dispatchRejected).toBe(true);
  expect(result.probeReceipt).toBe("dani-policy-probe");
  expect(result.sessionPreserved).toBe(true);
  expect(result.cwdPreserved).toBe(true);
  expect(result.provider).toBe("custom");
  expect(result.model).toBe("test-model");
  expect(result.baseUrl).toBe("http://127.0.0.1:9/v1");
}, 50_000);

it.skipIf(!existsSync(python))("rejects ignored tools and validates private native provider qualification contracts offline", () => {
  const regression = fileURLToPath(new URL("../../testing/hermes-provider-qualification-test.py", import.meta.url));
  execFileSync(python, [regression], {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 45_000,
  });
}, 50_000);

it.skipIf(!existsSync(python))("constructs a real native qualification agent without private context or external tools", () => {
  const home = mkdtempSync(join(tmpdir(), "dani-hermes-qualified-constructor-")); dirs.push(home);
  writeFileSync(join(home, "config.yaml"), "model:\n  default: test-model\n  provider: custom:test\nproviders:\n  test:\n    base_url: http://127.0.0.1:9/v1\n    api_key: fixture-not-a-secret\ntools:\n  tool_search:\n    enabled: off\n");
  writeFileSync(join(home, "MEMORY.md"), "private-memory-fixture");
  writeFileSync(join(home, "SOUL.md"), "private-soul-fixture");
  const result = JSON.parse(execFileSync(python, [probe, "--qualification-constructor"], {
    env: { ...process.env, HERMES_HOME: home, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 45_000,
  }).trim().split("\n").at(-1)!);
  expect(result).toMatchObject({ tools: ["dani_provider_receipt"], contextSkipped: true,
    privateMemoryLoaded: false, soulLoaded: false, backgroundReviewSkipped: true,
    fallbackConfigured: false, sessionDbPresent: false, configuredMcpFiltered: true,
    model: "test-model", apiMode: "chat_completions", provider: "custom",
    wireTools: ["dani_provider_receipt"], privateContextInRequest: false });
}, 50_000);

it.skipIf(!existsSync(python)).each([true, false])("restores Codex conversations on Responses without retargeting custom endpoints (browser-only: %s)", (browserOnly) => {
  const home = mkdtempSync(join(tmpdir(), "dani-hermes-restored-protocol-")); dirs.push(home);
  writeFileSync(join(home, "config.yaml"), "model:\n  default: test-model\n  provider: custom:test\nproviders:\n  test:\n    base_url: http://127.0.0.1:9/v1\n    api_key: fixture-not-a-secret\ntools:\n  tool_search:\n    enabled: off\n");
  const result = JSON.parse(execFileSync(python, [probe, "--restored-protocol", ...(browserOnly ? [] : ["--unscoped"])], {
    env: { ...process.env, HERMES_HOME: home, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 45_000,
  }).trim().split("\n").at(-1)!);
  expect(result).toEqual([
    { provider: "openai-codex", apiMode: "codex_responses", baseUrl: "https://chatgpt.com/backend-api/codex", responsesInput: true, chatMessages: false },
    { provider: "custom", apiMode: "chat_completions", baseUrl: "http://127.0.0.1:9/v1", responsesInput: false, chatMessages: true },
    { provider: "custom", apiMode: "chat_completions", baseUrl: "https://chatgpt.com.attacker.test/backend-api/codex", responsesInput: false, chatMessages: true },
  ]);
}, 50_000);

it.skipIf(!existsSync(python))("constructs a selected proxy before an unavailable saved default and preserves resumed history", () => {
  const home = mkdtempSync(join(tmpdir(), "dani-hermes-initial-route-")); dirs.push(home);
  writeFileSync(join(home, "config.yaml"), "model:\n  default: unavailable-model\n  provider: custom:missing\nproviders:\n  selected:\n    base_url: http://127.0.0.1:9/v1\n    api_key: fixture-selected-key\n  other:\n    base_url: http://127.0.0.1:10/v1\n    api_key: fixture-other-key\ntools:\n  tool_search:\n    enabled: off\n");
  const result = JSON.parse(execFileSync(python, [probe, "--initial-route"], {
    env: { ...process.env, HERMES_HOME: home, DANI_HERMES_INITIAL_MODEL: "custom:selected:test-model", PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8", timeout: 45_000,
  }).trim().split("\n").at(-1)!);
  expect(result).toMatchObject({
    initial: { model: "test-model", provider: "custom", endpoint: "http://127.0.0.1:9/v1" },
    switch: { model: "other-model", endpoint: "http://127.0.0.1:10/v1" },
    restoredModel: "test-model", restoredHistory: [{ role: "user", content: "Synthetic retained conversation" }],
    configUnchanged: true,
  });
}, 50_000);

it.skipIf(!existsSync(python))("refuses an unavailable selected provider instead of constructing the saved default", () => {
  const home = mkdtempSync(join(tmpdir(), "dani-hermes-no-route-fallback-")); dirs.push(home);
  writeFileSync(join(home, "config.yaml"), "model:\n  default: test-model\n  provider: custom:selected\nproviders:\n  selected:\n    base_url: http://127.0.0.1:9/v1\n    api_key: fixture-selected-key\n  other:\n    base_url: http://127.0.0.1:10/v1\n    api_key: fixture-other-key\ntools:\n  tool_search:\n    enabled: off\n");
  const result = JSON.parse(execFileSync(python, [probe, "--initial-route"], {
    env: { ...process.env, HERMES_HOME: home, DANI_HERMES_INITIAL_MODEL: "custom:missing:test-model", PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8", timeout: 45_000,
  }).trim().split("\n").at(-1)!);
  expect(result).toEqual({ created: false, configUnchanged: true });
}, 50_000);

it.skipIf(!existsSync(python))("rejects a subscription credential actually resolved by the native constructor", () => {
  const home = mkdtempSync(join(tmpdir(), "dani-hermes-api-only-")); dirs.push(home);
  writeFileSync(join(home, "config.yaml"), "model:\n  default: test-model\n  provider: custom:test\nproviders:\n  test:\n    base_url: http://127.0.0.1:9/v1\n    api_key: fixture-key\n");
  const result = JSON.parse(execFileSync(python, [probe, "--subscription-credential"], {
    env: { ...process.env, HERMES_HOME: home, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8", timeout: 45_000,
  }).trim().split("\n").at(-1)!);
  expect(result).toEqual({ rejected: true });
}, 50_000);

it.skipIf(!existsSync(python))("discovers only the runtime-authorized endpoint and model credential pointer", () => {
  const home = mkdtempSync(join(tmpdir(), "dani-hermes-metadata-route-")); dirs.push(home);
  writeFileSync(join(home, "config.yaml"), "model:\n  provider: openai-api\n  default: gpt-test\n  base_url: https://api.openai.com/v1\n  key_env: FIXTURE_MODEL_KEY\n");
  writeFileSync(join(home, ".env"), "OPENAI_BASE_URL=https://stale-proxy.example/v1\nOPENAI_API_KEY=fixture-registry-key\nFIXTURE_MODEL_KEY=fixture-model-key\n");
  const result = JSON.parse(execFileSync(python, [probe, "--metadata-endpoint"], {
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, HERMES_HOME: home, HERMES_MANAGED_DIR: join(home, "managed"), PYTHONDONTWRITEBYTECODE: "1", HERMES_ACP_MODELS_TIMEOUT_MS: "10000" },
    encoding: "utf8", timeout: 45_000,
  }).trim().split("\n").at(-1)!);
  expect(result.requests).toEqual([{ host: "api.openai.com", selectedKey: true }]);
  expect(result.authenticatedModels).toContain("gpt-test");
  expect(result.credentialEnv).toContain("FIXTURE_MODEL_KEY");
}, 50_000);

it.skipIf(!existsSync(python))("preserves mounted coordination tools through native model rebinds without leaking them into another session", () => {
  const home = mkdtempSync(join(tmpdir(), "dani-hermes-session-tools-")); dirs.push(home);
  writeFileSync(join(home, "config.yaml"), "model:\n  default: test-model\n  provider: custom:test\nproviders:\n  test:\n    base_url: http://127.0.0.1:9/v1\n    api_key: fixture-key\n    models: [test-model, second-model]\ntools:\n  tool_search:\n    enabled: off\n");
  const result = JSON.parse(execFileSync(python, [probe, "--session-tool-retention"], {
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, HERMES_HOME: home,
      HERMES_MANAGED_DIR: join(home, "managed"), DANI_POLICY_NODE: process.execPath, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8", timeout: 60_000,
  }).trim().split("\n").at(-1)!);
  expect(result).toEqual({ before: true, afterRebind: true, afterSwitch: true,
    historyPreserved: true, unmountedSessionHasCoordination: false });
}, 65_000);

it.skipIf(!existsSync(python)).each(["off", "on"])("keeps full native coding agents out of the alternate browser across defaults rebuilds refresh and injected dispatch (tool search: %s)", (toolSearch) => {
  const home = mkdtempSync(join(tmpdir(), "dani-hermes-full-browser-authority-")); dirs.push(home);
  writeFileSync(join(home, "config.yaml"), `model:\n  default: test-model\n  provider: custom:test\nproviders:\n  test:\n    base_url: http://127.0.0.1:9/v1\n    api_key: fixture-key\n    models: [test-model, second-model]\ntools:\n  tool_search:\n    enabled: ${toolSearch}\n`);
  const bootstrap = fileURLToPath(new URL("./hermes-bootstrap.py", import.meta.url));
  const script = `
import contextlib, importlib.util, json, os, sys
from types import SimpleNamespace
with contextlib.redirect_stdout(sys.stderr):
    spec = importlib.util.spec_from_file_location("dani_bootstrap", sys.argv[1])
    bootstrap = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bootstrap)
    bootstrap.install_runtime_policy(browser_only=False)
    from acp_adapter.session import SessionManager
    from run_agent import AIAgent
    from tools.registry import registry
    from tools.mcp_tool_agent import refresh_agent_mcp_tools
    from toolsets import create_custom_toolset
    from model_tools import handle_function_call, get_tool_definitions
    manager = SessionManager()
    state = manager.create_session(cwd=os.environ["HERMES_HOME"])
    native_browser = set(registry.get_tool_names_for_toolset("browser"))
    assert "browser_navigate" in native_browser, "native browser registry was not discovered"
    def inventory(agent):
        names = {tool["function"]["name"] for tool in agent.tools}
        assert not names.intersection(native_browser), "full agent admitted native browser"
        assert not agent.valid_tool_names.intersection(native_browser), "dispatch inventory admitted native browser"
        assert {"terminal", "read_file", "patch"} <= names, "native coding tools were removed"
    def admitted(agent):
        return {tool["function"]["name"] for tool in get_tool_definitions(
            enabled_toolsets=agent.enabled_toolsets, disabled_toolsets=agent.disabled_toolsets,
            quiet_mode=True, skip_tool_search_assembly=True)}
    inventory(state.agent)
    direct = AIAgent(model="test-model", provider="custom", api_mode="chat_completions",
        base_url="http://127.0.0.1:9/v1", api_key="fixture-key", enabled_toolsets=None,
        disabled_toolsets=["vision"], skip_memory=True, skip_context_files=True,
        skip_background_review=True, session_db=None, quiet_mode=True)
    inventory(direct)
    assert "vision" in direct.disabled_toolsets, "caller disabled toolsets were discarded"
    name = "mcp__browser__dani_full_policy_receipt"
    registry.register(name=name, toolset="mcp-browser", schema={
        "name": name, "description": "Harmless managed-browser admission receipt",
        "parameters": {"type": "object", "properties": {}}},
        handler=lambda _args, **_kwargs: json.dumps({"receipt": "managed-browser"}))
    create_custom_toolset("mcp-browser", "Managed-browser admission receipt", tools=[name])
    registry.register_toolset_alias("browser", "mcp-browser")
    refresh_agent_mcp_tools(state.agent, enabled_override=[*state.agent.enabled_toolsets, "mcp-browser"],
                            quiet_mode=True, content_aware=True)
    inventory(state.agent)
    assert name in admitted(state.agent), "admitted Dani MCP was removed"
    rebuilt = manager._make_agent(session_id=state.session_id, cwd=state.cwd,
                                 model="second-model", requested_provider="custom:test")
    inventory(rebuilt)
    assert name in admitted(rebuilt), "model rebuild dropped Dani MCP"
    receipt = json.loads(handle_function_call(name, {}, enabled_tools=list(admitted(rebuilt)),
        enabled_toolsets=rebuilt.enabled_toolsets, disabled_toolsets=rebuilt.disabled_toolsets))
    assert receipt == {"receipt": "managed-browser"}, "admitted Dani MCP dispatch changed"
    with open(os.path.join(os.environ["HERMES_HOME"], "coding-receipt.txt"), "w") as fixture:
        fixture.write("native-coding-dispatch-receipt")
    messages = []
    rebuilt._execute_tool_calls(SimpleNamespace(tool_calls=[
        SimpleNamespace(function=SimpleNamespace(name="read_file", arguments=json.dumps({
            "path": os.path.join(os.environ["HERMES_HOME"], "coding-receipt.txt")})), id="coding-receipt")
    ]), messages, state.session_id)
    assert "native-coding-dispatch-receipt" in json.dumps(messages), "native coding dispatch was blocked"
    rejected = []
    def deny(agent, tool, arguments="{}"):
        try:
            agent._execute_tool_calls(SimpleNamespace(tool_calls=[
                SimpleNamespace(function=SimpleNamespace(name=tool, arguments=arguments), id="denied-browser")
            ]), [], state.session_id)
        except PermissionError:
            rejected.append(tool)
        else:
            raise AssertionError("native browser dispatch escaped policy: " + tool)
    deny(rebuilt, "browser_navigate")
    # Even a restored/injected catalog and disabled-toolset override cannot authorize it.
    rebuilt.disabled_toolsets = []
    from tools.mcp_tool_agent import restore_agent_tool_prefix
    restore_agent_tool_prefix(rebuilt, ["browser_navigate", "read_file"])
    inventory(rebuilt)
    deny(rebuilt, "browser_navigate")
    # Registry identity, not a browser_* text filter, defines the forbidden capability.
    injected = "dani_injected_alternate"
    registry.register(name=injected, toolset="browser", schema={
        "name": injected, "description": "Harmless dispatch denial sentinel",
        "parameters": {"type": "object", "properties": {}}},
        handler=lambda _args, **_kwargs: json.dumps({"unexpected": "dispatch"}))
    rebuilt.tools.append({"type": "function", "function": registry.get_schema(injected)})
    rebuilt.valid_tool_names.add(injected)
    deny(rebuilt, injected)
    rebuilt.tools = [tool for tool in rebuilt.tools if tool["function"]["name"] != injected]
    rebuilt.valid_tool_names.remove(injected)
    # Tool Search can invoke deferred registry tools without publishing their schemas.
    deny(rebuilt, "tool_call", json.dumps({"calls": [{"name": injected, "arguments": {}}]}))
print(json.dumps({"codingRetained": True, "mcpReceipt": receipt["receipt"],
                  "rejected": rejected, "defaultAndRebuiltInventory": True}))
`;
  const result = JSON.parse(execFileSync(python, ["-c", script, bootstrap], {
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, HERMES_HOME: home,
      HERMES_MANAGED_DIR: join(home, "managed"), HERMES_ACP_SKIP_CONFIGURED_MCP: "1", PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8", timeout: 60_000,
  }).trim().split("\n").at(-1)!);
  expect(result).toEqual({ codingRetained: true, mcpReceipt: "managed-browser",
    rejected: ["browser_navigate", "browser_navigate", "dani_injected_alternate", "tool_call"],
    defaultAndRebuiltInventory: true });
}, 65_000);
