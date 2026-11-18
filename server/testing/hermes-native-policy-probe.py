"""Installed-runtime constructor/dispatch probes for tests only; never makes model requests."""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("dani_hermes_bootstrap", Path(__file__).parents[1] / "drivers/acp/hermes-bootstrap.py")
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


def inspect_browser_policy():
    bootstrap.install_runtime_policy(browser_only=True)
    from hermes_cli.config import load_config
    config = load_config()
    if (config.get("model") or {}).get("default") != "test-model":
        raise RuntimeError("Policy inspection requires its disposable test-model native profile")
    from tools.registry import registry
    from toolsets import create_custom_toolset
    name = "mcp__browser__dani_policy_probe"
    registry.register(name=name, toolset="mcp-browser", schema={
        "name": name, "description": "Synthetic Dani policy regression probe",
        "parameters": {"type": "object", "properties": {}},
    }, handler=lambda _args, **_kwargs: json.dumps({"receipt": "dani-policy-probe"}))
    create_custom_toolset("mcp-browser", "Synthetic Dani policy regression probe", tools=[name])
    from acp_adapter.session import SessionManager
    state = SessionManager().create_session(cwd=os.environ["HERMES_HOME"])
    agent = state.agent
    rejected = False
    try:
        agent._execute_tool_calls(SimpleNamespace(tool_calls=[
            SimpleNamespace(function=SimpleNamespace(name="browser_navigate", arguments="{}"), id="denied-native")
        ]), [], state.session_id)
    except PermissionError:
        rejected = True
    from model_tools import handle_function_call
    receipt = json.loads(handle_function_call(name, {}, enabled_tools=list(agent.valid_tool_names),
                                             enabled_toolsets=agent.enabled_toolsets,
                                             disabled_toolsets=agent.disabled_toolsets))
    return {"version": bootstrap.qualified_version(), "policy": "browser-only", "tools": sorted(agent.valid_tool_names),
            "nativeTools": sorted(n for n in agent.valid_tool_names if not n.startswith("mcp__browser__")),
            "dispatchRejected": rejected, "probeReceipt": receipt.get("receipt"),
            "sessionPreserved": agent.session_id == state.session_id,
            "cwdPreserved": agent.session_cwd == state.cwd,
            "provider": agent.provider, "model": agent.model, "baseUrl": agent.base_url}


def inspect_qualification_constructor():
    config, runtime = bootstrap.selected_native_runtime()
    if (config.get("model") or {}).get("default") != "test-model":
        raise RuntimeError("Constructor inspection requires its disposable test-model native profile")
    challenge = bootstrap.ReceiptChallenge()
    agent = bootstrap.make_qualification_agent(config, runtime, challenge)
    request = agent._build_api_kwargs([
        {"role": "system", "content": "Call the qualification receipt tool once."},
        {"role": "user", "content": json.dumps({"nonce": challenge.nonce})},
    ], tools_for_api=[challenge.schema])
    serialized = json.dumps(request, default=str)
    from hermes_cli.mcp_startup import get_mcp_server_filter
    return {"tools": sorted(agent.valid_tool_names), "contextSkipped": agent.skip_context_files,
            "privateMemoryLoaded": agent._memory_store is not None or agent._memory_manager is not None,
            "soulLoaded": agent.load_soul_identity, "backgroundReviewSkipped": agent.skip_background_review,
            "fallbackConfigured": bool(agent._fallback_chain), "sessionDbPresent": agent._session_db is not None,
            "configuredMcpFiltered": bool(get_mcp_server_filter()), "model": agent.model,
            "apiMode": agent.api_mode, "provider": agent.provider,
            "wireTools": sorted(tool["function"]["name"] for tool in request.get("tools", [])),
            "privateContextInRequest": any(value in serialized for value in ["private-memory-fixture", "private-soul-fixture"])}


def inspect_subscription_credential():
    bootstrap.install_runtime_policy()
    from run_agent import AIAgent
    try:
        AIAgent(model="test-model", provider="anthropic", base_url="https://api.anthropic.com",
                api_mode="anthropic_messages", api_key="sk-ant-oat01-fixture", enabled_toolsets=[],
                skip_memory=True, skip_context_files=True, skip_background_review=True,
                session_db=None, quiet_mode=True)
    except PermissionError:
        return {"rejected": True}
    return {"rejected": False}


def inspect_metadata_endpoint():
    import httpx
    import runpy
    import io
    from urllib.parse import urlsplit
    import hermes_cli.models as native_models
    requests = []
    def response(url, headers):
        if urlsplit(str(url)).hostname in {"127.0.0.1", "localhost", "::1"}:
            raise ConnectionError("No default local provider fixture")
        headers = {name.lower(): value for name, value in headers.items()}
        if "authorization" in headers:
            requests.append({"host": urlsplit(str(url)).hostname, "selectedKey": headers["authorization"] == "Bearer fixture-model-key"})
            return 200, {"data": [{"id": "gpt-test"}]}
        return 401, {}
    def send(_client, request, **_kwargs):
        status, body = response(request.url, request.headers)
        return httpx.Response(status, json=body, request=request)
    def open_catalog(request, **_kwargs):
        status, body = response(request.full_url, dict(request.header_items()))
        if status != 200:
            raise RuntimeError("Fixture native catalog request was not authenticated")
        return contextlib.closing(io.BytesIO(json.dumps(body).encode()))
    # Native catalog requests use urllib; account/anonymous checks use httpx. Neither may escape.
    native_models._urlopen_model_catalog_request = open_catalog
    httpx.Client.send = send
    module = runpy.run_path(str(Path(__file__).parents[1] / "drivers/acp/hermes-model-metadata.py"))
    catalog = module["metadata"]()
    provider = next(item for item in catalog["providers"] if item["id"] == "openai-api")
    return {"requests": requests, "authenticatedModels": provider["authenticatedModels"], "credentialEnv": provider["credentialEnv"]}


async def inspect_session_tool_retention():
    bootstrap.install_runtime_policy()
    from acp.schema import McpServerStdio
    from acp_adapter.server import HermesACPAgent
    from acp_adapter.session import SessionManager
    from tools.mcp_tool_lifecycle import shutdown_mcp_servers
    home = Path(os.environ["HERMES_HOME"])
    manager = SessionManager()
    server = HermesACPAgent(manager)
    state = manager.create_session(cwd=str(home))
    retained_history = [{"role": "user", "content": "Synthetic unfinished coordination goal"}]
    state.history = retained_history.copy()
    mounted = McpServerStdio(name="agents", command=os.environ["DANI_POLICY_NODE"],
                            args=["--experimental-strip-types", str(Path(__file__).parents[1] / "drivers/agents-proxy.ts")],
                            env=[{"name": "OMB_CHIEF_OF_STAFF", "value": "1"},
                                 {"name": "OMB_AGENTS_TOOL_BRIDGE", "value": "0"},
                                 {"name": "OMB_BOT_ID", "value": "isolated-chief"}])
    tool = "mcp__agents__coordinate_bots"
    try:
        await server._register_session_mcp_servers(state, [mounted])
        before = tool in state.agent.valid_tool_names
        server._switch_model(state, "custom:test:test-model", keep_endpoint=True)
        rebound = tool in state.agent.valid_tool_names
        server._switch_model(state, "custom:test:second-model", keep_endpoint=True)
        switched = tool in state.agent.valid_tool_names
        unmounted = manager.create_session(cwd=str(home))
        return {"before": before, "afterRebind": rebound, "afterSwitch": switched,
                "historyPreserved": state.history == retained_history,
                "unmountedSessionHasCoordination": tool in unmounted.agent.valid_tool_names}
    finally:
        shutdown_mcp_servers()


def inspect_initial_route():
    home = Path(os.environ["HERMES_HOME"])
    saved_config = (home / "config.yaml").read_text()
    try:
        bootstrap.install_runtime_policy(browser_only=True)
        from acp_adapter.session import SessionManager
        manager = SessionManager()
        state = manager.create_session(cwd=str(home))
    except RuntimeError:
        return {"created": False, "configUnchanged": (home / "config.yaml").read_text() == saved_config}
    first = {"model": state.agent.model, "provider": state.agent.provider, "endpoint": state.agent.base_url}
    state.history = [{"role": "user", "content": "Synthetic retained conversation"}]
    manager.save_session(state.session_id)
    switched = manager._make_agent(session_id=state.session_id, cwd=str(home),
                                   model="other-model", requested_provider="custom:other")
    restored = SessionManager().get_session(state.session_id)
    return {"initial": first, "switch": {"model": switched.model, "endpoint": switched.base_url},
            "restoredModel": restored.agent.model, "restoredHistory": restored.history,
            "configUnchanged": (home / "config.yaml").read_text() == saved_config}


def inspect_restored_protocol():
    bootstrap.install_runtime_policy(browser_only="--unscoped" not in sys.argv[1:])
    from run_agent import AIAgent
    results = []
    for provider, base_url in [
        ("openai-codex", "https://chatgpt.com/backend-api/codex"),
        ("custom", "http://127.0.0.1:9/v1"),
        ("custom", "https://chatgpt.com.attacker.test/backend-api/codex"),
    ]:
        agent = AIAgent(model="test-model", provider=provider, base_url=base_url,
                        api_mode="chat_completions", api_key="fixture-not-a-secret",
                        fallback_model=[], credential_pool=None, skip_context_files=True,
                        skip_memory=True, load_soul_identity=False, skip_background_review=True,
                        session_db=None, save_trajectories=False, quiet_mode=True)
        request = agent._build_api_kwargs([{"role": "user", "content": "synthetic protocol check"}], tools_for_api=[])
        results.append({"provider": agent.provider, "apiMode": agent.api_mode,
                        "baseUrl": agent.base_url, "responsesInput": "input" in request,
                        "chatMessages": "messages" in request})
    return results


if __name__ == "__main__":
    with contextlib.redirect_stdout(sys.stderr):
        if sys.argv[1:] == ["--session-tool-retention"]:
            import asyncio
            result = asyncio.run(inspect_session_tool_retention())
        elif sys.argv[1:2] == ["--restored-protocol"]:
            result = inspect_restored_protocol()
        elif sys.argv[1:] == ["--initial-route"]:
            result = inspect_initial_route()
        elif sys.argv[1:] == ["--subscription-credential"]:
            result = inspect_subscription_credential()
        elif sys.argv[1:] == ["--metadata-endpoint"]:
            result = inspect_metadata_endpoint()
        else:
            result = inspect_qualification_constructor() if sys.argv[1:] == ["--qualification-constructor"] else inspect_browser_policy()
    print(json.dumps(result))
