import { isLoopback } from "./provider-key-check.ts";

export interface SetupModelsOptions { anonymous?: true; fetch?: typeof fetch; apiMode?: "anthropic_messages"; headers?: Readonly<Record<string, string>> }
export interface SetupModel {
  id: string;
  label: string;
  tools?: boolean;
  imageInput?: boolean;
  contextWindow?: number;
  orgBlocked?: true;
  privacyNotice?: string;
  mayTrainOnYourPrompts?: boolean;
  free?: boolean;
}

// Stateless onboarding probes: the caller owns consent for the metered call; credentials and replies are never logged.
export const API_ENDPOINTS = [
  { id: "openai", label: "OpenAI API", url: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "openrouter", label: "OpenRouter", url: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/settings/keys" },
  { id: "groq", label: "Groq", url: "https://api.groq.com/openai/v1", keyUrl: "https://console.groq.com/keys" },
  { id: "meta", label: "Meta Model API", url: "https://api.meta.ai/v1", keyUrl: "https://dev.meta.ai/" },
] as const;

export function normalizeApiUrl(value: string): string {
  const input = value.trim();
  const invalid = () => new Error("Enter an HTTPS API base URL without credentials, a query, or a fragment. HTTP is allowed only for localhost.");
  let url: URL;
  try { url = new URL(input); } catch { throw invalid(); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    // Reject invisible URL characters and ambiguous authority/path separators.
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0020\u007f\\?#]/u.test(input) || url.username || url.password ||
    input.slice(input.indexOf("://") + 3).split("/")[0]?.includes("@") ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && local))
  ) throw invalid();
  return url.href.replace(/\/+$/u, "");
}

class SetupApiError extends Error {}

function httpFailure(status: number, completion: boolean): SetupApiError {
  const prefix = `API returned HTTP ${status}.`;
  if (status === 401 || status === 403) return new SetupApiError(`${prefix} Check the API key and its access permissions.`);
  if (status === 402) return new SetupApiError(`${prefix} Check the provider's credits and billing settings.`);
  if (status === 429) return new SetupApiError(`${prefix} A rate or quota limit was reached. Check credits and limits, then try again later.`);
  if (status >= 300 && status < 400) return new SetupApiError(`${prefix} Redirects are not followed. Use the provider's direct API base URL.`);
  if (completion && [400, 404, 422].includes(status)) return new SetupApiError(`${prefix} Check the model ID and access, or choose a model that supports Chat Completions at this API URL.`);
  if (status === 404) return new SetupApiError(`${prefix} Check the API base URL: it must provide a /models endpoint.`);
  if (status >= 500) return new SetupApiError(`${prefix} The provider is unavailable. Try again later.`);
  return new SetupApiError(`${prefix} Check the API URL and provider settings, then try again.`);
}

export function apiSetupHeaders(key: string, configured: Readonly<Record<string, string>> = {}, anthropic = false): Record<string, string> {
  const headers = new Headers(key ? anthropic
    ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
    : { authorization: `Bearer ${key}` } : {});
  for (const [name, value] of Object.entries(configured)) headers.set(name, value);
  return Object.fromEntries(headers);
}

async function setupJson(url: string, key: string, body?: Record<string, unknown>, options: SetupModelsOptions = {}): Promise<unknown> {
  const normalized = normalizeApiUrl(url);
  const base = options.apiMode === "anthropic_messages" && !normalized.endsWith("/v1") ? `${normalized}/v1` : normalized;
  // Existing credentials are tested exactly as the runtime sends them, never silently repaired only here.
  const token = key;
  const anonymous = options.anonymous === true && body === undefined && isLoopback(new URL(base).hostname);
  const headerCredential = Object.entries(options.headers ?? {}).some(([name, value]) => /^(?:authorization|x-api-key)$/i.test(name) && value.length > 0);
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    // eslint-disable-next-line no-control-regex
    if (!/^[\w-]+$/.test(name) || /[\u0000-\u001f\u007f]/u.test(value)) throw new SetupApiError("The configured API headers are invalid.");
  }
  // Header credentials must not contain control characters or whitespace.
  // eslint-disable-next-line no-control-regex
  if ((!token && !anonymous && !headerCredential) || /[\u0000-\u0020\u007f]/u.test(token)) throw new SetupApiError("Enter a non-empty API key without spaces or line breaks.");
  const completion = body !== undefined;
  const operation = completion ? "The test reply" : "The model list";
  const timeoutMs = completion ? 30_000 : 8_000;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        // Anthropic defaults to 20 models per page; keep every page inside the same deadline.
        const paginated = !completion && options.apiMode === "anthropic_messages";
        let endpoint = `${base}${completion ? "/chat/completions" : "/models"}${paginated ? "?limit=1000" : ""}`;
        const rows: unknown[] | undefined = paginated ? [] : undefined;
        const cursors = paginated ? new Set<string>() : undefined;
        for (;;) {
          abort.signal.throwIfAborted();
          const response = await (options.fetch ?? fetch)(endpoint, {
            method: completion ? "POST" : "GET",
            headers: { ...apiSetupHeaders(token, options.headers, options.apiMode === "anthropic_messages"), ...(completion ? { "content-type": "application/json" } : {}) },
            ...(completion ? { body: JSON.stringify(body) } : {}),
            signal: abort.signal,
            redirect: "error",
          });
          if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            throw httpFailure(response.status, completion);
          }
          let payload: unknown;
          try { payload = await response.json(); }
          catch { throw new SetupApiError(`${operation} returned invalid JSON. Check that the API URL supports the OpenAI-compatible API.`); }
          if (!rows || !cursors) return payload;
          const page = record(payload);
          if (!Array.isArray(page?.data)) throw new SetupApiError("The model list returned invalid pagination data.");
          for (const row of page.data) rows.push(row);
          if (page.has_more !== true) return { ...page, data: rows };
          const cursor = page.last_id;
          if (typeof cursor !== "string" || !cursor.trim() || cursors.has(cursor)) {
            throw new SetupApiError("The model list returned an invalid or repeated pagination cursor.");
          }
          cursors.add(cursor);
          endpoint = `${base}/models?limit=1000&after_id=${encodeURIComponent(cursor)}`;
        }
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(new SetupApiError(`${operation} timed out after ${timeoutMs / 1000} seconds. Check the connection and try again.`));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof SetupApiError) throw error;
    // fetch errors can carry a URL, echoed credentials or provider content: expose neither message nor cause.
    throw new SetupApiError("Could not reach the API. Check the network and direct API URL; redirects are not followed.");
  } finally {
    clearTimeout(timer);
  }
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export async function fetchSetupModels(url: string, key: string, options: SetupModelsOptions = {}): Promise<SetupModel[]> {
  const json = record(await setupJson(url, key, undefined, options));
  const models = new Map<string, SetupModel>();
  for (const entry of Array.isArray(json?.data) ? json.data : []) {
    const item = record(entry);
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    // Model IDs and display labels reach the terminal; block control sequences.
    // eslint-disable-next-line no-control-regex
    if (!id || /[\u0000-\u001f\u007f]/u.test(id) || models.has(id)) continue;
    // eslint-disable-next-line no-control-regex
    const name = typeof item?.name === "string" ? item.name.replace(/[\u0000-\u001f\u007f]/gu, "").trim() : "";
    const capabilities = record(item?.capabilities);
    const supportedParameters = item?.supported_parameters;
    const explicitTools = typeof item?.tool_call === "boolean" ? item.tool_call
      : typeof item?.supports_tools === "boolean" ? item.supports_tools
      : typeof record(capabilities?.tools)?.supported === "boolean" ? record(capabilities?.tools)?.supported
      : Array.isArray(supportedParameters) ? supportedParameters.includes("tools") : undefined;
    const modalities = record(item?.modalities)?.input ?? record(item?.architecture)?.input_modalities;
    const contextWindow = item?.context_length ?? item?.context_window ?? record(item?.limit)?.context;
    const cost = record(item?.cost);
    const textCost = record(cost?.text);
    const prices = [record(item?.pricing)?.prompt ?? record(textCost?.input)?.price ?? cost?.input,
      record(item?.pricing)?.completion ?? record(textCost?.output)?.price ?? cost?.output];
    const knownPrices = prices.every(value => (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number.isFinite(Number(value)));
    models.set(id, { id, label: name || id,
      ...(typeof explicitTools === "boolean" ? { tools: explicitTools } : {}),
      ...(Array.isArray(modalities) ? { imageInput: modalities.includes("image") } : {}),
      ...(typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
      ...(item?.orgBlocked === true || item?.org_blocked === true || item?.disabled === true ? { orgBlocked: true as const } : {}),
      ...(typeof item?.privacyNotice === "string" ? { privacyNotice: item.privacyNotice } : {}),
      ...(typeof item?.mayTrainOnYourPrompts === "boolean" ? { mayTrainOnYourPrompts: item.mayTrainOnYourPrompts } : {}),
      ...(typeof item?.isFree === "boolean" ? { free: item.isFree } : knownPrices ? { free: prices.every(value => Number(value) === 0) } : {}),
    });
  }
  if (!models.size) throw new SetupApiError("The API returned no usable models. Check the API URL and model access, or enter a model ID from your provider manually.");
  return [...models.values()];
}

/** Call only after consent, passing the effective instance's provider routing. */
export async function verifySetupCompletion(url: string, key: string, model: string, provider?: string): Promise<void> {
  const id = model.trim();
  // Keep manually entered IDs safe to show in the terminal and saved setup.
  // eslint-disable-next-line no-control-regex
  if (!id || /[\u0000-\u001f\u007f]/u.test(id)) throw new SetupApiError("Choose a non-empty model ID without control characters.");
  const host = new URL(normalizeApiUrl(url)).hostname.toLowerCase();
  // The same OpenRouter-only provider pin as OpenAICompatDriver, without its environment overrides.
  const pinProvider = provider && (host === "openrouter.ai" || host.endsWith(".openrouter.ai"));
  const json = record(await setupJson(url, key, {
    model: id,
    messages: [{ role: "user", content: "Reply with exactly OK." }],
    stream: false,
    ...(pinProvider ? { provider: { order: [provider], allow_fallbacks: false } } : {}),
  }));
  const choice = record(Array.isArray(json?.choices) ? json.choices[0] : undefined);
  const message = record(choice?.message);
  if (message?.role !== "assistant" || typeof message.content !== "string" || !message.content.trim()) {
    throw new SetupApiError("The API did not return an assistant text reply. Choose a model that supports Chat Completions, then try again.");
  }
}
