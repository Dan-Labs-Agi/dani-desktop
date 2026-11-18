"""Offline protocol/security regressions; never invokes a provider or loads real credentials."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("dani_hermes_bootstrap", Path(__file__).parents[1] / "drivers/acp/hermes-bootstrap.py")
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)

def serialize(reply):
    return {"role": "assistant", "content": reply.content, "tool_calls": [
        {"id": call.id, "type": "function", "function": {"name": call.name, "arguments": call.arguments}}
        for call in reply.tool_calls
    ]}


class QualificationContract(unittest.TestCase):
    def challenge(self):
        return bootstrap.ReceiptChallenge()

    def test_text_only_provider_cannot_qualify(self):
        challenge = self.challenge()
        result = bootstrap.prove_tool_roundtrip(challenge, lambda *_: types.SimpleNamespace(content="Done", tool_calls=[]), challenge.handle, serialize)
        self.assertFalse(result["qualified"])
        self.assertEqual(result["toolCallCount"], 0)

    def test_exact_nonce_once_and_result_consumed(self):
        challenge = self.challenge()
        calls = []
        def exchange(messages, tools, required):
            calls.append((messages, tools, required))
            self.assertEqual([tool["function"]["name"] for tool in tools], ["dani_provider_receipt"] if required else [])
            if required:
                nonce = json.loads(messages[-1]["content"])["nonce"]
                return types.SimpleNamespace(content=None, tool_calls=[types.SimpleNamespace(id="call-1", name="dani_provider_receipt", arguments=json.dumps({"nonce": nonce}))])
            self.assertEqual(messages[-1]["role"], "tool")
            return types.SimpleNamespace(content=json.loads(messages[-1]["content"])["receipt"], tool_calls=[])
        result = bootstrap.prove_tool_roundtrip(challenge, exchange, challenge.handle, serialize)
        self.assertTrue(result["qualified"])
        self.assertEqual(result["toolCallCount"], 1)
        self.assertTrue(result["resultConsumed"])
        self.assertEqual(len(calls), 2)
        encoded = json.dumps(result)
        self.assertNotIn(challenge.nonce, encoded)
        self.assertNotIn(challenge.receipt, encoded)

    def test_wrong_nonce_extra_tools_duplicate_calls_and_unconsumed_result_fail(self):
        for scenario in ["wrong-nonce", "terminal", "duplicate", "unconsumed", "second-tool"]:
            with self.subTest(scenario=scenario):
                challenge = self.challenge()
                def exchange(messages, tools, required):
                    if not required:
                        return types.SimpleNamespace(content="not-the-receipt", tool_calls=[types.SimpleNamespace(name="terminal")] if scenario == "second-tool" else [])
                    call = types.SimpleNamespace(id="call-1", name="terminal" if scenario == "terminal" else "dani_provider_receipt",
                        arguments=json.dumps({"nonce": "wrong" if scenario == "wrong-nonce" else challenge.nonce}))
                    return types.SimpleNamespace(content=None, tool_calls=[call, call] if scenario == "duplicate" else [call])
                result = bootstrap.prove_tool_roundtrip(challenge, exchange, challenge.handle, serialize)
                self.assertFalse(result["qualified"])
                self.assertLessEqual(result["toolCallCount"], 1)

    def test_metadata_resolution_makes_no_network_or_model_call_and_redacts_credentials(self):
        config = {"model": {"default": "fixture", "provider": "custom:fixture"}}
        runtime = {"provider": "custom", "api_mode": "chat_completions", "api_key": "private-key",
                   "base_url": "http://user:private-key@127.0.0.1:4187/v1?secret=private-key"}
        modules = {
            "acp_adapter.entry": types.SimpleNamespace(_load_env=lambda: None),
            "hermes_cli.config": types.SimpleNamespace(load_config=lambda: config),
            "hermes_cli.runtime_provider": types.SimpleNamespace(resolve_runtime_provider=lambda **_: runtime),
            "run_agent": types.SimpleNamespace(__file__="/qualified/run_agent.py"),
        }
        with patch.dict(sys.modules, modules), patch.object(bootstrap, "qualified_version", return_value="0.21.3"), patch("urllib.request.urlopen", side_effect=AssertionError("Network must not be called")) as network:
            result = bootstrap.runtime_info()
        network.assert_not_called()
        self.assertEqual(result["apiMode"], "chat_completions")
        self.assertNotIn("private-key", json.dumps(result))
        self.assertNotIn("modelReady", result)

    def identity_fixture(self):
        config = {"model": {"default": "fixture", "provider": "custom:fixture",
                            "default_headers": {"X-Tenant": "fixture-tenant"}}}
        runtime = {"provider": "custom", "api_mode": "chat_completions", "api_key": "fixture-key",
                   "base_url": "https://fixture.invalid/v1?region=one", "extra_headers": {"X-API-Key": "fixture-header"}}
        agent = types.SimpleNamespace(model="fixture", provider="custom", api_mode="chat_completions",
            api_key="fixture-key", base_url="https://fixture.invalid/v1", _credential_pool=None, _fallback_chain=[],
            _client_kwargs={"api_key": "fixture-key", "base_url": "https://fixture.invalid/v1",
                            "default_query": {"region": "one"},
                            "default_headers": {"X-Tenant": "fixture-tenant", "X-API-Key": "fixture-header"}})
        return config, runtime, agent

    def identity_metadata(self, config, runtime):
        with patch.object(bootstrap, "qualified_version", return_value="0.21.3"), patch.dict(sys.modules,
                {"run_agent": types.SimpleNamespace(__file__="/fixture/run_agent.py")}):
            return bootstrap.native_runtime_metadata(config, runtime)

    def test_credential_fingerprint_binds_resolved_key_endpoint_and_headers(self):
        config, runtime, _agent = self.identity_fixture()
        first = self.identity_metadata(config, runtime)
        self.assertIn("credentialFingerprint", first)
        for field, value in [("api_key", "other-key"), ("base_url", "https://fixture.invalid/v1?region=two"),
                             ("extra_headers", {"X-API-Key": "other-header"})]:
            with self.subTest(field=field):
                changed = self.identity_metadata(config, {**runtime, field: value})
                self.assertNotEqual(first["credentialFingerprint"], changed["credentialFingerprint"])
        self.assertNotIn("fixture-key", json.dumps(first))
        self.assertNotIn("fixture-header", json.dumps(first))

    def test_task_identity_accepts_exact_constructor_and_rejects_changes(self):
        config, runtime, original = self.identity_fixture()
        info = self.identity_metadata(config, runtime)
        info["fingerprint"] = bootstrap.runtime_fingerprint(info)
        modules = {"hermes_cli.models": types.SimpleNamespace(parse_model_input=lambda *_: ("custom:fixture", "fixture"))}
        env = {"DANI_HERMES_QUALIFIED_IDENTITY": json.dumps(info), "DANI_HERMES_INITIAL_MODEL": "custom:fixture:fixture"}
        with patch.dict(os.environ, env), patch.dict(sys.modules, modules), patch.object(bootstrap, "qualified_version", return_value="0.21.3"):
            bootstrap.assert_qualified_task_identity(original)
            for field, value in [("api_key", "changed-key"), ("base_url", "https://other.invalid/v1"),
                                 ("model", "other"), ("provider", "openrouter"), ("api_mode", "codex_responses"),
                                 ("_credential_pool", object()), ("_fallback_chain", [{"model": "other"}])]:
                with self.subTest(field=field):
                    changed = types.SimpleNamespace(**{**vars(original), field: value})
                    with self.assertRaises(PermissionError):
                        bootstrap.assert_qualified_task_identity(changed)
            for field, value in [("default_headers", {"X-Tenant": "other", "X-API-Key": "fixture-header"}),
                                 ("default_query", {"region": "two"}), ("api_key", "changed-client-key")]:
                changed = types.SimpleNamespace(**{**vars(original), "_client_kwargs": {**original._client_kwargs, field: value}})
                with self.assertRaises(PermissionError):
                    bootstrap.assert_qualified_task_identity(changed)
            with patch.dict(os.environ, {"DANI_HERMES_INITIAL_MODEL": "other:fixture"}):
                with self.assertRaises(PermissionError):
                    bootstrap.assert_qualified_task_identity(original)

    def test_task_identity_rejects_legacy_or_malformed_binding_and_allows_unbound_offline_probe(self):
        _config, _runtime, agent = self.identity_fixture()
        with patch.dict(os.environ, {}, clear=True):
            bootstrap.assert_qualified_task_identity(agent)
            for value in ["", "bad-json", "{}", "null"]:
                with patch.dict(os.environ, {"DANI_HERMES_QUALIFIED_IDENTITY": value}):
                    with self.assertRaises(PermissionError):
                        bootstrap.assert_qualified_task_identity(agent)

    def qualification_constructor_fixture(self, fail=False):
        config, runtime, agent = self.identity_fixture()
        challenge = self.challenge()
        calls = []
        def definitions(enabled_toolsets=None, disabled_toolsets=None, quiet_mode=False, skip_tool_search_assembly=False):
            calls.append((enabled_toolsets, skip_tool_search_assembly))
            names = [bootstrap.PROBE_TOOL] if skip_tool_search_assembly else ["tool_search", "tool_describe", "tool_call"]
            return [{"function": {"name": name}} for name in names]
        model_tools = types.SimpleNamespace(get_tool_definitions=definitions)
        def constructor(**kwargs):
            agent.tools = model_tools.get_tool_definitions(enabled_toolsets=kwargs["enabled_toolsets"], quiet_mode=True)
            agent.valid_tool_names = {tool["function"]["name"] for tool in agent.tools}
            model_tools.get_tool_definitions(enabled_toolsets=["terminal"], quiet_mode=True)
            if fail:
                raise RuntimeError("fixture constructor failed")
            return agent
        modules = {
            "model_tools": model_tools,
            "run_agent": types.SimpleNamespace(AIAgent=constructor, __file__="/fixture/run_agent.py"),
            "hermes_cli.mcp_startup": types.SimpleNamespace(set_mcp_server_filter=lambda *_: None),
            "tools.registry": types.SimpleNamespace(registry=types.SimpleNamespace(register=lambda **_: None)),
            "toolsets": types.SimpleNamespace(create_custom_toolset=lambda *_args, **_kwargs: None),
        }
        return config, runtime, challenge, agent, calls, model_tools, definitions, modules

    def test_qualification_uses_single_raw_tool_without_changing_other_assembly(self):
        config, runtime, challenge, agent, calls, model_tools, original, modules = self.qualification_constructor_fixture()
        with patch.dict(sys.modules, modules), patch.dict(os.environ, {}, clear=True), patch.object(bootstrap, "qualified_version", return_value="0.21.3"):
            result = bootstrap.make_qualification_agent(config, runtime, challenge)
            self.assertIs(result, agent)
            self.assertEqual(agent.valid_tool_names, {bootstrap.PROBE_TOOL})
            self.assertEqual(calls, [([bootstrap.PROBE_TOOLSET], True), (["terminal"], False)])
            self.assertIs(model_tools.get_tool_definitions, original)
            self.assertEqual([t["function"]["name"] for t in model_tools.get_tool_definitions()], ["tool_search", "tool_describe", "tool_call"])

    def test_qualification_restores_assembly_when_constructor_raises(self):
        config, runtime, challenge, _agent, _calls, model_tools, original, modules = self.qualification_constructor_fixture(fail=True)
        with patch.dict(sys.modules, modules), patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "fixture constructor failed"):
                bootstrap.make_qualification_agent(config, runtime, challenge)
            self.assertIs(model_tools.get_tool_definitions, original)

    def test_operator_output_never_emits_failure_bodies(self):
        out, err = io.StringIO(), io.StringIO()
        with patch.object(sys, "argv", ["hermes-bootstrap.py", "--qualify-provider"]), patch.object(bootstrap, "run_qualification", side_effect=RuntimeError("private-key private-prompt private-answer")), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            bootstrap.main()
        result = json.loads(out.getvalue())
        self.assertFalse(result["qualified"])
        self.assertNotIn("private-", out.getvalue() + err.getvalue())


if __name__ == "__main__":
    unittest.main()
