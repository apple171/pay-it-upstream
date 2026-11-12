// AG Studio LLM adapter for Anthropic Claude. Runs in the browser and posts to this app's own
// /api/ai/claude route, which holds the key. Maps Studio's turn request to a Messages API body
// (native tool use), and the API's stream events back to Studio's events and final response.
import type {
  AgAiConversationItem,
  AgAiEvent,
  AgAiOutputItem,
  AgAiUsage,
  AgLlmAdapter,
  AgLlmRequest,
  AgLlmResponse,
} from "ag-studio";
import type {
  ContentBlockParam,
  MessageParam,
  RawMessageStreamEvent,
  StopReason,
  Tool,
  ToolChoice,
} from "@anthropic-ai/sdk/resources/messages";

type Json = Record<string, unknown>;

// Thinking blocks must go back with their signature while a tool loop continues. Kept per tab.
const thinking = new Map<string, { thinking: string; signature: string }>();

const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const parse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};

// Studio marks optional values with a `{ not: {} }` branch inside anyOf; drop it.
function cleanSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  if (!isObject(schema)) return schema;
  const out: Json = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "$schema") continue;
    if (k === "anyOf" && Array.isArray(v)) {
      const branches = v.filter((b) => !(isObject(b) && isObject(b.not) && Object.keys(b).length === 1));
      if (branches.length === 1 && isObject(branches[0])) Object.assign(out, cleanSchema(branches[0]));
      else out.anyOf = branches.map(cleanSchema);
      continue;
    }
    out[k] = cleanSchema(v);
  }
  return out;
}

function encodeMessages(items: AgAiConversationItem[]) {
  const system: string[] = [];
  const messages: (MessageParam & { content: ContentBlockParam[] })[] = [];
  const push = (role: "user" | "assistant", block: ContentBlockParam) => {
    const last = messages.at(-1);
    if (last?.role === role) last.content.push(block);
    else messages.push({ role, content: [block] });
  };

  for (const item of items) {
    if (item.type === "message" && item.kind === "input") {
      const text = item.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
      if (item.role === "system") system.push(text);
      else if (text) push("user", { type: "text", text });
    } else if (item.type === "message") {
      const text = item.content.map((c) => (c.type === "text" ? c.text : c.refusal)).join("\n");
      if (text) push("assistant", { type: "text", text });
    } else if (item.type === "reasoning") {
      const t = thinking.get(item.id);
      if (t) push("assistant", { type: "thinking", ...t });
    } else if (item.type === "function_call") {
      const input = parse(item.arguments || "{}");
      push("assistant", { type: "tool_use", id: item.callId, name: item.name, input: isObject(input) ? input : {} });
    } else if (item.type === "function_call_output") {
      push("user", { type: "tool_result", tool_use_id: item.callId, content: item.output });
    }
  }
  return { system, messages };
}

function encodeRequest(request: AgLlmRequest) {
  const { system, messages } = encodeMessages(request.input);
  if (request.instructions) system.unshift(request.instructions);
  const tools: Tool[] = (request.tools ?? [])
    .filter((t) => t.kind !== "provided")
    .map((t) => ({ name: t.name, description: t.description, input_schema: cleanSchema(t.parameters) as Tool.InputSchema }));
  const c = request.toolChoice;
  const tool_choice: ToolChoice | undefined = !c
    ? undefined
    : c === "auto"
      ? { type: "auto" }
      : c === "none"
        ? { type: "none" }
        : c === "required"
          ? { type: "any" }
          : { type: "tool", name: c.name };
  const format = request.responseFormat;
  return {
    messages,
    ...(system.length && { system: system.join("\n\n") }),
    ...(tools.length && { tools, ...(tool_choice && { tool_choice }) }),
    ...(format?.type === "json" && { output_config: { format: { type: "json_schema", schema: cleanSchema(format.schema) } } }),
  };
}

type Open =
  | { kind: "text"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string; signature: string }
  | { kind: "tool"; id: string; name: string; json: string };

/** Turns the Messages API's stream events into Studio events, collecting the final response. */
class Translator {
  output: AgAiOutputItem[] = [];
  usage: AgAiUsage = { inputTokens: 0, outputTokens: 0 };
  id?: string;
  model?: string;
  stop?: StopReason | null;
  error?: string;
  private open = new Map<number, Open>();

  event(e: RawMessageStreamEvent | { type: "error"; error?: { message?: string } } | { type: "ping" }): AgAiEvent[] {
    switch (e.type) {
      case "message_start":
        this.id = e.message.id;
        this.model = e.message.model;
        this.usage.inputTokens = e.message.usage?.input_tokens ?? 0;
        return [];
      case "content_block_start": {
        const b = e.content_block;
        if (b.type === "text") {
          this.open.set(e.index, { kind: "text", id: newId("msg"), text: "" });
          return [{ type: "TEXT_MESSAGE_START", messageId: this.open.get(e.index)!.id, role: "assistant" }];
        }
        if (b.type === "thinking") {
          this.open.set(e.index, { kind: "thinking", id: newId("rs"), text: "", signature: "" });
          return [{ type: "REASONING_MESSAGE_START", messageId: this.open.get(e.index)!.id, role: "reasoning" }];
        }
        if (b.type === "tool_use") {
          this.open.set(e.index, { kind: "tool", id: b.id, name: b.name, json: "" });
          return [{ type: "TOOL_CALL_START", toolCallId: b.id, toolCallName: b.name }];
        }
        return [];
      }
      case "content_block_delta": {
        const o = this.open.get(e.index);
        const d = e.delta;
        if (o?.kind === "text" && d.type === "text_delta") {
          o.text += d.text;
          return [{ type: "TEXT_MESSAGE_CONTENT", messageId: o.id, delta: d.text }];
        }
        if (o?.kind === "thinking" && d.type === "thinking_delta") {
          o.text += d.thinking;
          return [{ type: "REASONING_MESSAGE_CONTENT", messageId: o.id, delta: d.thinking }];
        }
        if (o?.kind === "thinking" && d.type === "signature_delta") o.signature += d.signature;
        if (o?.kind === "tool" && d.type === "input_json_delta") {
          o.json += d.partial_json;
          return [{ type: "TOOL_CALL_ARGS", toolCallId: o.id, delta: d.partial_json }];
        }
        return [];
      }
      case "content_block_stop": {
        const o = this.open.get(e.index);
        this.open.delete(e.index);
        if (o?.kind === "text") {
          this.output.push({ id: o.id, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: o.text, annotations: [] }] });
          return [{ type: "TEXT_MESSAGE_END", messageId: o.id }];
        }
        if (o?.kind === "thinking") {
          if (o.signature) thinking.set(o.id, { thinking: o.text, signature: o.signature });
          this.output.push({ id: o.id, kind: "output", type: "reasoning", summary: [{ type: "summary", text: o.text }] });
          return [{ type: "REASONING_MESSAGE_END", messageId: o.id }];
        }
        if (o?.kind === "tool") {
          this.output.push({ id: o.id, kind: "output", type: "function_call", callId: o.id, name: o.name, arguments: o.json || "{}", status: "completed" });
          return [{ type: "TOOL_CALL_END", toolCallId: o.id }];
        }
        return [];
      }
      case "message_delta":
        this.stop = e.delta.stop_reason;
        this.usage.outputTokens = e.usage.output_tokens;
        if (e.usage.input_tokens != null) this.usage.inputTokens = e.usage.input_tokens;
        return [];
      case "error":
        this.error = e.error?.message ?? "The AI service returned an error.";
        return [];
      default:
        return [];
    }
  }

  response(): AgLlmResponse {
    const incomplete =
      this.stop === "max_tokens" || this.stop === "model_context_window_exceeded"
        ? "max_output_tokens"
        : this.stop === "refusal"
          ? "content_filter"
          : undefined;
    return {
      id: this.id ?? newId("resp"),
      createdAt: Date.now(),
      model: this.model,
      output: this.output,
      usage: { ...this.usage, totalTokens: this.usage.inputTokens + this.usage.outputTokens },
      status: this.error ? "failed" : incomplete ? "incomplete" : "completed",
      error: this.error ? { code: "claude_error", message: this.error } : undefined,
      incompleteDetails: incomplete ? { reason: incomplete } : undefined,
    };
  }
}

async function* stream(endpoint: string, body: Json, t: Translator, signal?: AbortSignal): AsyncGenerator<AgAiEvent> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `AI request failed: HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    const frames = buffer.split("\n\n");
    buffer = done ? "" : (frames.pop() ?? "");
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) yield* t.event(JSON.parse(data));
    }
    if (done) break;
  }
}

export function claudeAdapter(options: { endpoint: string; model: string }): AgLlmAdapter {
  return {
    executeTurn(request, opts) {
      const t = new Translator();
      const body = { model: request.model?.id ?? options.model, request: encodeRequest(request) };
      let resolve!: (r: AgLlmResponse) => void;
      let reject!: (e: Error) => void;
      const complete = new Promise<AgLlmResponse>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      // Failures are reported once, through `complete`, as Studio expects.
      void complete.catch(() => {});
      const events = (async function* () {
        try {
          yield* stream(options.endpoint, body, t, opts?.signal);
          const response = t.response();
          if (response.error) reject(new Error(response.error.message));
          else resolve(response);
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      })();
      return { stream: { [Symbol.asyncIterator]: () => events }, complete };
    },
  };
}
