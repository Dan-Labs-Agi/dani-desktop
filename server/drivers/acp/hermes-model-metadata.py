"""Read native model metadata without constructing an agent, refreshing auth or writing native state."""
from __future__ import annotations

import contextlib
import io
import json
import os
from pathlib import Path
import sys
import queue
import threading
import time

STARTED = time.monotonic()

sys.dont_write_bytecode = True


def object_value(value):
    return value if isinstance(value, dict) else {}


def read_json(path):
    try:
        return object_value(json.loads(path.read_text(encoding="utf-8-sig")))
    except (OSError, ValueError):
        return {}



class ReadonlyCredentialPool:
    """A native-deserialized snapshot, not a CredentialPool with mutation flags disabled.

    Native select/peek/availability can refresh, resync, prune, persist and take file locks.
    Only native pure status/cooldown/expiry primitives are used here; discovery never rotates.
    """
    def __init__(self, provider, entries):
        import agent.credential_pool as native
        self.provider = provider
        self._native = native
        self._entries = sorted(entries, key=lambda entry: entry.priority)
        self._strategy = native.get_pool_strategy(provider)

    def has_credentials(self):
        return bool(self._entries)

    def entries(self, *, model=None):
        native = self._native
        now = time.time()
        sole = sum(entry.last_status != native.STATUS_DEAD for entry in self._entries) <= 1
        available = []
        for entry in self._entries:
            if not entry.runtime_api_key or entry.last_status == native.STATUS_DEAD:
                continue
            if native.model_cooldown_until(entry, model) is not None:
                continue
            until = native._exhausted_until(entry, sole_credential=sole)
            if until is not None and now < until:
                continue
            if self.provider == "openai-codex" or entry.auth_type == native.AUTH_TYPE_OAUTH:
                # Only Codex has a separate account-catalog path. Unknown expiry is not evidence
                # of an authorized session, even when native refresh heuristics tolerate it.
                expiry = native._decode_jwt_claims(entry.access_token).get("exp")
                if self.provider != "openai-codex" or not isinstance(expiry, (int, float)):
                    continue
                if native._codex_access_token_is_expiring(entry.access_token, native.CODEX_ACCESS_TOKEN_REFRESH_SKEW_SECONDS):
                    continue
            available.append(entry)
        return available

    def select(self, *, model=None):
        available = self.entries(model=model)
        if not available:
            return None
        if self._strategy == self._native.STRATEGY_RANDOM:
            return self._native.random.choice(available)
        if self._strategy == self._native.STRATEGY_LEAST_USED:
            return min(available, key=lambda entry: entry.request_count)
        # The first round-robin choice is native priority order, without committing a rotation.
        return available[0]

    def peek(self):
        return self.select()

def account_models():
    # Native active-store normalization, but never the native pool's mutating selection path.
    from agent.credential_pool import load_pool
    entry = load_pool("openai-codex").select()
    token = entry.access_token if entry else ""
    if not token:
        return []
    try:
        import httpx
        from agent.model_metadata import CODEX_MODELS_CATALOG_URL
        from hermes_cli.codex_models import _extract_chatgpt_account_id, _ranked_slugs
        headers = {"Authorization": "Bearer " + token}
        account = _extract_chatgpt_account_id(token)
        if account:
            headers["ChatGPT-Account-Id"] = account
        response = httpx.get(CODEX_MODELS_CATALOG_URL, headers=headers, timeout=10, follow_redirects=False)
        if response.status_code != 200:
            return []
        rows = object_value(response.json()).get("models")
        # Deliberately omit native forward-compat synthesis: only account-advertised choices confer access.
        return _ranked_slugs(rows) if isinstance(rows, list) else []
    except Exception:
        return []


def metadata():
    if os.environ.get("DANI_DISABLE_OS_CREDENTIALS") == "1":
        from agent import anthropic_credentials
        anthropic_credentials._read_claude_code_credentials_from_keychain = lambda: None
    home = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes")))
    # Native readers repair/quarantine corrupt files. Metadata must not: use read-only snapshots
    # while retaining the native provider/token/catalog normalization on top of those snapshots.
    import agent.models_dev as models_dev
    registry = read_json(home / "models_dev_cache.json")
    models_dev._load_disk_cache = lambda: registry
    models_dev.fetch_models_dev = lambda *args, **kwargs: registry
    import hermes_cli.auth as auth
    auth._load_auth_store = lambda auth_file=None: read_json(Path(auth_file) if auth_file else home / "auth.json")
    import hermes_cli.config as native_config
    from urllib.parse import urlsplit
    # Reuse native parsing and the exact pure load pipeline, omitting home creation, backups
    # and corrupt-file recovery. Dotenv expansion changes this disposable process, never files.
    from copy import deepcopy
    from hermes_cli.env_loader import _DOTENV_PASSES, _load_dotenv_with_fallback
    from hermes_cli.managed_scope import get_managed_dir
    load_pass = next(_DOTENV_PASSES)
    dotenv = home / ".env"
    if dotenv.is_file():
        _load_dotenv_with_fallback(dotenv, override=True, load_pass=load_pass)
    managed_dir = get_managed_dir()
    if managed_dir and (managed_dir / ".env").is_file():
        _load_dotenv_with_fallback(managed_dir / ".env", override=True, load_pass=load_pass)
    raw_config = native_config.read_raw_config()
    config = native_config._deep_merge(deepcopy(native_config.DEFAULT_CONFIG), raw_config)
    config = native_config._canonicalize_config(config)
    config, _ = native_config._merge_managed_overlay(native_config._expand_env_vars(config))
    native_config.load_config = lambda: config
    native_config.load_config_readonly = lambda: config
    import agent.credential_pool as credential_pools
    def readonly_zai_base_url(api_key, default_url, env_override):
        # Native Z.AI resolution's read-only prefix: same explicit override and key-hashed
        # active-store cache. A cache miss must not run its inference autodetection or persist.
        if env_override:
            return env_override
        if api_key:
            import hashlib
            state = auth._load_provider_state(auth._load_auth_store(), "zai") or {}
            cached = state.get("detected_endpoint")
            key_hash = hashlib.sha256(api_key.encode()).hexdigest()[:16]
            if isinstance(cached, dict) and cached.get("base_url") and cached.get("key_hash", "") == key_hash:
                return cached["base_url"]
        return default_url

    auth._API_KEY_BASE_URL_RESOLVERS["zai"] = readonly_zai_base_url
    credential_pools._ENV_BASE_URL_RESOLVERS["zai"] = readonly_zai_base_url

    def readonly_pool(provider):
        entries = []
        for payload in auth.read_credential_pool(provider):
            if not isinstance(payload, dict):
                continue
            try:
                clean = credential_pools.sanitize_borrowed_credential_payload(payload, provider)
                entries.append(credential_pools.PooledCredential.from_dict(provider, clean))
            except (TypeError, ValueError):
                continue
        # Persisted env rows are references. Hydrate only those existing rows with the native
        # in-memory transform; don't seed foreign singleton/CLI credentials or create new rows.
        sources = {entry.source for entry in entries}
        if any(source.startswith("env:") for source in sources):
            credential_pools._seed_from_env(provider, entries)
            entries = [entry for entry in entries if entry.source in sources]
        if provider == "openai-codex":
            # This native transform reads only the active Hermes snapshot, never ~/.codex or
            # a refreshing reader. It also preserves suppression and same-token cooldowns.
            credential_pools._seed_tokens_singleton(credential_pools._Seeder(provider, entries), auth._load_auth_store())
        return ReadonlyCredentialPool(provider, entries)
    credential_pools.load_pool = readonly_pool
    from hermes_cli.models_catalog_static import _PROVIDER_MODELS, _PROVIDER_LABELS, OPENROUTER_MODELS
    from hermes_cli.auth import PROVIDER_REGISTRY
    from hermes_cli.config import get_env_value_prefer_dotenv
    from hermes_cli.config_providers import get_compatible_custom_providers, is_provider_enabled
    from hermes_cli.route_identity import normalize_route_base_url
    from hermes_cli.model_switch import _declared_model_ids
    from hermes_cli.models import probe_api_models
    from agent.models_dev import get_model_info
    import hermes_cli.runtime_provider as runtime_provider
    runtime_provider.load_pool = readonly_pool

    def readonly_anthropic_token(*, model=None):
        # Native runtime endpoint/protocol resolution is retained; only its foreign/refreshing
        # token fallback is replaced with the native API-key reader over our snapshot.
        key = auth._resolve_api_key_provider_secret("anthropic", PROVIDER_REGISTRY["anthropic"])[0]
        if not key:
            raise auth.AuthError("No API credential is available without refreshing authentication.")
        return key

    runtime_provider._anthropic_token_or_raise = readonly_anthropic_token

    catalogs = dict(_PROVIDER_MODELS)
    catalogs["openrouter"] = [model for model, _ in OPENROUTER_MODELS]
    if "openai" in catalogs and "openai-api" in PROVIDER_REGISTRY:
        catalogs["openai-api"] = list(dict.fromkeys([*catalogs.get("openai-api", []), *catalogs.pop("openai")]))
    try:
        opencode_free = set(json.loads(os.environ.get("DANI_HERMES_OPENCODE_FREE_MODELS", "[]")))
    except (ValueError, TypeError):
        opencode_free = set()
    for provider, row in read_json(home / "provider_models_cache.json").items():
        models = object_value(row).get("models")
        if isinstance(models, list) and isinstance(provider, str) and ":" not in provider:
            catalogs[provider] = list(dict.fromkeys([*catalogs.get(provider, []), *[model for model in models if isinstance(model, str)]]))

    unsupported_headers_reason = "The native Anthropic constructor does not forward custom provider headers; this route cannot be used safely."

    def probe(provider, label, models, endpoint, key, mode, credential_env=(), entry=None):
        entry = entry or {}
        result = {"id": provider, "label": label, "models": list(models), "authenticatedModels": [],
                  "toolModels": [], "credentialEnv": list(credential_env), "unavailableModels": {}}
        if provider.startswith("custom:") and mode == "anthropic_messages" and entry.get("extra_headers"):
            result["unavailableReason"] = unsupported_headers_reason
            return result
        try:
            url = urlsplit(endpoint)
            local = url.hostname in {"127.0.0.1", "localhost", "::1"}
            if url.username or url.password or url.query or url.fragment or (url.scheme != "https" and not (url.scheme == "http" and local)):
                return result
            if local and url.port in {4187, 4190}:
                result["toolDiscardingProxy"] = url.port == 4187
                result["unavailableReason"] = ("This agent proxy discards tool calls." if url.port == 4187
                                               else "This router silently fails over even explicit model selectors.")
            claude_subscription = (key.startswith("sk-ant-") and not key.startswith("sk-ant-api")) or (
                url.hostname == "api.anthropic.com" and key.startswith(("eyJ", "cc-")))
            if claude_subscription:
                result["unavailableReason"] = "Claude subscription credentials cannot be used by this third-party harness. Configure a Claude API key or supported inference provider."
                return result
            if not key and not local:
                return result
            if provider == "anthropic":
                # API-key catalog authentication follows the native Anthropic transport.
                from hermes_cli.models import _fetch_anthropic_models, _anthropic_models_url
                found = {"models": _fetch_anthropic_models(timeout=2, base_url=endpoint, api_key=key),
                         "probed_url": _anthropic_models_url(endpoint)}
            else:
                found = probe_api_models(key or None, endpoint, timeout=2, api_mode=mode,
                                         request_headers=entry.get("extra_headers"))
            live = found.get("models")
            if not isinstance(live, list):
                return result
            result["models"] = list(dict.fromkeys([*live, *models]))
            if result.get("unavailableReason"):
                return result
            free_tier = False
            if not local:
                import httpx
                auth_url = None
                if url.hostname == "openrouter.ai":
                    auth_url = "https://openrouter.ai/api/v1/key"
                elif provider == "kilocode" and url.hostname in {"api.kilo.ai", "ai-gateway.kilo.ai"}:
                    # Kilo-Org/kilocode packages/kilo-gateway/src/api/{profile,constants}.ts.
                    auth_url = "https://api.kilo.ai/api/profile"
                elif provider in {"opencode-zen", "opencode-go"} and url.hostname == "opencode.ai":
                    # OpenCode's Go usage endpoint validates the same workspace API keys without inference.
                    auth_url = "https://opencode.ai/zen/go/v1/usage"
                if auth_url:
                    response = httpx.get(auth_url, headers={"Authorization": "Bearer " + key}, timeout=2, follow_redirects=False)
                    payload = object_value(response.json())
                    free_tier = url.hostname == "openrouter.ai" and object_value(payload.get("data")).get("is_free_tier") is True
                    auth_ok = response.status_code == 200
                    if provider == "opencode-zen" and response.status_code == 403:
                        auth_ok = object_value(payload.get("error")).get("type") == "EntitlementError"
                    if provider == "opencode-go" and auth_ok:
                        auth_ok = not any(object_value(value).get("status") == "rate-limited"
                                          for value in object_value(payload.get("usage")).values())
                else:
                    anonymous = httpx.get(found["probed_url"], headers={"anthropic-version": "2023-06-01"} if mode == "anthropic_messages" else {},
                                          timeout=2, follow_redirects=False)
                    auth_ok = anonymous.status_code in {401, 403}
                if not auth_ok:
                    result["unavailableReason"] = "The provider has not confirmed these credentials or the required subscription. Public model listing is not authorization."
                    return result
            # A configured credential is scoped to this exact native provider/endpoint. Listing alone
            # never supplies a missing key or grants client-only/free routes access.
            blocked = lambda model: (url.hostname == "opencode.ai" and (model.endswith("-free") or model in opencode_free)) or (free_tier and not model.endswith(":free"))
            result["authenticatedModels"] = [model for model in live if not blocked(model)]
            capabilities = object_value(entry.get("capabilities"))
            declared = object_value(entry.get("models"))
            catalog_provider = entry.get("catalog_provider") or provider
            if url.hostname == "opencode.ai":
                catalog_provider = entry.get("catalog_provider") or ("opencode-go" if "/zen/go" in url.path else "opencode-zen")
            for model in result["models"]:
                model_config = object_value(declared.get(model))
                explicit = model_config.get("supports_tools", capabilities.get("supports_tools"))
                info = get_model_info(catalog_provider, model, allow_network=False)
                free_info = get_model_info("opencode-zen", model, allow_network=False) if url.hostname == "opencode.ai" else None
                restricted_free = free_info is not None and free_info.cost_input == 0 and free_info.cost_output == 0
                if blocked(model) or restricted_free:
                    if model in result["authenticatedModels"]:
                        result["authenticatedModels"].remove(model)
                    result["unavailableModels"][model] = "This account or restricted free route has no confirmed entitlement for this model; no paid-key fallback is allowed."
                elif explicit is False or (explicit is None and info is not None and info.tool_call is False):
                    result["unavailableModels"][model] = "Native provider configuration disables tool calls for this model."
                if explicit is True or (explicit is None and info is not None and info.tool_call):
                    result["toolModels"].append(model)
        except Exception:
            pass
        return result

    def codex_provider():
        visible = account_models()
        return {"id": "openai-codex", "label": "Codex",
                "models": list(dict.fromkeys([*visible, *catalogs.get("openai-codex", [])])),
                "authenticatedModels": visible, "toolModels": visible, "credentialEnv": []}

    jobs = [(codex_provider, ())]
    fallback = [{"id": "openai-codex", "label": "Codex", "models": catalogs.get("openai-codex", []),
                 "authenticatedModels": [], "toolModels": [], "credentialEnv": []}]
    for provider, models in catalogs.items():
        if provider in {"openai-codex", "copilot-acp", "moa"}:
            continue
        native = PROVIDER_REGISTRY.get(provider)
        env_names = tuple(native.api_key_env_vars) if native else (("OPENROUTER_API_KEY",) if provider == "openrouter" else ())
        endpoint, key, mode = "", "", "chat_completions"
        runtime = {}
        model_config = object_value(config.get("model"))
        configured_provider = str(model_config.get("provider") or "auto").strip().lower()
        if model_config.get("provider") == provider:
            pointer = model_config.get("key_env") or model_config.get("api_key_env")
            if isinstance(pointer, str) and pointer:
                env_names = tuple(dict.fromkeys([pointer, *env_names]))
        try:
            if native and native.auth_type != "api_key":
                # OAuth, exchanges, external processes and ADC must never enter the runtime
                # credential ladder for generic API catalog discovery. Codex is handled above.
                pass
            elif provider == "copilot":
                pass
            elif provider == "azure-foundry" and model_config.get("provider") == provider and model_config.get("auth_mode", "api_key") != "api_key":
                pass
            elif provider == "anthropic":
                declared_key = auth._resolve_api_key_provider_secret(provider, native)[0] if native else ""
                subscription = get_env_value_prefer_dotenv("ANTHROPIC_TOKEN") or get_env_value_prefer_dotenv("CLAUDE_CODE_OAUTH_TOKEN")
                if subscription:
                    key = subscription
                    endpoint = "https://api.anthropic.com"
                elif declared_key:
                    runtime = runtime_provider.resolve_runtime_provider(requested=provider, target_model=model_config.get("default") if model_config.get("provider") == provider else None)
                    key, endpoint, mode = runtime.get("api_key") or "", runtime.get("base_url") or "", runtime.get("api_mode") or mode
            elif native or provider == "openrouter":
                runtime = runtime_provider.resolve_runtime_provider(requested=provider, target_model=model_config.get("default") if model_config.get("provider") == provider else None)
                key, endpoint, mode = runtime.get("api_key") or "", runtime.get("base_url") or "", runtime.get("api_mode") or mode
        except Exception:
            key = ""
        if not isinstance(key, str) or not isinstance(endpoint, str):
            key, endpoint = "", ""
        if runtime and runtime.get("provider") != provider and configured_provider != provider:
            # Native global auto/custom bypasses belong to the selected route, not every
            # unrelated registry row enumerated by this inventory.
            key = ""
        if provider == "openrouter" and configured_provider not in {"auto", "openrouter"} and key:
            # Native execution may deliberately fall back from OPENROUTER_API_KEY to
            # OPENAI_API_KEY. An unrelated inventory row is not that execution request:
            # it cannot send another provider's key (or generic CUSTOM_BASE_URL) to OpenRouter.
            pool_entries = readonly_pool("openrouter").entries()
            declared_keys = {entry.runtime_api_key for entry in pool_entries}
            declared_keys.add(get_env_value_prefer_dotenv("OPENROUTER_API_KEY") or "")
            declared_endpoints = {
                normalize_route_base_url(runtime_provider.OPENROUTER_BASE_URL),
                normalize_route_base_url(get_env_value_prefer_dotenv("OPENROUTER_BASE_URL")),
                *[normalize_route_base_url(entry.runtime_base_url) for entry in pool_entries],
            }
            if key not in declared_keys or normalize_route_base_url(endpoint) not in declared_endpoints:
                key = ""
        admitted_env = tuple(name for name in env_names if key and get_env_value_prefer_dotenv(name) == key)
        args = (provider, _PROVIDER_LABELS.get(provider, provider), models, endpoint, key, mode, admitted_env, {})
        jobs.append((probe, args))
        fallback.append({"id": provider, "label": args[1], "models": list(models), "authenticatedModels": [], "credentialEnv": list(admitted_env)})
    def enabled_entry(entry):
        name = str(entry.get("provider_key") or entry.get("name") or "")
        return bool(name) and entry.get("enabled") is not False and is_provider_enabled(object_value(object_value(config.get("providers")).get(name)))

    entries = [entry for entry in get_compatible_custom_providers(config) if enabled_entry(entry)]
    signatures = {}
    for entry in entries:
        endpoint = normalize_route_base_url(entry.get("base_url"))
        signature = json.dumps([entry.get("extra_headers") or {}, entry.get("extra_body") or {}], sort_keys=True)
        signatures.setdefault(endpoint, set()).add(signature)
    for entry in entries:
        name = str(entry.get("provider_key") or entry.get("name") or "")
        if not name or not is_provider_enabled(object_value(object_value(config.get("providers")).get(name))):
            continue
        env_name = entry.get("key_env")
        key, endpoint = "", entry.get("base_url", "")
        mode = entry.get("api_mode") or runtime_provider._detect_api_mode_for_url(endpoint)
        unsupported_headers = mode == "anthropic_messages" and bool(entry.get("extra_headers"))
        if not entry.get("key_cmd") and not unsupported_headers:
            try:
                runtime = runtime_provider.resolve_runtime_provider(requested="custom:" + name, target_model=entry.get("model"))
                key, endpoint, mode = runtime.get("api_key") or "", runtime.get("base_url") or "", runtime.get("api_mode") or mode
                if key == "no-key-required":
                    key = ""
            except Exception:
                key = ""
        if not isinstance(key, str):
            key = ""
        declared = _declared_model_ids(entry.get("models"))
        if entry.get("model") and entry["model"] not in declared:
            declared.append(entry["model"])
        record = {"id": "custom:" + name, "label": str(entry.get("name") or name), "models": declared,
                  "authenticatedModels": [], "credentialEnv": [env_name] if env_name and key and get_env_value_prefer_dotenv(env_name) == key else []}
        if len(signatures.get(normalize_route_base_url(entry.get("base_url")), set())) > 1:
            record["unavailableReason"] = "This endpoint has conflicting configured header or provider-routing identities."
        elif unsupported_headers or (mode == "anthropic_messages" and entry.get("extra_headers")):
            record["unavailableReason"] = unsupported_headers_reason
        elif entry.get("key_cmd") or (not key and env_name):
            record["unavailableReason"] = "The configured credential is unavailable without running a command or refreshing authentication."
        if record.get("unavailableReason"):
            jobs.append((lambda value: value, (record,)))
        else:
            jobs.append((probe, (record["id"], record["label"], declared, endpoint, key,
                                 mode, tuple(record["credentialEnv"]), entry)))
        fallback.append(record)

    pending = queue.Queue()
    completed = queue.Queue()
    for index, job in enumerate(jobs):
        pending.put((index, job))
    def worker():
        while True:
            try:
                index, (call, args) = pending.get_nowait()
            except queue.Empty:
                return
            try:
                completed.put((index, call(*args)))
            except Exception:
                completed.put((index, fallback[index]))
    for _ in range(min(8, len(jobs))):
        threading.Thread(target=worker, daemon=True).start()
    # Unrelated slow endpoints cannot erase an already-discovered account catalog. Daemon readers
    # terminate with this metadata-only process; no agents, refreshes or file writers are running.
    try:
        timeout = float(os.environ.get("HERMES_ACP_MODELS_TIMEOUT_MS", "15000")) / 1000
    except ValueError:
        timeout = 15
    deadline = STARTED + min(12, max(0.1, timeout - 2))
    remaining = len(jobs)
    while remaining and time.monotonic() < deadline:
        try:
            index, value = completed.get(timeout=max(0.01, deadline - time.monotonic()))
        except queue.Empty:
            break
        fallback[index] = value
        remaining -= 1
    return {"providers": fallback}


if __name__ == "__main__":
    # Native imports must never leak diagnostics, endpoints with credentials, or token material to stdout.
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = metadata()
    except Exception:
        result = {"providers": []}
    print(json.dumps(result, separators=(",", ":")))
