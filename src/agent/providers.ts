// Model providers. The agent only needs "send a conversation, get text back".
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Usage {
  calls: number;
  cached: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelProvider {
  /** Shown in run records, e.g. "command" or a model id. */
  readonly label: string;
  complete(system: string, messages: ChatMessage[]): Promise<string>;
  usage?: Usage;
}

/** Flattens a conversation into one prompt for text-only backends. */
function flatten(system: string, messages: ChatMessage[]): string {
  const parts = [`# Instructions\n${system}`];
  for (const m of messages) parts.push(`# ${m.role === "user" ? "User" : "Assistant (you, earlier)"}\n${m.content}`);
  parts.push("# Your next reply (one JSON object only)");
  return parts.join("\n\n");
}

/**
 * Any command that reads a prompt on stdin and prints a reply on stdout,
 * e.g. a local model runner. Set AI_COMMAND.
 */
export class CommandProvider implements ModelProvider {
  readonly label: string;
  private command: string;
  constructor(command: string) {
    this.command = command;
    this.label = `command:${command.split(/\s+/)[0]}`;
  }
  complete(system: string, messages: ChatMessage[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, { shell: true, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve(out) : reject(new Error(`AI command exited ${code}: ${(err || out).slice(0, 500)}`)),
      );
      child.stdin.end(flatten(system, messages));
    });
  }
}

/**
 * File hand-off: writes each prompt to AI_MANUAL_DIR/turn-N.prompt.md and waits
 * for turn-N.reply.json. Useful for offline runs, reviews and tests.
 */
export class ManualProvider implements ModelProvider {
  readonly label = "manual";
  private dir: string;
  private turn = 0;
  private timeoutMs: number;
  constructor(dir: string, timeoutMs = 30 * 60_000) {
    this.dir = dir;
    this.timeoutMs = timeoutMs;
  }
  async complete(system: string, messages: ChatMessage[]): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    this.turn += 1;
    const promptFile = path.join(this.dir, `turn-${this.turn}.prompt.md`);
    const replyFile = path.join(this.dir, `turn-${this.turn}.reply.json`);
    await writeFile(promptFile, flatten(system, messages));
    console.error(`  waiting for ${path.relative(process.cwd(), replyFile)} ...`);
    const started = Date.now();
    for (;;) {
      try {
        await access(replyFile);
        return await readFile(replyFile, "utf8");
      } catch {
        if (Date.now() - started > this.timeoutMs) throw new Error(`No reply in ${replyFile}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
}


/** Google Gemini over its REST API. Set GEMINI_API_KEY and optionally GEMINI_MODEL. */
export class GeminiProvider implements ModelProvider {
  readonly label: string;
  usage: Usage = { calls: 0, cached: 0, inputTokens: 0, outputTokens: 0 };
  private apiKey: string;
  private models: string[];
  constructor(apiKey: string, model: string, fallbacks: string[] = []) {
    this.apiKey = apiKey;
    this.models = [model, ...fallbacks];
    this.label = `gemini:${model}`;
  }
  /** Retries busy/rate-limit errors, then moves on to the fallback models. */
  async complete(system: string, messages: ChatMessage[]): Promise<string> {
    let last: Error | undefined;
    for (const model of this.models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await this.once(model, system, messages);
        } catch (e) {
          last = e as Error;
          if (!/Gemini (429|500|503)/.test(last.message)) throw last;
          if (attempt < 2) await new Promise((r) => setTimeout(r, (attempt + 1) * 4000));
        }
      }
      if (model !== this.models[this.models.length - 1]) console.error(`  ${model} is busy; trying ${this.models[this.models.indexOf(model) + 1]}`);
    }
    throw last;
  }
  private async once(model: string, system: string, messages: ChatMessage[]): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] })),
        generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 4096 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${body?.error?.message ?? "request failed"}`);
    this.usage.calls++;
    this.usage.inputTokens += body.usageMetadata?.promptTokenCount ?? 0;
    this.usage.outputTokens += (body.usageMetadata?.candidatesTokenCount ?? 0) + (body.usageMetadata?.thoughtsTokenCount ?? 0);
    const text = (body.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    if (!text) throw new Error(`Gemini returned no text (${body.candidates?.[0]?.finishReason ?? "no candidates"})`);
    return text;
  }
}

/** Anthropic Claude via the official SDK. Set ANTHROPIC_API_KEY and optionally CLAUDE_MODEL / CLAUDE_EFFORT. */
export class ClaudeProvider implements ModelProvider {
  readonly label: string;
  usage: Usage = { calls: 0, cached: 0, inputTokens: 0, outputTokens: 0 };
  private client: Anthropic;
  private model: string;
  private effort: "low" | "medium" | "high";
  constructor(apiKey: string, model: string, effort: "low" | "medium" | "high" = "medium") {
    // The SDK retries rate limits and overloaded errors itself.
    this.client = new Anthropic({ apiKey, maxRetries: 3 });
    this.model = model;
    this.effort = effort;
    this.label = `claude:${model}`;
  }
  async complete(system: string, messages: ChatMessage[]): Promise<string> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 16000,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      thinking: { type: "adaptive" },
      output_config: { effort: this.effort },
    });
    const msg = await stream.finalMessage();
    this.usage.calls++;
    this.usage.inputTokens += msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
    this.usage.outputTokens += msg.usage.output_tokens;
    if (msg.stop_reason === "refusal") throw new Error("Claude declined this request.");
    if (msg.stop_reason === "max_tokens") throw new Error("Claude ran out of output tokens before finishing.");
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    if (!text) throw new Error(`Claude returned no text (${msg.stop_reason})`);
    return text;
  }
}

/**
 * Saves every reply on disk, keyed by the exact conversation. Re-running the
 * same input (a demo, a recording) replays saved replies and costs nothing.
 */
export class CachedProvider implements ModelProvider {
  readonly label: string;
  private inner: ModelProvider;
  private dir: string;
  constructor(inner: ModelProvider, dir: string) {
    this.inner = inner;
    this.dir = dir;
    this.label = inner.label;
  }
  get usage(): Usage | undefined {
    return this.inner.usage;
  }
  async complete(system: string, messages: ChatMessage[]): Promise<string> {
    const key = createHash("sha256").update(JSON.stringify([this.inner.label, system, messages])).digest("hex").slice(0, 32);
    const file = path.join(this.dir, `${key}.txt`);
    try {
      const hit = await readFile(file, "utf8");
      if (this.inner.usage) this.inner.usage.cached++;
      return hit;
    } catch {}
    const reply = await this.inner.complete(system, messages);
    await mkdir(this.dir, { recursive: true });
    await writeFile(file, reply);
    return reply;
  }
}

export function providerFromEnv(env = process.env, runDir?: string, cacheDir?: string): ModelProvider {
  const kind = (env.AI_PROVIDER ?? (env.AI_COMMAND ? "command" : "")).toLowerCase();
  if (kind === "command") {
    if (!env.AI_COMMAND) throw new Error("AI_PROVIDER=command needs AI_COMMAND.");
    return new CommandProvider(env.AI_COMMAND);
  }
  if (kind === "manual") {
    return new ManualProvider(env.AI_MANUAL_DIR ?? path.join(runDir ?? ".pay-it-upstream", "ai-turns"));
  }
  if (kind === "gemini") {
    if (!env.GEMINI_API_KEY) throw new Error("AI_PROVIDER=gemini needs GEMINI_API_KEY.");
    const fallbacks = (env.GEMINI_FALLBACK_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    const gemini = new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL ?? "gemini-3.5-flash-lite", fallbacks);
    return cacheDir && env.AI_CACHE !== "off" ? new CachedProvider(gemini, cacheDir) : gemini;
  }
  if (kind === "claude") {
    if (!env.ANTHROPIC_API_KEY) throw new Error("AI_PROVIDER=claude needs ANTHROPIC_API_KEY.");
    const effort = (["low", "medium", "high"] as const).find((e) => e === env.CLAUDE_EFFORT) ?? "medium";
    const claude = new ClaudeProvider(env.ANTHROPIC_API_KEY, env.CLAUDE_MODEL ?? "claude-opus-5-5", effort);
    return cacheDir && env.AI_CACHE !== "off" ? new CachedProvider(claude, cacheDir) : claude;
  }
  throw new Error("Choose an AI provider: set AI_PROVIDER (claude, gemini, command or manual). See .env.example.");
}
