#!/usr/bin/env node
// Pay It Upstream MCP server: lets a coding agent fund the open source a project depends on.
// The agent supplies the judgment; plain code enforces the money rules; a human approves; PayPal pays.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { scanFolder } from "../src/lockfiles/index.ts";
import { mergeDeps, pickCandidates } from "../src/candidates.ts";
import { gatherSignals } from "../src/signals/index.ts";
import { candidateTable, isPayable, loadAgentPrompt, type AgentPlan } from "../src/agent/agent.ts";
import { enforcePlan } from "../src/plan.ts";
import { addEvent, fingerprint, loadRun, newRunId, saveRun, type RunRecord } from "../src/runs.ts";
import { refreshStatus, runTotal, sendRunPayouts, STATUS_WORDS } from "../src/payout-run.ts";
import type { PackageSignals } from "../src/types.ts";
import { loadSettings } from "../src/settings.ts";
import { approvalState, approvalUrl, requestApproval, siteApprovalFromEnv } from "../src/approval.ts";

const { values: args } = parseArgs({ options: { env: { type: "string" } }, strict: false });
const envFile = (args.env as string | undefined) ?? process.env.PIU_ENV_FILE;
if (envFile) process.loadEnvFile(envFile);

const money = (cents: number, cur = "USD") => `${cur === "USD" ? "$" : ""}${(cents / 100).toFixed(2)}${cur === "USD" ? "" : " " + cur}`;
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });
const dirOf = (project: string) => path.join(path.resolve(project), ".pay-it-upstream");

/** The method's signal and gaming sections, without the CLI's reply-format rules. */
async function methodGuide(): Promise<string> {
  const full = await loadAgentPrompt();
  return full.split("## Tools")[0].trim();
}

interface Scan {
  id: string;
  project: string;
  lockfiles: string[];
  signals: PackageSignals[];
}

const server = new McpServer({ name: "pay-it-upstream", version: "0.1.0" });

server.registerTool(
  "scan_dependencies",
  {
    title: "Scan dependencies for funding",
    description:
      "Reads the project's lockfile (package-lock.json, uv.lock or requirements.txt) and gathers public facts about each package: " +
      "how much the project relies on it, how fragile it is, and how underfunded it is. Returns a candidate table, the funding " +
      "method to apply, and a scan_id for propose_funding. Read-only; no money moves.",
    inputSchema: {
      project_path: z.string().describe("Folder containing the lockfile."),
      max_candidates: z.number().int().min(5).max(80).optional().describe("Packages to look up (default 40)."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ project_path, max_candidates }) => {
    const project = path.resolve(project_path);
    await loadSettings(project);
    const scans = await scanFolder(project);
    const chosen = pickCandidates(mergeDeps(scans.map((s) => s.deps)), max_candidates ?? 40);
    const signals = await gatherSignals(chosen, { cacheDir: path.join(dirOf(project), "cache") });
    const scan: Scan = { id: newRunId(), project, lockfiles: scans.map((s) => s.file), signals };
    await mkdir(path.join(dirOf(project), "scans"), { recursive: true });
    await writeFile(path.join(dirOf(project), "scans", `${scan.id}.json`), JSON.stringify(scan));
    return text(
      [
        `scan_id: ${scan.id}`,
        `Lockfiles: ${scans.map((s) => `${s.file} (${s.deps.length} packages)`).join(", ")}. Looked up ${signals.length} candidates; ${signals.filter(isPayable).length} have a public contact (payable).`,
        `\n## Candidates\n${candidateTable(signals)}`,
        `\n## How to decide\n${await methodGuide()}`,
        `\n## Next step\nDecide where the budget protects this project most, then call propose_funding with scan_id, the budget, ` +
          `3–10 picks (weight 1–100, a one-sentence reason and facts as evidence), notable skips, and a two-sentence summary. ` +
          `Only packages marked payable can be paid. Weekly downloads alone are not a reason to fund.`,
      ].join("\n"),
    );
  },
);

server.registerTool(
  "propose_funding",
  {
    title: "Propose a funding plan",
    description:
      "Turns your picks into an exact payout plan. Plain code enforces the budget, a 30% cap per package, a $5 minimum, the company's " +
      "rules and payable-only payees, and returns the amounts, a run_id and an approval link. Nothing is paid. A person approves the plan " +
      "on that page (you can't); then call send_payouts.",
    inputSchema: {
      project_path: z.string(),
      scan_id: z.string().describe("From scan_dependencies."),
      budget_usd: z.number().positive().max(100_000),
      rules: z.string().optional().describe("The company's funding rules in plain English, if any."),
      limits: z
        .object({
          maxPerPackageCents: z.number().int().positive().optional(),
          minPayoutCents: z.number().int().positive().optional(),
          maxPackages: z.number().int().positive().optional(),
          exclude: z.array(z.string()).optional(),
          onlyDirect: z.boolean().optional(),
        })
        .optional()
        .describe("Exact limits from the rules. They can only tighten the built-in limits."),
      picks: z
        .array(
          z.object({
            package: z.string(),
            weight: z.number().positive().max(100),
            reason: z.string().max(400),
            evidence: z.array(z.string()).max(8).optional(),
            reliance: z.enum(["low", "medium", "high"]).optional(),
            fragility: z.enum(["low", "medium", "high"]).optional(),
            underfunded: z.enum(["low", "medium", "high"]).optional(),
          }),
        )
        .min(1)
        .max(15),
      skipped: z.array(z.object({ package: z.string(), why: z.string().max(300) })).max(20).optional(),
      summary: z.string().max(600),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (a) => {
    await loadSettings(path.resolve(a.project_path));
    let scan: Scan;
    try {
      scan = JSON.parse(await readFile(path.join(dirOf(a.project_path), "scans", `${a.scan_id}.json`), "utf8"));
    } catch {
      return fail(`No scan ${a.scan_id} in ${a.project_path}. Call scan_dependencies first.`);
    }
    const client = server.server.getClientVersion()?.name ?? "agent";
    const plan: AgentPlan = {
      limits: a.limits ?? {},
      picks: a.picks.map((p) => ({ ...p, evidence: p.evidence ?? [] })),
      skipped: a.skipped ?? [],
      summary: a.summary,
      steps: [],
      model: `mcp:${client}`,
    };
    const budgetCents = Math.round(a.budget_usd * 100);
    const enforced = enforcePlan(plan, scan.signals, budgetCents);
    const baseline = scan.signals
      .filter(isPayable)
      .sort((x, y) => (y.weeklyDownloads ?? 0) - (x.weeklyDownloads ?? 0))
      .slice(0, Math.max(enforced.allocations.length, 3))
      .map((s) => ({ package: s.name, weeklyDownloads: s.weeklyDownloads }));
    const rules = a.rules ?? "";
    const run: RunRecord = {
      id: newRunId(),
      kind: "plan",
      createdAt: new Date().toISOString(),
      project: scan.project,
      budgetCents,
      currency: "USD",
      rules,
      rulesFingerprint: fingerprint(rules),
      methodologyFingerprint: fingerprint(await loadAgentPrompt()),
      lockfiles: scan.lockfiles,
      candidates: scan.signals.length,
      signals: scan.signals,
      baseline,
      plan,
      ...enforced,
      events: [],
    };
    addEvent(run, `Planned by ${plan.model}: ${money(budgetCents - enforced.unspentCents)} across ${enforced.allocations.length} packages`);
    await saveRun(run);

    // A person approves on the site; the agent only gets the link.
    const site = siteApprovalFromEnv();
    let approval: string;
    if (!run.allocations.length) approval = "Nothing to approve: the rules left no package to pay.";
    else if (site) {
      try {
        const req = await requestApproval(run, site);
        addEvent(run, `Sent for approval: ${req.url}`);
        await saveRun(run);
        approval =
          `Approval link: ${req.url}\n` +
          `Give the user this link. A person approves or rejects the plan there with the approver passphrase; you cannot approve it. ` +
          `After they say it's approved, call send_payouts with project_path and run_id.`;
      } catch (e) {
        approval = `Could not put the plan on the approval page (${(e as Error).message}). Nothing can be paid until it is approved.`;
      }
    } else {
      approval =
        `No approval site is connected for this project, so a person approves in their own terminal: ` +
        `\`pay-it-upstream pay ${run.id} --dir ${run.project}\`. Give the user that command; send_payouts won't pay an unapproved plan. ` +
        `(To approve on a page instead: \`pay-it-upstream approver set\`.)`;
    }

    const funded = new Set(run.allocations.map((x) => x.package));
    const overlap = baseline.filter((b) => funded.has(b.package)).length;
    return text(
      [
        `run_id: ${run.id}`,
        `\n| package | amount | reason |\n|---|---|---|`,
        ...run.allocations.map((x) => `| ${x.package} | ${money(x.amountCents)} | ${x.pick.reason} |`),
        `\nTotal ${money(runTotal(run))} of ${money(budgetCents)}${run.unspentCents ? ` (${money(run.unspentCents)} unspent)` : ""}.`,
        run.rejected.length ? `Blocked by the rules: ${run.rejected.map((r) => `${r.package} (${r.why})`).join("; ")}.` : "",
        `A download-count ranking would fund ${baseline.map((b) => b.package).join(", ")}; overlap ${overlap}/${baseline.length}.`,
        `\nNothing has been paid.`,
        approval,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  },
);

server.registerTool(
  "send_payouts",
  {
    title: "Send PayPal payouts for an approved plan",
    description:
      "Pays a plan that a person has approved on the approval page: one PayPal Payouts batch, one payout per package, to the maintainer " +
      "email published in the registry (sandbox test accounts when PAYPAL_ENV=sandbox). If the plan isn't approved yet it pays nothing and " +
      "returns the approval link. A run can never be paid twice.",
    inputSchema: {
      project_path: z.string(),
      run_id: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ project_path, run_id }) => {
    await loadSettings(path.resolve(project_path));
    let run: RunRecord;
    try {
      run = await loadRun(path.resolve(project_path), run_id);
    } catch {
      return fail(`No run ${run_id} in ${project_path}.`);
    }
    if (!run.approval) {
      const site = siteApprovalFromEnv();
      if (!site) return fail(`Not approved. A person approves this plan in their terminal: \`pay-it-upstream pay ${run.id} --dir ${run.project}\`.`);
      // A plan that never reached the approval page (e.g. the site was down) is sent there now.
      const s = await approvalState(run, site)
        .catch(async (e) => ((e as Error).message.includes("404") ? await requestApproval(run, site) : Promise.reject(e)))
        .catch((e) => ({ state: "error", note: (e as Error).message }) as const);
      if (s.state === "error") return fail(`Couldn't check the approval page (${s.note}). Nothing was paid.`);
      if (s.state === "waiting") return text(`Not approved yet, so nothing was paid. Ask the user to approve it at ${approvalUrl(run, site)}, then call send_payouts again.`);
      if (s.state === "rejected") return fail(`The plan was rejected by ${s.by ?? "the approver"}${s.note ? `: ${s.note}` : ""}. Nothing was paid.`);
      run.approval = { via: "site", by: s.by ?? "approver", at: s.decidedAt ?? new Date().toISOString() };
      addEvent(run, `Approved by ${run.approval.by} (on the site, with the approver passphrase)`);
      await saveRun(run);
    }
    const res = await sendRunPayouts(run);
    if (res.outcome !== "sent") return text(`Nothing sent: this run was already paid (batch ${res.batchId ?? "on file"}). Nothing is ever paid twice.`);
    return text(
      [
        `Approved by ${run.approval.by}. Sent PayPal batch ${res.batchId}${res.sandbox ? " (sandbox)" : ""}: ${money(runTotal(run))} to ${res.lines.length} maintainers.`,
        ...res.lines.map((l) => `- ${l.package}: ${money(l.amountCents)} → ${l.maintainerMasked}`),
        res.published ? `Public ledger: ${res.published}` : res.publishError ? `Ledger publish failed: ${res.publishError}` : "",
        `PayPal settles in about a minute. Call payout_status with this run_id to see who has been paid and who still needs to claim.`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  },
);

server.registerTool(
  "payout_status",
  {
    title: "Check payout status",
    description: "Reads the run's PayPal batch: which maintainers have been paid and which payouts are waiting to be claimed. Read-only.",
    inputSchema: { project_path: z.string(), run_id: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ project_path, run_id }) => {
    await loadSettings(path.resolve(project_path));
    let run: RunRecord;
    try {
      run = await loadRun(path.resolve(project_path), run_id);
    } catch {
      return fail(`No run ${run_id} in ${project_path}.`);
    }
    if (!run.payout) return text("This run hasn't been paid yet.");
    const st = await refreshStatus(run);
    return text(
      [
        `Batch ${run.payout.batchId}: ${st.status.status.toLowerCase()} · ${st.counts.map(([w, n]) => `${n} ${w}`).join(", ")}`,
        ...st.status.items.map((it) => {
          const l = run.payout!.lines.find((x) => x.senderItemId === it.senderItemId);
          return `- ${l?.package ?? it.senderItemId}: ${it.currency} ${it.amount} ${STATUS_WORDS[it.status] ?? it.status}`;
        }),
        st.settled ? "" : "Still processing; check again in a minute.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  },
);

server.registerPrompt(
  "fund_my_dependencies",
  {
    title: "Fund my dependencies",
    description: "Walks through scanning, planning, approval and PayPal payouts for this project.",
    argsSchema: { budget_usd: z.string().describe("Budget in USD, e.g. 500"), project_path: z.string().optional() },
  },
  ({ budget_usd, project_path }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Use Pay It Upstream to fund the open-source packages this project depends on, with a budget of $${budget_usd}. ` +
            `Call scan_dependencies on ${project_path ?? "the project folder"}, decide using the method it returns, call propose_funding, ` +
            `show me the plan with reasons and the approval link, and after I've approved it there, call send_payouts. Then check payout_status.`,
        },
      },
    ],
  }),
);

await server.connect(new StdioServerTransport());
