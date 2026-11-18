// A model behind an OpenAI-compatible chat endpoint, as the live tier needs it: one request, its tool calls, what it cost.
export interface ModelToolCall { id: string; name: string; arguments: string }
export interface ModelTool { name: string; description: string; parameters: Record<string, unknown> }
export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  calls?: ModelToolCall[];
  callId?: string;
}
export interface ModelTurn {
  text: string;
  calls: ModelToolCall[];
  usage: { inputTokens: number; outputTokens: number };
}
export interface ChatModel {
  complete(input: { messages: readonly ModelMessage[]; tools: readonly ModelTool[]; signal: AbortSignal }): Promise<ModelTurn>;
}

export interface EndpointOptions {
  url: string;
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  temperature?: number;
}

const loopback = (host: string) => host === "localhost" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/u.test(host);

/** The key travels only over HTTPS, or to a model on this machine. */
export function assertEndpoint(url: string): URL {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback(endpoint.hostname))) {
    throw new Error("The live tier sends its key only over HTTPS, or to a model on this machine.");
  }
  return endpoint;
}

const wireMessage = (message: ModelMessage) => message.role === "tool"
  ? { role: "tool", tool_call_id: message.callId, content: message.content ?? "" }
  : message.role === "assistant" && message.calls?.length
    ? { role: "assistant", content: message.content, tool_calls: message.calls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })) }
    : { role: message.role, content: message.content ?? "" };

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);

export function openAiChatModel(options: EndpointOptions): ChatModel {
  const base = assertEndpoint(options.url);
  const endpoint = `${base.href.replace(/\/+$/u, "")}/chat/completions`;
  return {
    async complete({ messages, tools, signal }) {
      const response = await fetch(endpoint, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({
          model: options.model,
          messages: messages.map(wireMessage),
          tools: tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
          max_tokens: options.maxOutputTokens ?? 1_024,
          ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        }),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`The model endpoint answered ${response.status}: ${body.slice(0, 300).split(options.apiKey).join("[key]")}`);
      let parsed: { choices?: Array<{ message?: { content?: unknown; tool_calls?: Array<{ id?: unknown; function?: { name?: unknown; arguments?: unknown } }> } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
      try { parsed = JSON.parse(body); } catch { throw new Error("The model endpoint did not answer with JSON."); }
      const message = parsed.choices?.[0]?.message;
      if (!message) throw new Error("The model endpoint answered with no message.");
      const calls = (message.tool_calls ?? []).flatMap((call, index) =>
        typeof call.function?.name === "string"
          ? [{ id: typeof call.id === "string" && call.id ? call.id : `call_${index}`, name: call.function.name, arguments: typeof call.function.arguments === "string" ? call.function.arguments : "{}" }]
          : []);
      return {
        text: typeof message.content === "string" ? message.content : "",
        calls,
        usage: { inputTokens: count(parsed.usage?.prompt_tokens), outputTokens: count(parsed.usage?.completion_tokens) },
      };
    },
  };
}
