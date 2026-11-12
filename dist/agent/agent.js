// The funding agent: gets a goal, the candidate table and tools; returns a plan.
import { readFile } from "node:fs/promises";
const MAX_TURNS = 10;
const MAX_INSPECTS = Number(process.env.AI_MAX_INSPECTS ?? 6);
export async function loadAgentPrompt() {
    return readFile(new URL("../../methodology/agent-prompt.md", import.meta.url), "utf8");
}
export const isPayable = (s) => s.maintainers.some((m) => m.email);
const yearMonth = (iso) => (iso ? iso.slice(0, 7) : "?");
const num = (n) => n === undefined ? "?" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
/** One compact line per candidate, so the whole table fits in the prompt. */
export function candidateTable(cands) {
    const head = "package | direct | usedBy(here) | dependents(ecosystem) | weeklyDownloads | maintainers | firstRelease | lastRelease | releases12m | advisories | scorecard | codeReview | maintained | fundingLinks | stars | deprecated | payable";
    const rows = cands.map((s) => [
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
    ].join(" | "));
    return [head, ...rows].join("\n");
}
/** Full facts for one package, with emails removed (the agent never needs them). */
function inspectView(s, readme) {
    const { maintainers, planted: _planted, ...rest } = s;
    return {
        ...rest,
        maintainers: maintainers.map((m) => ({ name: m.name ?? "(unnamed)", hasPublicEmail: !!m.email, source: m.source })),
        readmeExcerpt: readme.slice(0, 3500),
    };
}
/** Pulls the first balanced JSON object out of a reply. */
export function parseJsonReply(text) {
    const cleaned = text.replace(/```(?:json)?/g, "");
    const start = cleaned.indexOf("{");
    if (start < 0)
        throw new Error("no JSON object in reply");
    let depth = 0;
    let inStr = false;
    for (let i = start; i < cleaned.length; i++) {
        const c = cleaned[i];
        if (inStr) {
            if (c === "\\")
                i++;
            else if (c === '"')
                inStr = false;
        }
        else if (c === '"')
            inStr = true;
        else if (c === "{")
            depth++;
        else if (c === "}" && --depth === 0)
            return JSON.parse(cleaned.slice(start, i + 1));
    }
    throw new Error("unbalanced JSON in reply");
}
export async function runAgent(provider, input, log = () => { }) {
    const system = await loadAgentPrompt();
    const byName = new Map(input.candidates.map((c) => [c.name, c]));
    const budget = `${(input.budgetCents / 100).toFixed(2)} ${input.currency}`;
    const messages = [
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
    const steps = [];
    let inspects = 0;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
        const reply = await provider.complete(system, messages);
        messages.push({ role: "assistant", content: reply });
        let msg;
        try {
            msg = parseJsonReply(reply);
        }
        catch (e) {
            messages.push({ role: "user", content: `Your reply was not valid JSON (${e.message}). Reply with one JSON object.` });
            continue;
        }
        steps.push({ tool: msg.tool, args: msg.args, thought: msg.thought });
        if (msg.tool === "inspect_package") {
            const name = String(msg.args?.name ?? "");
            const pkg = byName.get(name);
            let result;
            if (!pkg)
                result = { error: `unknown package "${name}"; choose from the candidates table` };
            else if (inspects >= MAX_INSPECTS)
                result = { error: "inspect limit reached; submit your plan now" };
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
