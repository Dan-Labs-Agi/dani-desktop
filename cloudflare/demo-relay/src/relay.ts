// Holds the company Anthropic key so a demo desktop never does: each person gets a revocable token with a budget, and
// every answer is on one model, whatever the caller asks for.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-haiku-5-5";
const MODEL_NAME = "Claude Haiku 5.5";
const DEFAULT_MAX_TOKENS = 8_000;
const MAX_TOKENS_CAP = 32_000;
const TOKEN = /^Bearer (omb_ai_[A-Za-z0-9_-]{43})$/;
const THINKING = "anthropic.thinking";
const REDACTED = "anthropic.redacted_thinking";

interface Kv {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}
export interface Env {
  ANTHROPIC_API_KEY: string;
  TOKENS: Kv;
  /** "1" pauses every token at once. */
  PAUSED?: string;
}
interface Ctx { waitUntil(promise: Promise<unknown>): void }
/** One person's demo access, stored under the SHA-256 of their token. */
export interface Grant { name: string; budgetUsd: number; spentUsd: number; off?: boolean }

type Json = Record<string, unknown>;
interface ChatMessage { role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: unknown; reasoning_details?: unknown }

class BadRequest extends Error {}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refuse = (status: number, code: string, message: string) => json(status, { error: { code, message, type: code } });

export async function tokenKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Haiku 5.5 list prices; a prompt over 100K tokens is billed at the higher rate. Cache writes ~1.25x, reads ~0.1x input. */
export function costUsd(usage: Anthropic.Usage): number {
  const written = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const [input, output] = usage.input_tokens + written + read > 100_000 ? [0.5, 2.5] : [0.1, 0.5];
  return (usage.input_tokens * input + written * input * 1.25 + read * input * 0.1 + usage.output_tokens * output) / 1e6;
}

const text = (content: unknown): string =>
  typeof content === "string" ? content
    : Array.isArray(content) ? content.map((part: Json) => (part?.type === "text" && typeof part.text === "string" ? part.text : "")).join("")
      : "";

function userBlocks(content: unknown): Anthropic.ContentBlockParam[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part: Json): Anthropic.ContentBlockParam[] => {
    if (part?.type === "text" && typeof part.text === "string") return part.text ? [{ type: "text", text: part.text }] : [];
    const url = part?.type === "image_url" ? (part.image_url as Json | undefined)?.url : undefined;
    if (typeof url !== "string") throw new BadRequest("unsupported content part");
    const data = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(url);
    if (data) return [{ type: "image", source: { type: "base64", media_type: data[1] as "image/png", data: data[2]! } }];
    if (url.startsWith("https://")) return [{ type: "image", source: { type: "url", url } }];
    throw new BadRequest("an image must be a data: or https: URL");
  });
}

function assistantBlocks(message: ChatMessage): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  // Signed thinking goes back first and unchanged, as the relay handed it out.
  for (const detail of Array.isArray(message.reasoning_details) ? message.reasoning_details as Json[] : []) {
    if (detail?.type === THINKING && typeof detail.thinking === "string" && typeof detail.signature === "string") {
      blocks.push({ type: "thinking", thinking: detail.thinking, signature: detail.signature });
    } else if (detail?.type === REDACTED && typeof detail.data === "string") {
      blocks.push({ type: "redacted_thinking", data: detail.data });
    }
  }
  const said = text(message.content);
  if (said) blocks.push({ type: "text", text: said });
  for (const call of Array.isArray(message.tool_calls) ? message.tool_calls as Json[] : []) {
    const fn = call?.function as Json | undefined;
    if (typeof call?.id !== "string" || typeof fn?.name !== "string") throw new BadRequest("invalid tool call");
    let input: unknown;
    try { input = JSON.parse(typeof fn.arguments === "string" && fn.arguments ? fn.arguments : "{}"); } catch { throw new BadRequest("tool call arguments are not JSON"); }
    blocks.push({ type: "tool_use", id: call.id, name: fn.name, input });
  }
  return blocks;
}

/** OpenAI chat-completions body to Messages API params. The model and its ceiling are the relay's, not the caller's. */
export function toMessages(body: Json): Anthropic.MessageCreateParamsNonStreaming {
  if (!Array.isArray(body.messages)) throw new BadRequest("messages must be an array");
  const system: string[] = [];
  const messages: Anthropic.MessageParam[] = [];
  const push = (role: "user" | "assistant", content: Anthropic.ContentBlockParam[]) => {
    if (!content.length) return;
    const last = messages.at(-1);
    if (last?.role === role) (last.content as Anthropic.ContentBlockParam[]).push(...content);
    else messages.push({ role, content });
  };
  for (const message of body.messages as ChatMessage[]) {
    if (message?.role === "system" || message?.role === "developer") system.push(text(message.content));
    else if (message?.role === "user") push("user", userBlocks(message.content));
    else if (message?.role === "assistant") push("assistant", assistantBlocks(message));
    else if (message?.role === "tool" && typeof message.tool_call_id === "string") {
      push("user", [{ type: "tool_result", tool_use_id: message.tool_call_id, content: text(message.content) || "(no output)" }]);
    } else throw new BadRequest("unsupported message");
  }
  const tools = Array.isArray(body.tools) ? (body.tools as Json[]).map((tool): Anthropic.Tool => {
    const fn = tool?.function as Json | undefined;
    if (tool?.type !== "function" || typeof fn?.name !== "string") throw new BadRequest("unsupported tool");
    return {
      name: fn.name,
      ...(typeof fn.description === "string" ? { description: fn.description } : {}),
      input_schema: (fn.parameters as Anthropic.Tool.InputSchema | undefined) ?? { type: "object" },
    };
  }) : [];
  const asked = Number(body.max_completion_tokens ?? body.max_tokens ?? DEFAULT_MAX_TOKENS);
  return {
    model: MODEL,
    max_tokens: Math.min(MAX_TOKENS_CAP, Number.isInteger(asked) && asked > 0 ? asked : DEFAULT_MAX_TOKENS),
    messages,
    ...(system.some(Boolean) ? { system: system.filter(Boolean).join("\n\n") } : {}),
    ...(tools.length ? { tools } : {}),
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
    cache_control: { type: "ephemeral" },
  };
}

const FINISH: Record<string, string> = { end_turn: "stop", stop_sequence: "stop", pause_turn: "stop", max_tokens: "length", model_context_window_exceeded: "length", tool_use: "tool_calls", refusal: "content_filter" };
const finish = (reason: string | null | undefined) => FINISH[reason ?? ""] ?? "stop";
const usageOf = (usage: Anthropic.Usage) => {
  const cached = usage.cache_read_input_tokens ?? 0;
  return {
    prompt_tokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + cached,
    completion_tokens: usage.output_tokens,
    total_tokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + cached + usage.output_tokens,
    prompt_tokens_details: { cached_tokens: cached },
  };
};

export function toCompletion(message: Anthropic.Message): Json {
  const said = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  const thought = message.content.flatMap((block) => (block.type === "thinking" ? [block.thinking] : [])).join("");
  const details = message.content.flatMap((block): Json[] =>
    block.type === "thinking" ? [{ type: THINKING, thinking: block.thinking, signature: block.signature }]
      : block.type === "redacted_thinking" ? [{ type: REDACTED, data: block.data }] : []);
  const calls = message.content.flatMap((block) =>
    block.type === "tool_use" ? [{ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input) } }] : []);
  return {
    id: message.id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: MODEL,
    choices: [{
      index: 0, finish_reason: finish(message.stop_reason),
      message: { role: "assistant", content: said || null, ...(thought ? { reasoning_content: thought } : {}), ...(details.length ? { reasoning_details: details } : {}), ...(calls.length ? { tool_calls: calls } : {}) },
    }],
    usage: usageOf(message.usage),
  };
}

/** Messages API stream events to chat-completions SSE lines. Usage comes last, as `stream_options.include_usage` asks. */
export async function* toChunks(events: AsyncIterable<Anthropic.RawMessageStreamEvent>, final: () => Promise<Anthropic.Message>): AsyncGenerator<string> {
  let id = "chatcmpl";
  let reason: string | null = null;
  const created = Math.floor(Date.now() / 1000);
  const tools = new Map<number, number>();
  const thinking = new Map<number, { thinking: string; signature: string }>();
  const chunk = (delta: Json, finishReason: string | null = null) =>
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: MODEL, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
  for await (const event of events) {
    if (event.type === "message_start") {
      id = event.message.id;
      yield chunk({ role: "assistant", content: "" });
    } else if (event.type === "content_block_start") {
      const block = event.content_block;
      if (block.type === "tool_use") {
        tools.set(event.index, tools.size);
        yield chunk({ tool_calls: [{ index: tools.get(event.index), id: block.id, type: "function", function: { name: block.name, arguments: "" } }] });
      } else if (block.type === "thinking") thinking.set(event.index, { thinking: "", signature: "" });
      else if (block.type === "redacted_thinking") yield chunk({ reasoning_details: [{ type: REDACTED, data: block.data }] });
    } else if (event.type === "content_block_delta") {
      const delta = event.delta;
      if (delta.type === "text_delta") yield chunk({ content: delta.text });
      else if (delta.type === "input_json_delta" && tools.has(event.index)) yield chunk({ tool_calls: [{ index: tools.get(event.index), function: { arguments: delta.partial_json } }] });
      else if (delta.type === "thinking_delta") {
        thinking.get(event.index)!.thinking += delta.thinking;
        yield chunk({ reasoning_content: delta.thinking });
      } else if (delta.type === "signature_delta") thinking.get(event.index)!.signature += delta.signature;
    } else if (event.type === "content_block_stop" && thinking.has(event.index)) {
      yield chunk({ reasoning_details: [{ type: THINKING, ...thinking.get(event.index)! }] });
    } else if (event.type === "message_delta") reason = event.delta.stop_reason;
  }
  yield chunk({}, finish(reason));
  const message = await final();
  yield `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: MODEL, choices: [], usage: usageOf(message.usage) })}\n\n`;
  yield "data: [DONE]\n\n";
}

// Read, add, write on KV: two calls finishing together can undercount one, and a reply the desktop cancels is not
// charged. A Durable Object per token makes it exact if demos ever run concurrently enough to matter.
async function spend(env: Env, key: string, usage: Anthropic.Usage): Promise<void> {
  const grant = await env.TOKENS.get(key, "json") as Grant | null;
  if (grant) await env.TOKENS.put(key, JSON.stringify({ ...grant, spentUsd: grant.spentUsd + costUsd(usage) }));
}

function upstreamFailure(error: unknown): Response {
  const status = error instanceof Anthropic.APIError ? error.status : undefined;
  // 429 means "paused" to the desktop, so Anthropic's own rate limit or overload is a plain retryable 503 here.
  return refuse(status === 400 ? 400 : 503, "upstream_error", status === 400 && error instanceof Error ? error.message : "Claude is unavailable right now; try again shortly.");
}

export function createRelay(client: (env: Env) => Pick<Anthropic, "messages">) {
  return {
    async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
      const url = new URL(request.url);
      const token = TOKEN.exec(request.headers.get("authorization") ?? "")?.[1];
      const key = token ? await tokenKey(token) : "";
      const grant = key ? await env.TOKENS.get(key, "json") as Grant | null : null;
      if (!grant || grant.off) return refuse(401, "invalid_api_key", "This demo key is not valid.");
      if (env.PAUSED === "1") return refuse(429, "paused", "Demo access is paused.");
      if (grant.spentUsd >= grant.budgetUsd) return refuse(402, "trial_credit_used_up", "This demo key's credit is used up.");
      if (request.method === "GET" && url.pathname === "/v1/models") {
        return json(200, { object: "list", data: [{ id: MODEL, object: "model", name: MODEL_NAME }] });
      }
      if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") return refuse(404, "not_found", "Not found.");
      let body: Json;
      let params: Anthropic.MessageCreateParamsNonStreaming;
      try {
        body = await request.json() as Json;
        params = toMessages(body);
      } catch (error) {
        return refuse(400, "invalid_request", error instanceof BadRequest ? error.message : "The request body is not JSON.");
      }
      const messages = client(env).messages;
      if (body.stream !== true) {
        try {
          const message = await messages.create(params);
          ctx.waitUntil(spend(env, key, message.usage));
          return json(200, toCompletion(message));
        } catch (error) {
          return upstreamFailure(error);
        }
      }
      const stream = messages.stream(params);
      const chunks = toChunks(stream, () => stream.finalMessage());
      let first: IteratorResult<string>;
      try {
        first = await chunks.next();
      } catch (error) {
        return upstreamFailure(error);
      }
      const encoder = new TextEncoder();
      const sse = new ReadableStream<Uint8Array>({
        start(controller) { if (!first.done) controller.enqueue(encoder.encode(first.value)); },
        async pull(controller) {
          try {
            const next = await chunks.next();
            if (next.done) {
              controller.close();
              ctx.waitUntil(stream.finalMessage().then((message) => spend(env, key, message.usage)));
            } else controller.enqueue(encoder.encode(next.value));
          } catch {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: "Claude stopped mid-reply; try again." } })}\n\n`));
            controller.close();
          }
        },
        cancel() { stream.abort(); },
      });
      return new Response(sse, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
    },
  };
}
