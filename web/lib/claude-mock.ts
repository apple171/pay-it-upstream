// Canned Claude replies for AI_MOCK=1, as the Messages API's stream events. Lets the whole
// Studio → adapter → route path run without calling the API.
//   - After a tool result: a short text answer that quotes it.
//   - Otherwise, if delegate_to can reach our payouts agent: delegate "explain this payout".
//   - Otherwise, if complete_task is offered (a delegated built-in agent): finish with a summary.
//   - Otherwise: plain text.
import type { MessageParam, RawMessageStreamEvent, Tool } from "@anthropic-ai/sdk/resources/messages";
import { readLedger } from "./store";

const sse = (events: RawMessageStreamEvent[]) => {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(c) {
      for (const e of events) {
        c.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        await new Promise((r) => setTimeout(r, 40));
      }
      c.close();
    },
  });
};

const usage = { input_tokens: 0, output_tokens: 0 };
const start = (model: string): RawMessageStreamEvent =>
  ({
    type: "message_start",
    message: { id: "msg_mock", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage },
  }) as unknown as RawMessageStreamEvent;
const end = (stop: "end_turn" | "tool_use"): RawMessageStreamEvent[] => [
  { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage } as unknown as RawMessageStreamEvent,
  { type: "message_stop" },
];

function text(model: string, body: string): RawMessageStreamEvent[] {
  const words = body.split(/(?<= )/);
  const third = Math.ceil(words.length / 3);
  return [
    start(model),
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: null } },
    ...[0, 1, 2].map(
      (i): RawMessageStreamEvent => ({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: words.slice(i * third, (i + 1) * third).join("") },
      }),
    ),
    { type: "content_block_stop", index: 0 },
    ...end("end_turn"),
  ];
}

function toolUse(model: string, name: string, input: object): RawMessageStreamEvent[] {
  const json = JSON.stringify(input);
  const half = Math.ceil(json.length / 2);
  return [
    start(model),
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: `toolu_mock_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, input: {} },
    } as unknown as RawMessageStreamEvent,
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json.slice(0, half) } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json.slice(half) } },
    { type: "content_block_stop", index: 0 },
    ...end("tool_use"),
  ];
}

export async function mockClaude(model: string, body: { messages: MessageParam[]; tools?: Tool[] }) {
  const last = body.messages.at(-1);
  const blocks = Array.isArray(last?.content) ? last.content : [];
  const result = blocks.find((b) => b.type === "tool_result");
  if (result && result.type === "tool_result") {
    const raw = typeof result.content === "string" ? result.content : JSON.stringify(result.content ?? "");
    const parsed = (() => {
      try {
        return JSON.parse(raw) as { response?: unknown };
      } catch {
        return undefined;
      }
    })();
    const said = typeof parsed?.response === "string" ? parsed.response : raw;
    return sse(text(model, `(mock Claude) Here is what the tool returned: ${said.slice(0, 600)}`));
  }

  const asked = [...body.messages].reverse().find((m) => m.role === "user");
  const question =
    typeof asked?.content === "string"
      ? asked.content
      : (asked?.content ?? []).map((b) => (b.type === "text" ? b.text : "")).join(" ");
  const packages = Object.values((await readLedger()).items).map((i) => i.package);
  const pkg = packages.find((p) => question.toLowerCase().includes(p.toLowerCase())) ?? packages[0] ?? "debug";

  const tool = (name: string) => body.tools?.find((t) => t.name === name);
  const delegate = tool("delegate_to");
  if (delegate && JSON.stringify(delegate.input_schema).includes('"payouts"')) {
    return sse(toolUse(model, "delegate_to", { type: { id: "payouts", package: pkg }, instructions: `Explain the payout to ${pkg}.` }));
  }
  if (tool("complete_task")) {
    return sse(toolUse(model, "complete_task", { summary: "(mock Claude) Nothing to change.", artifacts: [] }));
  }
  return sse(text(model, "(mock Claude) AI_MOCK is on, so this is a canned reply."));
}
