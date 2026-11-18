"""Native metadata consumer regressions. Only disposable fixture homes and mocked HTTP are used."""
import base64
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

sys.dont_write_bytecode = True
METADATA = Path(__file__).parents[1] / "drivers/acp/hermes-model-metadata.py"


def fixture_jwt(exp):
    payload = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode()).decode().rstrip("=")
    return "fixture." + payload + ".fixture"


def worker():
    import runpy
    import socket
    from urllib.parse import urlsplit
    from unittest.mock import patch
    import httpx
    import hermes_cli.auth as auth
    import hermes_cli.models as models
    import agent.credential_pool as pools
    import agent.anthropic_credentials as anthropic
    home = Path(os.environ["HERMES_HOME"])
    requests, forbidden = [], []

    def deny(name):
        def denied(*_args, **_kwargs):
            forbidden.append(name)
            raise AssertionError("Metadata called " + name)
        return denied

    def response(url, headers):
        host = urlsplit(str(url)).hostname
        if host in {"127.0.0.1", "localhost", "::1"}:
            # No default LM Studio/other localhost server exists in this isolated fixture.
            raise ConnectionError("No fixture listener")
        lowered = {key.lower(): value for key, value in headers.items()}
        key = lowered.get("authorization", "").removeprefix("Bearer ") or lowered.get("x-api-key", "")
        requests.append({"host": host, "path": urlsplit(str(url)).path, "key": key})
        if host == "stalled.fixture.test":
            time.sleep(10)
        if not key:
            return (200, {"data": [{"id": "fixture-model"}]}) if host == "openrouter.ai" else (401, {})
        if urlsplit(str(url)).path.endswith("/key"):
            return 200, {"data": {"is_free_tier": False}}
        return 200, {"data": [{"id": "fixture-model"}], "models": [{"slug": "fixture-codex"}]}

    def open_catalog(request, **_kwargs):
        status, body = response(request.full_url, dict(request.header_items()))
        if status != 200:
            raise AssertionError("Native catalog did not send fixture authorization")
        return contextlib.closing(io.BytesIO(json.dumps(body).encode()))

    def send(_client, request, **_kwargs):
        status, body = response(str(request.url), request.headers)
        return httpx.Response(status, json=body, request=request)

    def snapshot():
        return {str(path.relative_to(home)): path.read_bytes() for path in home.rglob("*") if path.is_file()}

    before = snapshot()
    with contextlib.ExitStack() as stack:
        stack.enter_context(patch.object(models, "_urlopen_model_catalog_request", open_catalog))
        stack.enter_context(patch.object(httpx.Client, "send", send))
        stack.enter_context(patch.object(socket.socket, "connect", deny("real network")))
        for target, name in [
            (auth, "_save_auth_store"), (auth, "write_credential_pool"), (auth, "_auth_store_lock"),
            (auth, "detect_zai_endpoint"),
            (pools.CredentialPool, "_persist"), (pools.CredentialPool, "_refresh_entry"),
            (pools.CredentialPool, "select"), (pools.CredentialPool, "peek"),
            (pools.CredentialPool, "_available_entries"), (pools.CredentialPool, "_resync_stale_entry"),
            (pools, "_seed_from_singletons"),
            (anthropic, "read_claude_code_credentials"), (anthropic, "read_hermes_oauth_credentials"),
            (anthropic, "resolve_anthropic_token"),
        ]:
            stack.enter_context(patch.object(target, name, deny(name)))
        # The real native runtime resolver and catalog parser remain in the consumer path.
        module = runpy.run_path(str(METADATA))
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            catalog = module["metadata"]()
    after = snapshot()
    changed = sorted(name for name in before.keys() | after.keys() if before.get(name) != after.get(name))
    return {"catalog": catalog, "requests": requests, "forbidden": forbidden,
            "unchanged": not changed, "changedPaths": changed}


class ReadonlyMetadataTests(unittest.TestCase):
    def catalog(self, config, *, auth=None, dotenv="", extra=None, timeout="10000"):
        with tempfile.TemporaryDirectory(prefix="dani-metadata-fixture-") as root:
            home = Path(root) / "native"
            home.mkdir()
            (home / "config.yaml").write_text(config)
            (home / ".env").write_text(dotenv)
            if auth is not None:
                (home / "auth.json").write_text(auth if isinstance(auth, str) else json.dumps(auth))
            for name, value in (extra or {}).items():
                target = home / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(value)
            # Do not inherit account keys, foreign credential locations, or the real native home.
            env = {"PATH": os.environ.get("PATH", ""), "HOME": root, "HERMES_HOME": str(home),
                   "PYTHONDONTWRITEBYTECODE": "1", "HERMES_ACP_MODELS_TIMEOUT_MS": timeout,
                   "HERMES_MANAGED_DIR": str(home / "managed")}
            if os.environ.get("PYTHONPATH"):
                env["PYTHONPATH"] = os.environ["PYTHONPATH"]
            run = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--worker"],
                                 text=True, capture_output=True, env=env, timeout=35)
            self.assertEqual(run.returncode, 0, run.stderr)
            value = json.loads(run.stdout.strip().splitlines()[-1])
            self.assertTrue(value["unchanged"], "Metadata changed native files: " + repr(value["changedPaths"]))
            self.assertEqual(value["forbidden"], [], "Metadata invoked auth mutation/source discovery")
            return value

    def provider(self, value, name):
        return next(row for row in value["catalog"]["providers"] if row["id"] == name)

    def test_dead_healthy_cooldown_round_robin_pool_is_readonly(self):
        now = time.time()
        entries = [
            {"id": "dead", "access_token": "fixture-dead", "last_status": "dead", "last_status_at": now - 172800},
            {"id": "cooldown", "access_token": "fixture-cooldown", "last_status": "exhausted", "last_error_reset_at": now + 3600},
            {"id": "healthy", "access_token": "fixture-healthy", "priority": 2},
            {"id": "healthy-next", "access_token": "fixture-next", "priority": 3},
        ]
        for entry in entries:
            entry.update(source="manual", auth_type="api_key", base_url="https://pool.fixture.test/v1")
        value = self.catalog("model:\n  provider: openai-api\n  default: fixture-model\ncredential_pool_strategies:\n  openai-api: round_robin\n",
                             auth={"credential_pool": {"openai-api": entries}})
        self.assertIn("fixture-model", self.provider(value, "openai-api")["authenticatedModels"])
        authorized = [row for row in value["requests"] if row["key"]]
        self.assertEqual(authorized, [{"host": "pool.fixture.test", "path": "/v1/models", "key": "fixture-healthy"}])

    def test_persisted_env_reference_is_hydrated_without_writing(self):
        value = self.catalog("model:\n  provider: openai-api\n  default: fixture-model\n  base_url: https://reference.fixture.test/v1\n",
                             dotenv="OPENAI_API_KEY=fixture-live-reference\n",
                             auth={"credential_pool": {"openai-api": [{"id": "reference", "source": "env:OPENAI_API_KEY",
                                                                         "auth_type": "api_key", "request_count": 17}]}})
        self.assertIn("fixture-model", self.provider(value, "openai-api")["authenticatedModels"])
        self.assertTrue(any(row["host"] == "reference.fixture.test" and row["key"] == "fixture-live-reference" for row in value["requests"]))

    def test_keyless_public_custom_catalog_stays_visible_unavailable(self):
        value = self.catalog("providers:\n  public-fixture:\n    base_url: https://public.fixture.test/v1\n    models: [fixture-model]\n")
        row = self.provider(value, "custom:public-fixture")
        self.assertIn("fixture-model", row["models"])
        self.assertEqual(row["authenticatedModels"], [])
        self.assertFalse(any(request["host"] == "public.fixture.test" for request in value["requests"]))

    def test_model_endpoint_and_key_pointers_override_registry_defaults(self):
        for provider, pointer, env_name in [("openai-api", "key_env", "OPENAI_API_KEY"), ("zai", "api_key_env", "GLM_API_KEY")]:
            with self.subTest(provider=provider):
                value = self.catalog(f"model:\n  provider: {provider}\n  default: fixture-model\n  base_url: https://selected.fixture.test/v1\n  {pointer}: FIXTURE_SELECTED\n",
                                     dotenv=f"{env_name}=fixture-registry\nFIXTURE_SELECTED=fixture-selected\nOPENAI_BASE_URL=https://stale.fixture.test/v1\n")
                row = self.provider(value, provider)
                self.assertIn("fixture-model", row["authenticatedModels"])
                self.assertIn("FIXTURE_SELECTED", row["credentialEnv"])
                authorized = [request for request in value["requests"] if request["key"]]
                self.assertEqual(authorized, [{"host": "selected.fixture.test", "path": "/v1/models", "key": "fixture-selected"}])
                self.assertFalse(any(request["host"] == "stale.fixture.test" for request in value["requests"]))

    def test_openrouter_default_and_provider_owned_credentials_remain_usable(self):
        for variant in ["selected", "auto-default", "unselected-env", "unselected-pool"]:
            with self.subTest(variant=variant):
                config = ("model:\n  provider: openrouter\n  default: fixture-model\n" if variant == "selected" else
                          "model:\n  provider: auto\n  default: fixture-model\n" if variant == "auto-default" else
                          "model:\n  provider: openai-api\n  default: fixture-model\n")
                key = "sk-or-fixture-owned" if variant.startswith("unselected") else "fixture-native-openai-fallback"
                dotenv = "OPENAI_API_KEY=fixture-native-openai-fallback\n"
                store = None
                if variant == "unselected-env":
                    dotenv += "OPENROUTER_API_KEY=" + key + "\n"
                elif variant == "unselected-pool":
                    store = {"credential_pool": {"openrouter": [{"id": "owned", "source": "manual", "auth_type": "api_key",
                                                                  "access_token": key, "base_url": "https://openrouter.ai/api/v1"}]}}
                value = self.catalog(config, auth=store, dotenv=dotenv)
                self.assertIn("fixture-model", self.provider(value, "openrouter")["authenticatedModels"])
                router_requests = [row for row in value["requests"] if row["host"] == "openrouter.ai" and row["key"]]
                self.assertTrue(router_requests)
                self.assertTrue(all(row["key"] == key for row in router_requests))

    def test_unselected_openrouter_cannot_borrow_generic_custom_endpoint(self):
        value = self.catalog("model:\n  provider: openai-api\n  default: fixture-model\n  base_url: https://selected.fixture.test/v1\n  key_env: FIXTURE_SELECTED\n",
                             dotenv="FIXTURE_SELECTED=fixture-selected\nOPENAI_API_KEY=sk-or-fixture-shared\nOPENROUTER_API_KEY=sk-or-fixture-shared\nCUSTOM_BASE_URL=https://api.openai.com/v1\n")
        self.assertIn("fixture-model", self.provider(value, "openai-api")["authenticatedModels"])
        self.assertEqual(self.provider(value, "openrouter")["authenticatedModels"], [])
        self.assertFalse(any(row["key"] == "sk-or-fixture-shared" for row in value["requests"]))

    def test_zai_endpoint_snapshot_preserves_cache_and_override_without_inference(self):
        key = "fixture-zai-key"
        key_hash = hashlib.sha256(key.encode()).hexdigest()[:16]
        for variant, expected in [("cached", "cached.fixture.test"), ("mismatched", "api.z.ai"),
                                  ("override", "override.fixture.test"), ("env-reference", "cached.fixture.test")]:
            with self.subTest(variant=variant):
                store = {"providers": {"zai": {"detected_endpoint": {
                    "base_url": "https://cached.fixture.test/v1",
                    "key_hash": "fixture-other-hash" if variant == "mismatched" else key_hash,
                }}}}
                if variant == "env-reference":
                    store["credential_pool"] = {"zai": [{"id": "env-reference", "source": "env:GLM_API_KEY", "auth_type": "api_key"}]}
                dotenv = "GLM_API_KEY=" + key + "\n"
                if variant == "override":
                    dotenv += "GLM_BASE_URL=https://override.fixture.test/v1\n"
                value = self.catalog("model:\n  provider: zai\n  default: fixture-model\n", auth=store, dotenv=dotenv)
                self.assertIn("fixture-model", self.provider(value, "zai")["authenticatedModels"])
                self.assertTrue(any(row["host"] == expected and row["key"] == key for row in value["requests"]))
                self.assertFalse(any(row["key"] == key and row["host"] != expected for row in value["requests"]))

    def test_native_config_expansion_and_legacy_root_keys(self):
        value = self.catalog("provider: openai-api\nbase_url: ${env:FIXTURE_ENDPOINT}\nmodel: fixture-model\n",
                             dotenv="FIXTURE_ENDPOINT=https://expanded.fixture.test/v1\nOPENAI_API_KEY=fixture-expanded\n")
        self.assertIn("fixture-model", self.provider(value, "openai-api")["authenticatedModels"])
        self.assertTrue(any(row["host"] == "expanded.fixture.test" and row["key"] == "fixture-expanded" for row in value["requests"]))

    def test_managed_native_overlay_wins_without_backups(self):
        value = self.catalog("model:\n  provider: openai-api\n  default: fixture-model\n  base_url: https://user.fixture.test/v1\n",
                             dotenv="OPENAI_API_KEY=fixture-managed\n",
                             extra={"managed/config.yaml": "model:\n  base_url: https://managed.fixture.test/v1\n"})
        self.assertIn("fixture-model", self.provider(value, "openai-api")["authenticatedModels"])
        self.assertTrue(any(row["host"] == "managed.fixture.test" and row["key"] == "fixture-managed" for row in value["requests"]))
        self.assertFalse(any(row["host"] == "user.fixture.test" for row in value["requests"]))

    def test_openrouter_custom_base_url_does_not_leak_key_to_foreign_host(self):
        value = self.catalog("model:\n  provider: openrouter\n  default: fixture-model\n",
                             dotenv="CUSTOM_BASE_URL=https://foreign.fixture.test/v1\nOPENROUTER_API_KEY=sk-or-fixture-private\n")
        self.assertEqual(self.provider(value, "openrouter")["authenticatedModels"], [])
        self.assertFalse(any(row["host"] == "foreign.fixture.test" and row["key"] for row in value["requests"]))

    def test_canonically_equivalent_routes_reject_conflicting_provider_headers(self):
        value = self.catalog("providers:\n  first-route:\n    base_url: https://API.EXAMPLE.COM:443/v1/\n    api_key: fixture-first\n    extra_headers:\n      X-Route: first\n    models: [fixture-model]\n  second-route:\n    base_url: https://api.example.com/v1\n    api_key: fixture-second\n    extra_headers:\n      X-Route: second\n    models: [fixture-model]\n")
        for name in ["custom:first-route", "custom:second-route"]:
            row = self.provider(value, name)
            self.assertEqual(row["authenticatedModels"], [])
            self.assertIn("conflicting", row["unavailableReason"])
        self.assertFalse(any(request["host"] == "api.example.com" for request in value["requests"]))

    def test_custom_openrouter_alias_confirms_key_on_native_host(self):
        value = self.catalog("providers:\n  router-alias:\n    base_url: https://openrouter.ai/api/v1\n    api_key: sk-or-fixture-alias\n    models: [fixture-model]\n")
        self.assertIn("fixture-model", self.provider(value, "custom:router-alias")["authenticatedModels"])
        self.assertTrue(any(row["path"] == "/api/v1/key" and row["key"] == "sk-or-fixture-alias" for row in value["requests"]))

    def test_owned_codex_account_catalog_requires_known_live_expiry(self):
        for token, available in [("fixture-unknown", False), (fixture_jwt(time.time() - 1000), False),
                                 (fixture_jwt(time.time() + 3600), True)]:
            with self.subTest(available=available):
                value = self.catalog("model:\n  provider: openai-codex\n  default: fixture-codex\n",
                                     auth={"providers": {"openai-codex": {"tokens": {"access_token": token, "refresh_token": "fixture-refresh"}}}})
                self.assertEqual(self.provider(value, "openai-codex")["authenticatedModels"],
                                 ["fixture-codex"] if available else [])
                self.assertEqual(any(row["key"] == token for row in value["requests"]), available)

    def test_codex_singleton_cannot_bypass_same_token_dead_pool(self):
        token = fixture_jwt(time.time() + 3600)
        value = self.catalog("model:\n  provider: openai-codex\n  default: fixture-codex\n",
                             auth={"providers": {"openai-codex": {"tokens": {"access_token": token, "refresh_token": "fixture-refresh"}}},
                                   "credential_pool": {"openai-codex": [{"id": "dead", "source": "device_code", "auth_type": "oauth",
                                                                          "access_token": token, "last_status": "dead"}]}})
        self.assertEqual(self.provider(value, "openai-codex")["authenticatedModels"], [])
        self.assertFalse(any(row["key"] for row in value["requests"]))

    def test_custom_provider_uses_native_pool_before_config_credential(self):
        value = self.catalog("providers:\n  fixture-custom:\n    base_url: https://custom.fixture.test/v1\n    api_key: fixture-inline\n    models: [fixture-model]\n",
                             auth={"credential_pool": {"fixture-custom": [{"id": "manual", "source": "manual", "auth_type": "api_key",
                                                                              "access_token": "fixture-custom-pool", "base_url": "https://custom.fixture.test/v1"}]}})
        self.assertIn("fixture-model", self.provider(value, "custom:fixture-custom")["authenticatedModels"])
        self.assertTrue(any(row["host"] == "custom.fixture.test" and row["key"] == "fixture-custom-pool" for row in value["requests"]))
        self.assertFalse(any(row["key"] == "fixture-inline" for row in value["requests"]))

    def test_unknown_expired_oauth_and_corrupt_stores_never_refresh_or_repair(self):
        for token in ["fixture-unknown", fixture_jwt(time.time() - 1000)]:
            with self.subTest(token_kind="jwt" if token.startswith("fixture.ey") else "unknown"):
                value = self.catalog("model:\n  provider: xai-oauth\n  default: fixture-model\n",
                                     auth={"providers": {"xai-oauth": {"tokens": {"access_token": token, "refresh_token": "fixture-refresh"}}},
                                           "credential_pool": {"xai-oauth": [{"access_token": token, "refresh_token": "fixture-refresh", "auth_type": "oauth"}]}})
                self.assertEqual(self.provider(value, "xai-oauth")["authenticatedModels"], [])
                self.assertEqual([row for row in value["requests"] if row["key"]], [])
        value = self.catalog("model:\n  provider: openai-api\n  default: fixture-model\n", auth="{corrupt",
                             extra={"models_dev_cache.json": "{corrupt", "provider_models_cache.json": "{corrupt"})
        self.assertEqual(self.provider(value, "openai-api")["authenticatedModels"], [])
        self.assertTrue(self.provider(value, "openai-api")["models"])

    def test_custom_anthropic_headers_are_unavailable_before_catalog_authentication(self):
        for api_key in ["", "    api_key: fixture-anthropic-api\n"]:
            with self.subTest(has_api_key=bool(api_key)):
                value = self.catalog("providers:\n  custom-anthropic:\n    base_url: https://anthropic.fixture.test/v1\n"
                                     "    api_mode: anthropic_messages\n" + api_key +
                                     "    extra_headers:\n      X-Tenant: fixture-tenant\n    models: [fixture-model]\n")
                row = self.provider(value, "custom:custom-anthropic")
                self.assertIn("fixture-model", row["models"])
                self.assertEqual(row["authenticatedModels"], [])
                self.assertIn("does not forward", row["unavailableReason"])
                self.assertFalse(any(request["host"] == "anthropic.fixture.test" for request in value["requests"]))

    def test_claude_api_does_not_borrow_subscription_credentials(self):
        value = self.catalog("model:\n  provider: anthropic\n  default: fixture-model\n",
                             dotenv="ANTHROPIC_API_KEY=sk-ant-api-fixture\n")
        self.assertIn("fixture-model", self.provider(value, "anthropic")["authenticatedModels"])
        value = self.catalog("model:\n  provider: anthropic\n  default: fixture-model\n",
                             dotenv="ANTHROPIC_TOKEN=sk-ant-oat-fixture\n")
        self.assertEqual(self.provider(value, "anthropic")["authenticatedModels"], [])
        self.assertFalse(any(row["key"] for row in value["requests"]))

    def test_completed_provider_survives_unrelated_stalled_catalog(self):
        value = self.catalog("providers:\n  healthy:\n    base_url: https://healthy.fixture.test/v1\n    api_key: fixture-healthy\n  stalled:\n    base_url: https://stalled.fixture.test/v1\n    api_key: fixture-stalled\n", timeout="5000")
        self.assertIn("fixture-model", self.provider(value, "custom:healthy")["authenticatedModels"])
        self.assertEqual(self.provider(value, "custom:stalled")["authenticatedModels"], [])


if __name__ == "__main__":
    if sys.argv[1:] == ["--worker"]:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = worker()
        print(json.dumps(result))
    else:
        unittest.main()
