// The funding agent: gets a goal, the candidate table and tools; returns a plan.
import { readFile } from "node:fs/promises";
import type { PackageSignals } from "../types.ts";
import type { ChatMessage, ModelProvider } from "./providers.ts";

export type Level = "low" | "medium" | "high";

export interface AgentLimits {
  maxPerPackageCents?: number | null;
  minPayoutCents?: number | null;
  maxPackages?: number | null;
  exclude?: string[];
  onlyDirect?: boolean | null;
}

export interface AgentPick {
  package: string;
  weight: number;
  reliance?: Level;
  fragility?: Level;
  underfunded?: Level;
  reason: string;
  evidence: string[];
}

export interface AgentSkip {
  package: string;
  why: string;
}

export interface AgentStep {
  tool: string;
  args: unknown;
  thought?: string;
}

export interface AgentPlan {
  limits: AgentLimits;
  picks: AgentPick[];
  skipped: AgentSkip[];
  summary: string;
  steps: AgentStep[];
  model: string;
}

export interface AgentInput {
  budgetCents: number;
  currency: string;
  rules: string;
  candidates: PackageSignals[];
  readme: (pkg: PackageSignals) => Promise<string>;
  /** Replaces the default goal line. */
  goal?: string;
  /** Extra background for this run, e.g. what happened to an earlier payout. */
  context?: string;
}

const MAX_TURNS = 10;
const MAX_INSPECTS = Number(process.env.AI_MAX_INSPECTS ?? 6);

export async function loadAgentPrompt(): Promise<string> {
  return readFile(new URL("../../methodology/agent-prompt.md", import.meta.url), "utf8");
}

export const isPayable = (s: PackageSignals) => s.maintainers.some((m) => m.email);

const yearMonth = (iso?: string) => (iso ? iso.slice(0, 7) : "?");
const num = (n?: number) =>
  n === undefined ? "?" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);

/** One compact line per candidate, so the whole table fits in the prompt. */
export function candidateTable(cands: PackageSignals[]): string {
  const head =
    "package | direct | usedBy(here) | dependents(ecosystem) | weeklyDownloads | maintainers | firstRelease | lastRelease | releases12m | advisories | scorecard | codeReview | maintained | fundingLinks | stars | deprecated | payable";
  const rows = cands.map((s) =>
    [
      s.name,
      s.direct ? "yes" : "no",
      s.dependedOnBy,
      num(s.dependents),
      num(s.weeklyDownloads),
      s.maintainers.length,
      yearMonth(s.firstRelease),
      yearMonth(s.lastRelease),
      s.releasesLastYear ?? "?",
      s.advisories.length,
      s.scorecard ?? "?",
      s.codeReview === undefined || s.codeReview < 0 ? "?" : s.codeReview,
      s.maintained === undefined || s.maintained < 0 ? "?" : s.maintained,
      s.funding.length,
      num(s.stars),
      s.deprecated ? "yes" : "no",
      isPayable(s) ? "yes" : "no",
    ].join(" | "),
  );
  return [head, ...rows].join("\n");
}

/** Full facts for one package, with emails removed (the agent never needs them). */
function inspectView(s: PackageSignals, readme: string) {
  const { maintainers, planted: _planted, ...rest } = s;
  return {
    ...rest,
    maintainers: maintainers.map((m) => ({ name: m.name ?? "(unnamed)", hasPublicEmail: !!m.email, source: m.source })),
    readmeExcerpt: readme.slice(0, 3500),
  };
}

/** Pulls the first balanced JSON object out of a reply. */
export function parseJsonReply(text: string): any {
  const cleaned = text.replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("no JSON object in reply");
  let depth = 0;
  let inStr = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
  }
  throw new Error("unbalanced JSON in reply");
}

export async function runAgent(
  provider: ModelProvider,
  input: AgentInput,
  log: (line: string) => void = () => {},
): Promise<AgentPlan> {
  const system = await loadAgentPrompt();
  const byName = new Map(input.candidates.map((c) => [c.name, c]));
  const budget = `${(input.budgetCents / 100).toFixed(2)} ${input.currency}`;
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: [
        input.goal ?? `Goal: spend ${budget} where it protects us most.`,
        `Today: ${new Date().toISOString().slice(0, 10)}`,
        ...(input.context ? [`\n## Context\n${input.context}`] : []),
        `\n## Candidates (${input.candidates.length})\n${candidateTable(input.candidates)}`,
        `\n## Company rules\n${input.rules.trim() || "(none)"}`,
      ].join("\n"),
    },
  ];
  const steps: AgentStep[] = [];
  let inspects = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const reply = await provider.complete(system, messages);
    messages.push({ role: "assistant", content: reply });
    let msg: any;
    try {
      msg = parseJsonReply(reply);
    } catch (e) {
      messages.push({ role: "user", content: `Your reply was not valid JSON (${(e as Error).message}). Reply with one JSON object.` });
      continue;
    }
    steps.push({ tool: msg.tool, args: msg.args, thought: msg.thought });

    if (msg.tool === "inspect_package") {
      const name = String(msg.args?.name ?? "");
      const pkg = byName.get(name);
      let result: unknown;
      if (!pkg) result = { error: `unknown package "${name}"; choose from the candidates table` };
      else if (inspects >= MAX_INSPECTS) result = { error: "inspect limit reached; submit your plan now" };
      else {
        inspects++;
        log(`  inspecting ${name}${msg.thought ? `: ${msg.thought}` : ""}`);
        result = inspectView(pkg, await input.readme(pkg));
      }
      messages.push({ role: "user", content: `inspect_package result:\n${JSON.stringify(result)}` });
      continue;
    }

    if (msg.tool === "submit_plan") {
      const a = msg.args ?? {};
      return {
        limits: a.limits ?? {},
        picks: Array.isArray(a.picks) ? a.picks : [],
        skipped: Array.isArray(a.skipped) ? a.skipped : [],
        summary: String(a.summary ?? ""),
        steps,
        model: provider.label,
      };
    }

    messages.push({ role: "user", content: `Unknown tool "${msg.tool}". Use inspect_package or submit_plan.` });
  }
  throw new Error(`Agent did not submit a plan within ${MAX_TURNS} turns.`);
}
