"""Dani-owned entrypoint for the qualified managed Hermes runtime; never patches its files."""
from __future__ import annotations

import contextlib
import importlib.metadata
import json
import os
import platform
import sys
import hashlib
import secrets
from urllib.parse import parse_qsl, urlsplit, urlunsplit

sys.dont_write_bytecode = True

QUALIFIED_VERSION = "0.21.3"


def install_os_credential_policy():
    if os.environ.get("DANI_DISABLE_OS_CREDENTIALS") == "1":
        from agent import anthropic_credentials
        # Hermes 0.21.3 probes the host keychain even with a private HOME.
        anthropic_credentials._read_claude_code_credentials_from_keychain = lambda: None


def qualified_version():
    version = importlib.metadata.version("hermes-agent")
    if version != QUALIFIED_VERSION:
        raise RuntimeError("Dani's managed bootstrap requires qualified Hermes 0.21.3")
    return version


def selected_native_runtime(metadata_only=False, selection=None):
    qualified_version()
    install_os_credential_policy()
    from acp_adapter.entry import _load_env
    _load_env()
    from hermes_cli.config import load_config
    from hermes_cli.runtime_provider import resolve_runtime_provider
    config = load_config()
    model_config = config.get("model") or {}
    model = model_config.get("default", "") if isinstance(model_config, dict) else str(model_config)
    provider = model_config.get("provider", "") if isinstance(model_config, dict) else config.get("provider", "")
    if selection:
        from hermes_cli.models import parse_model_input
        provider, model = parse_model_input(selection, "")
        if not provider or provider in {"auto", "custom"} or not model:
            raise RuntimeError("Select an explicit native provider and model")
        config = {**config, "model": {**(model_config if isinstance(model_config, dict) else {}),
                                     "default": model, "provider": provider}}
    try:
        runtime = resolve_runtime_provider(requested=provider, target_model=model)
    except Exception:
        if not metadata_only:
            raise
        runtime = {}
    return config, runtime


def safe_endpoint(value):
    url = urlsplit(value or "")
    host = url.hostname or ""
    if ":" in host:
        host = "[" + host + "]"
    authority = host + (":" + str(url.port) if url.port else "")
    return urlunsplit((url.scheme, authority, url.path.rstrip("/"), "", ""))


def native_runtime_metadata(config, runtime):
    import run_agent
    model_config = config.get("model") or {}
    model = model_config.get("default", "") if isinstance(model_config, dict) else str(model_config)
    provider = model_config.get("provider", "") if isinstance(model_config, dict) else config.get("provider", "")
    headers = {**(model_config.get("default_headers") or {}), **(runtime.get("extra_headers") or {})} if isinstance(model_config, dict) else runtime.get("extra_headers") or {}
    headers = {name.lower(): value for name, value in headers.items()}
    return {"version": qualified_version(), "pythonVersion": platform.python_version(),
            "pythonExecutable": sys.executable, "source": run_agent.__file__,
            "configuredProvider": provider, "resolvedProvider": runtime.get("provider"),
            "model": model, "endpoint": safe_endpoint(runtime.get("base_url")),
            "apiMode": runtime.get("api_mode"), "credentialsResolved": bool(runtime.get("provider") and runtime.get("api_mode")),
            "credentialHeaderNames": sorted(headers),
            "credentialFingerprint": credential_fingerprint(runtime.get("api_key"), runtime.get("base_url"), headers)}


def runtime_info(selection=None):
    # Metadata only. In particular, never send resolved OAuth credentials to a model catalog/proxy.
    config, runtime = selected_native_runtime(metadata_only=True, selection=selection)
    return native_runtime_metadata(config, runtime)


FINGERPRINT_FIELDS = ("version", "configuredProvider", "resolvedProvider", "model", "endpoint", "apiMode")
PROBE_TOOL = "dani_provider_receipt"
PROBE_TOOLSET = "dani-provider-qualification"


def runtime_fingerprint(info):
    material = json.dumps([info.get(key) or "" for key in FINGERPRINT_FIELDS], separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def credential_fingerprint(key, endpoint, headers, query=None):
    if not isinstance(key, str) or not isinstance(endpoint, str):
        raise PermissionError("The native credential contract is not a fixed resolved credential")
    url = urlsplit(endpoint)
    params = dict(parse_qsl(url.query, keep_blank_values=True))
    if query:
        params.update(query)
    material = ["dani-native-credential-v1", key, url.scheme, url.netloc, url.path.rstrip("/"),
                sorted(params.items()), sorted(headers.items())]
    return hashlib.sha256(json.dumps(material, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def agent_credential_fingerprint(agent, header_names):
    kwargs = getattr(agent, "_client_kwargs", {}) or {}
    key = agent.api_key
    if kwargs.get("api_key", key) != key or getattr(agent, "_anthropic_api_key", key) != key:
        raise PermissionError("Native transport changed the qualified credential")
    for client in (getattr(agent, "client", None), getattr(agent, "_anthropic_client", None)):
        if client is not None and getattr(client, "api_key", key) != key:
            raise PermissionError("Native client changed the qualified credential")
    headers = {name.lower(): value for name, value in (kwargs.get("default_headers") or {}).items()}
    if any(name not in headers for name in header_names):
        raise PermissionError("Native transport discarded a qualified credential header")
    return credential_fingerprint(key, agent.base_url, {name: headers[name] for name in header_names}, kwargs.get("default_query"))


def assert_qualified_task_identity(agent):
    if "DANI_HERMES_QUALIFIED_IDENTITY" not in os.environ:
        return
    try:
        expected = json.loads(os.environ["DANI_HERMES_QUALIFIED_IDENTITY"])
        selection = os.environ.get("DANI_HERMES_INITIAL_MODEL", "")
        if selection != expected["configuredProvider"] + ":" + expected["model"]:
            raise ValueError("selection mismatch")
        actual = {"version": qualified_version(), "configuredProvider": expected["configuredProvider"],
                  "resolvedProvider": agent.provider, "model": agent.model,
                  "endpoint": safe_endpoint(agent.base_url), "apiMode": agent.api_mode}
        names = expected["credentialHeaderNames"]
        if not isinstance(names, list) or any(not isinstance(name, str) or name != name.lower() for name in names):
            raise ValueError("invalid header contract")
        if (getattr(agent, "_credential_pool", None) is not None or getattr(agent, "_fallback_chain", [])
                or runtime_fingerprint(actual) != expected["fingerprint"]
                or agent_credential_fingerprint(agent, names) != expected["credentialFingerprint"]):
            raise ValueError("contract mismatch")
    except Exception:
        raise PermissionError("Native task construction changed the qualified provider, model, endpoint, protocol or credential") from None


def require_api_credential(key, endpoint):
    token = key or ""
    if isinstance(token, str) and ((token.startswith("sk-ant-") and not token.startswith("sk-ant-api")) or (
            urlsplit(endpoint or "").hostname == "api.anthropic.com" and token.startswith(("eyJ", "cc-")))):
        raise PermissionError("Claude subscription credentials cannot be used by this harness. Configure an API key or supported inference provider.")




def require_compatible_runtime(info, runtime):
    configured, resolved = info.get("configuredProvider"), info.get("resolvedProvider")
    expected = "custom" if isinstance(configured, str) and configured.startswith("custom:") else configured
    if (info.get("version") != QUALIFIED_VERSION or not configured or configured == "auto"
            or expected != resolved or not info.get("model")
            or info.get("apiMode") not in {"chat_completions", "codex_responses", "anthropic_messages"}
            or runtime.get("command") or runtime.get("args")):
        raise RuntimeError("Select an explicit native model/provider API; auto, cross-provider fallback and whole-agent transports are not qualified")
    url = urlsplit(info.get("endpoint") or "")
    if url.scheme not in {"http", "https"} or not url.hostname or url.port == 4187:
        raise RuntimeError("The known tool-discarding agent proxy and non-API endpoints cannot be qualified")
    require_api_credential(runtime.get("api_key"), runtime.get("base_url"))


class ReceiptChallenge:
    def __init__(self):
        self.nonce = secrets.token_urlsafe(24)
        self.receipt = secrets.token_urlsafe(24)
        self.count = 0
        self.schema = {"type": "function", "function": {
            "name": PROBE_TOOL, "description": "Return a harmless in-memory provider qualification receipt.",
            "parameters": {"type": "object", "properties": {"nonce": {"type": "string"}},
                           "required": ["nonce"], "additionalProperties": False},
        }}

    def handle(self, args):
        self.count += 1
        if self.count != 1 or not isinstance(args, dict) or args != {"nonce": self.nonce}:
            raise PermissionError("Invalid or repeated qualification nonce")
        return {"receipt": self.receipt}


def prove_tool_roundtrip(challenge, exchange, dispatch, serialize_assistant):
    consumed = False
    try:
        messages = [
            {"role": "system", "content": "Call the supplied receipt tool exactly once using the nonce. After its result, answer only the exact receipt value. Do not invent a receipt."},
            {"role": "user", "content": json.dumps({"nonce": challenge.nonce})},
        ]
        first = exchange(messages, [challenge.schema], True)
        calls = first.tool_calls or []
        if len(calls) != 1 or calls[0].name != PROBE_TOOL or not calls[0].id:
            return {"qualified": False, "toolCallCount": challenge.count, "resultConsumed": False}
        args = json.loads(calls[0].arguments)
        if args != {"nonce": challenge.nonce}:
            return {"qualified": False, "toolCallCount": challenge.count, "resultConsumed": False}
        result = dispatch(args)
        if result != {"receipt": challenge.receipt} or challenge.count != 1:
            return {"qualified": False, "toolCallCount": challenge.count, "resultConsumed": False}
        messages.extend([serialize_assistant(first), {
            "role": "tool", "tool_call_id": calls[0].id, "content": json.dumps(result),
        }])
        final = exchange(messages, [], False)
        consumed = not final.tool_calls and isinstance(final.content, str) and final.content.strip() == challenge.receipt
    except Exception:
        # Provider/SDK exception bodies can contain requests, response text and credentials.
        consumed = False
    return {"qualified": consumed and challenge.count == 1, "toolCallCount": challenge.count,
            "resultConsumed": bool(consumed)}


def qualification_agent_kwargs(config, runtime):
    model_config = config.get("model") or {}
    model = model_config.get("default", "") if isinstance(model_config, dict) else str(model_config)
    return {"model": model, "provider": runtime.get("provider"), "api_mode": runtime.get("api_mode"),
            "base_url": runtime.get("base_url"), "api_key": runtime.get("api_key"),
            "enabled_toolsets": [PROBE_TOOLSET], "fallback_model": [], "credential_pool": None,
            "skip_context_files": True, "skip_memory": True, "load_soul_identity": False,
            "skip_background_review": True, "session_db": None, "save_trajectories": False,
            "verbose_logging": False, "quiet_mode": True, "max_iterations": 2, "max_tokens": 1024,
            "platform": "acp"}


def make_qualification_agent(config, runtime, challenge):
    install_os_credential_policy()
    import uuid
    from hermes_cli.mcp_startup import set_mcp_server_filter
    set_mcp_server_filter(["mcp-dani-" + uuid.uuid4().hex])
    os.environ["HERMES_ACP_SKIP_CONFIGURED_MCP"] = "1"
    from tools.registry import registry
    from toolsets import create_custom_toolset
    registry.register(name=PROBE_TOOL, toolset=PROBE_TOOLSET, schema=challenge.schema["function"],
                      handler=lambda args, **_kwargs: json.dumps(challenge.handle(args)))
    create_custom_toolset(PROBE_TOOLSET, "In-memory provider qualification only", tools=[PROBE_TOOL])
    from run_agent import AIAgent
    import model_tools
    original_definitions = model_tools.get_tool_definitions

    def qualification_definitions(enabled_toolsets=None, disabled_toolsets=None, quiet_mode=False, skip_tool_search_assembly=False):
        return original_definitions(enabled_toolsets=enabled_toolsets, disabled_toolsets=disabled_toolsets,
                                    quiet_mode=quiet_mode,
                                    skip_tool_search_assembly=skip_tool_search_assembly or enabled_toolsets == [PROBE_TOOLSET])

    # Hermes 0.21.3 exposes raw assembly on model_tools, but not on AIAgent's constructor.
    model_tools.get_tool_definitions = qualification_definitions
    try:
        agent = AIAgent(**qualification_agent_kwargs(config, runtime))
    finally:
        model_tools.get_tool_definitions = original_definitions
    info = native_runtime_metadata(config, runtime)
    names = {tool["function"]["name"] for tool in agent.tools or []}
    if (names != {PROBE_TOOL} or agent.valid_tool_names != names or agent._fallback_chain
            or agent.model != info["model"] or agent.provider != info["resolvedProvider"]
            or agent.api_mode != info["apiMode"] or safe_endpoint(agent.base_url) != info["endpoint"]
            or getattr(agent, "_credential_pool", None) is not None
            or agent_credential_fingerprint(agent, info["credentialHeaderNames"]) != info["credentialFingerprint"]):
        raise PermissionError("Native qualification constructor changed the selected runtime or admitted extra tools")
    return agent


def run_qualification(selection=None):
    config, runtime = selected_native_runtime(selection=selection)
    info = native_runtime_metadata(config, runtime)
    require_compatible_runtime(info, runtime)
    challenge = ReceiptChallenge()
    agent = make_qualification_agent(config, runtime, challenge)
    from agent.chat_completion_helpers import direct_api_call
    from model_tools import handle_function_call

    def exchange(messages, tools, _required):
        if agent_credential_fingerprint(agent, info["credentialHeaderNames"]) != info["credentialFingerprint"]:
            raise PermissionError("Native qualification changed its credential")
        kwargs = agent._build_api_kwargs(messages, tools_for_api=tools)
        if agent.api_mode != "codex_responses":
            kwargs["stream"] = False
        response = direct_api_call(agent, kwargs)
        if agent_credential_fingerprint(agent, info["credentialHeaderNames"]) != info["credentialFingerprint"]:
            raise PermissionError("Native qualification changed its credential")
        return agent._get_transport().normalize_response(response)

    def dispatch(args):
        return json.loads(handle_function_call(PROBE_TOOL, args, enabled_tools=[PROBE_TOOL],
            enabled_toolsets=[PROBE_TOOLSET], disabled_toolsets=agent.disabled_toolsets))

    result = prove_tool_roundtrip(challenge, exchange, dispatch,
        lambda reply: agent._build_assistant_message(reply, reply.finish_reason))
    return {"schemaVersion": 1, **result, "fingerprint": runtime_fingerprint(info),
            "credentialFingerprint": info["credentialFingerprint"], "runtime": info}


def install_session_policy():
    selection = os.environ.get("DANI_HERMES_INITIAL_MODEL", "").strip()
    from hermes_cli.models import parse_model_input
    from acp_adapter import session as native_sessions
    from tools.mcp_tool_agent import refresh_agent_mcp_tools
    provider, selected_model = parse_model_input(selection, "") if selection else (None, None)
    if selection and (not provider or provider in {"auto", "custom"} or not selected_model):
        raise RuntimeError("The selected model requires an explicit native provider route")
    native_manager = native_sessions.SessionManager

    class DaniSessionManager(native_manager):
        def _make_agent(self, *, session_id, cwd, model=None, requested_provider=None, base_url=None, api_mode=None):
            previous = self._sessions.get(session_id)
            mounted = [name for name in previous.agent.enabled_toolsets if name.startswith("mcp-")] if previous else []
            # Hermes 0.21.3 builds new/restored agents before ACP set_model; an unrelated default may not authenticate.
            if selection and previous is None:
                model = selected_model
                requested_provider = provider
                base_url = api_mode = None
            agent = super()._make_agent(session_id=session_id, cwd=cwd, model=model,
                                        requested_provider=requested_provider, base_url=base_url, api_mode=api_mode)
            # Hermes 0.21.3 model switches rebuild from profile toolsets, dropping this session's ACP mounts.
            inherited = [name for name in mounted if name not in agent.enabled_toolsets]
            if inherited:
                refresh_agent_mcp_tools(agent, enabled_override=[*agent.enabled_toolsets, *inherited],
                                        quiet_mode=True, content_aware=True)
                if callable(invalidate := getattr(agent, "_invalidate_system_prompt", None)):
                    invalidate()
            return agent

    native_sessions.SessionManager = DaniSessionManager


def install_runtime_policy(browser_only=False):
    """Change the constructor seam in this child only; native SessionManager still owns setup."""
    qualified_version()
    install_os_credential_policy()
    import inspect
    import uuid
    from acp_adapter.entry import _load_env
    _load_env()
    install_session_policy()
    from hermes_cli.mcp_startup import set_mcp_server_filter
    # Saved profile servers cannot replace Dani's admitted session MCP mounts.
    set_mcp_server_filter(["mcp-dani-" + uuid.uuid4().hex])
    os.environ["HERMES_ACP_SKIP_CONFIGURED_MCP"] = "1"
    if browser_only:
        from tools.tool_search import load_config as load_tool_search_config
        if load_tool_search_config().enabled != "off":
            raise RuntimeError("Browser-only Hermes requires tools.tool_search.enabled: off in its isolated native profile")
    from hermes_cli.providers import host_mandated_api_mode
    import run_agent
    from tools.registry import registry
    from toolsets import create_custom_toolset
    from tools.tool_search import TOOL_CALL_NAME, resolve_underlying_call
    native_browser_tools = frozenset(registry.get_tool_names_for_toolset("browser"))
    if not native_browser_tools:
        raise RuntimeError("Installed Hermes did not register its qualified native browser toolset")
    # Disabling bare "browser" also disables Dani's mcp-browser through Hermes' MCP alias.
    # Use exact native registry identities, leaving coding tools and admitted MCP untouched.
    browser_exclusions = "dani-native-browser-exclusions"
    create_custom_toolset(browser_exclusions, "Native browser excluded from Dani-managed agents",
                          tools=sorted(native_browser_tools))

    def is_native_browser(name):
        return name in native_browser_tools or registry.get_toolset_for_tool(name) == "browser"

    from tools import mcp_tool_agent
    native_restore = mcp_tool_agent.restore_agent_tool_prefix

    def restore_admitted_tool_prefix(agent, saved_names):
        return native_restore(agent, [name for name in saved_names if not is_native_browser(name)])

    mcp_tool_agent.restore_agent_tool_prefix = restore_admitted_tool_prefix

    native_agent = run_agent.AIAgent
    required = {"enabled_toolsets", "disabled_toolsets", "session_id", "session_db", "cwd", "api_mode", "base_url"}
    if not required.issubset(inspect.signature(native_agent.__init__).parameters):
        raise RuntimeError("Installed Hermes constructor does not satisfy Dani's qualified tool-policy contract")

    class DaniAgent(native_agent):
        def __init__(self, *args, **kwargs):
            if os.environ.get("DANI_HERMES_INITIAL_MODEL") and (not kwargs.get("provider") or not kwargs.get("api_mode")):
                raise RuntimeError("The selected native provider could not resolve its credentials or protocol")
            kwargs["fallback_model"] = []
            kwargs["credential_pool"] = None
            endpoint = kwargs.get("base_url") or ""
            require_api_credential(kwargs.get("api_key"), endpoint)
            required_mode = host_mandated_api_mode(endpoint)
            url = urlsplit(endpoint)
            # Hermes 0.21.3 ACP keeps a restored api_mode on same-provider switches; Codex only serves Responses.
            if (url.scheme == "https" and url.hostname == "chatgpt.com" and url.port in (None, 443)
                    and url.path.rstrip("/") == "/backend-api/codex"):
                required_mode = "codex_responses"
            if required_mode:
                kwargs["api_mode"] = required_mode
            disabled = list(kwargs.get("disabled_toolsets") or [])
            if browser_exclusions not in disabled:
                disabled.append(browser_exclusions)
            kwargs["disabled_toolsets"] = disabled
            if browser_only:
                kwargs["enabled_toolsets"] = ["mcp-browser"]
            super().__init__(*args, **kwargs)
            assert_qualified_task_identity(self)
            if (any(is_native_browser(tool["function"]["name"]) for tool in self.tools or [])
                    or any(is_native_browser(name) for name in self.valid_tool_names)):
                raise PermissionError("Native browser admission violates Dani's managed-browser authority")
            if browser_only:
                self._dani_assert_browser_catalog()

        def _dani_assert_browser_catalog(self):
            names = {tool["function"]["name"] for tool in self.tools or []}
            if names != self.valid_tool_names or any(not name.startswith("mcp__browser__") for name in names):
                raise PermissionError("Native tool injection violates the browser-only constructor policy")

        def _execute_tool_calls(self, assistant_message, messages, effective_task_id, api_call_count=0):
            # Saved catalogs and runtime injections cannot reauthorize the alternate browser.
            # This is a native tool boundary, not an OS sandbox for the retained coding tools.
            for call in assistant_message.tool_calls or []:
                name = call.function.name
                if is_native_browser(name):
                    raise PermissionError("Native browser dispatch is outside Dani's managed-browser authority")
                if name == TOOL_CALL_NAME:
                    try:
                        arguments = json.loads(call.function.arguments)
                    except (ValueError, TypeError):
                        continue  # Native dispatch rejects malformed JSON without executing a tool.
                    if isinstance(arguments, dict):
                        underlying, _, _ = resolve_underlying_call(arguments)
                        if underlying and is_native_browser(underlying):
                            raise PermissionError("Deferred native browser dispatch is outside Dani's managed-browser authority")
            if browser_only:
                self._dani_assert_browser_catalog()
                for call in assistant_message.tool_calls or []:
                    name = call.function.name
                    if not name.startswith("mcp__browser__") or name not in self.valid_tool_names:
                        raise PermissionError("Tool dispatch is outside the admitted Dani browser MCP catalog")
            return super()._execute_tool_calls(assistant_message, messages, effective_task_id, api_call_count)

    run_agent.AIAgent = DaniAgent




def main():
    if sys.argv[1:] == ["--version"]:
        print(qualified_version())
        return
    operation = sys.argv[1] if len(sys.argv) > 1 else ""
    selected = sys.argv[2] if len(sys.argv) == 3 else None
    if (sys.argv[1:] in (["--runtime-info"], ["--qualify-provider"])
            or (operation in {"--runtime-info", "--qualify-route"} and selected)):
        import logging
        previous_logging = logging.root.manager.disable
        logging.disable(logging.CRITICAL)
        try:
            with open(os.devnull, "w") as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
                try:
                    result = run_qualification(selected) if operation in {"--qualify-provider", "--qualify-route"} else runtime_info(selected)
                except Exception:
                    result = {"qualified": False, "reason": "native_qualification_failed"} if operation in {"--qualify-provider", "--qualify-route"} else {"available": False, "reason": "native_runtime_unavailable"}
        finally:
            logging.disable(previous_logging)
        print(json.dumps(result))
        return
    if sys.argv[1:] in (["acp"], ["--browser-only", "acp"]):
        with contextlib.redirect_stdout(sys.stderr):
            install_runtime_policy(browser_only="--browser-only" in sys.argv[1:])
        from acp_adapter.entry import main as native_main
        native_main([])
        return
    raise RuntimeError("Unsupported Dani Hermes bootstrap operation")


if __name__ == "__main__":
    main()
