#!/usr/bin/env node
// pay-it-upstream: point it at your code repo; AI finds which packages keep it alive; PayPal pays them.
import { parseArgs } from "node:util";
import { readFile, access } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { scanFolder } from "./lockfiles/index.ts";
import { mergeDeps, pickCandidates } from "./candidates.ts";
import { gatherSignals, fetchReadme } from "./signals/index.ts";
import { runAgent, loadAgentPrompt, isPayable } from "./agent/agent.ts";
import { providerFromEnv } from "./agent/providers.ts";
import { enforcePlan, DEFAULT_LIMITS, type HardLimits } from "./plan.ts";
import { PayPalClient, paypalConfigFromEnv } from "./paypal/client.ts";
import { getBatch, cancelItem } from "./paypal/payouts.ts";
import { ledgerFromEnv } from "./publish.ts";
import { sendRunPayouts, publishIfConfigured, refreshStatus, runTotal, STATUS_WORDS, type StatusResult } from "./payout-run.ts";
import { newRunId, saveRun, loadRun, addEvent, fingerprint, type RunRecord } from "./runs.ts";
import type { PackageSignals } from "./types.ts";
import { loadSettings } from "./settings.ts";
import { siteApprovalFromEnv, requestApproval, waitForApproval } from "./approval.ts";
import { setupCommand, modelCommand, paypalCommand, approvalCommand, rulesCommand, webCommand, setupSummary } from "./setup-cli.ts";
import { pledgeCommand, pledgesCommand, shippedCommand, withdrawCommand } from "./pledge-cli.ts";

const HELP = `pay-it-upstream: your agent finds the open source your project runs on and proposes who to fund.
You approve. PayPal pays the maintainers.

Get started (once per repo, about 2 minutes)
  pay-it-upstream setup                 model, PayPal account, who approves
  pay-it-upstream model [set]           show or change the AI model and key
  pay-it-upstream paypal [set]          show or change the PayPal account that pays
  pay-it-upstream approver [set]        show or change how plans are approved
  pay-it-upstream rules [set "..."]     your funding rules, in plain English

Fund
  pay-it-upstream --budget 50           scan, pick, propose, wait for approval, pay
  pay-it-upstream status [run]          setup, latest run, who has been paid
  pay-it-upstream resplit [run]         re-split unclaimed payouts to other packages
  pay-it-upstream web                   open the site: runs, proof, dashboard
  pay-it-upstream plan --budget 50      propose only, nothing is paid
  pay-it-upstream pay [run]             pay a saved plan

Pledges (held with PayPal, paid only if the work ships)
  pay-it-upstream --security-fix <package> --amount 100 [--note "..."]
  pay-it-upstream --request-feature <package> --amount 50 [--note "..."]
  pay-it-upstream pledges | shipped [pledge] | withdraw [pledge]

Coding agents: add the MCP server (see mcp/README.md) and ask "fund our dependencies with $50".

Options
  --budget <amount>      budget for this run (default 100)
  --dir <folder>         the project (default: this folder)
  --currency <code>      default USD
  --rules <text>         rules for this run only
  --rules-file <path>    default: .pay-it-upstream/rules.md
  --env <file>           load settings from a file instead of .pay-it-upstream/settings.env
  --max-candidates <n>   packages to look up (default 40)
  --planted <file>       add planted test packages (JSON) to check the agent
  --yes                  approve in this terminal without asking (not allowed when a site approves)
  --watch                keep checking statuses until settled
  --amount, --note       pledge amount in whole dollars (at least 5) and what has to ship
`;


const money = (cents: number, cur: string) => `${cur === "USD" ? "$" : ""}${(cents / 100).toFixed(2)}${cur === "USD" ? "" : " " + cur}`;
const pad = (s: string | number, n: number) => String(s).padEnd(n).slice(0, n);
const out = (s = "") => console.log(s);
const step = (s: string) => console.log(`\n▸ ${s}`);

async function exists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function planRun(dir: string, opts: Opts): Promise<RunRecord> {
  const project = path.resolve(dir);
  const cacheDir = path.join(project, ".pay-it-upstream", "cache");
  const budgetCents = Math.round(Number(opts.budget ?? 100) * 100);
  if (!(budgetCents > 0)) throw new Error("--budget must be a positive amount.");
  const currency = (opts.currency ?? "USD").toUpperCase();
  const maxCandidates = Number(opts["max-candidates"] ?? 40);
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) throw new Error("--max-candidates must be a whole number of 1 or more.");
  // Check named files before the slow lookups, not after.
  for (const [flag, file] of [["--planted", opts.planted], ["--rules-file", opts["rules-file"]]] as const) {
    if (file && !(await exists(file))) throw new Error(`${flag}: file not found: ${file}`);
  }

  step("Reading lockfiles");
  const scans = await scanFolder(project);
  for (const s of scans) out(`  ${s.file}: ${s.deps.length} packages (${s.deps.filter((d) => d.direct).length} direct)`);
  const deps = mergeDeps(scans.map((s) => s.deps));
  const chosen = pickCandidates(deps, maxCandidates);

  step(`Looking up ${chosen.length} packages (npm, PyPI, deps.dev)`);
  const signals = await gatherSignals(chosen, {
    cacheDir,
    onProgress: (d, t) => process.stdout.write(`\r  ${d}/${t}`),
  });
  out("");
  const failed = signals.filter((s) => s.errors.length).length;
  if (failed) out(`  ${failed} packages had partial data`);

  if (opts.planted) {
    const planted: Partial<PackageSignals>[] = JSON.parse(await readFile(String(opts.planted), "utf8"));
    for (const p of planted) signals.push({ advisories: [], funding: [], maintainers: [], errors: [], ...p } as PackageSignals);
    out(`  added ${planted.length} planted test package(s) from ${opts.planted}`);
  }

  let rules = opts.rules ?? "";
  const rulesFile = opts["rules-file"] ?? path.join(project, ".pay-it-upstream", "rules.md");
  if (!rules && (await exists(rulesFile))) rules = await readFile(rulesFile, "utf8");

  step("Agent is choosing where the money protects you most");
  return agentRun({ project, signals, budgetCents, currency, rules, lockfiles: scans.map((s) => s.file), kind: "plan" });
}

interface AgentRunArgs {
  project: string;
  signals: PackageSignals[];
  budgetCents: number;
  currency: string;
  rules: string;
  lockfiles: string[];
  kind: RunRecord["kind"];
  parent?: string;
  goal?: string;
  context?: string;
  hard?: HardLimits;
}

/** Runs the agent, enforces its plan in code, saves and prints the run. */
async function agentRun(a: AgentRunArgs): Promise<RunRecord> {
  const cacheDir = path.join(a.project, ".pay-it-upstream", "cache");
  const id = newRunId();
  const provider = providerFromEnv(
    process.env,
    path.join(a.project, ".pay-it-upstream", "runs", id),
    path.join(a.project, ".pay-it-upstream", "ai-cache"),
  );
  const plan = await runAgent(
    provider,
    {
      budgetCents: a.budgetCents,
      currency: a.currency,
      rules: a.rules,
      candidates: a.signals,
      goal: a.goal,
      context: a.context,
      readme: async (p: PackageSignals) => p.planted?.readme ?? fetchReadme(p.ecosystem, p.name, cacheDir),
    },
    out,
  );
  const enforced = enforcePlan(plan, a.signals, a.budgetCents, a.hard);
  const u = provider.usage;
  if (u) out(`  AI: ${u.calls} call(s), ${u.cached} replayed from cache, ${u.inputTokens} input / ${u.outputTokens} output tokens`);

  const baseline = a.signals
    .filter(isPayable)
    .sort((x, y) => (y.weeklyDownloads ?? 0) - (x.weeklyDownloads ?? 0))
    .slice(0, Math.max(enforced.allocations.length, 3))
    .map((s) => ({ package: s.name, weeklyDownloads: s.weeklyDownloads }));

  const run: RunRecord = {
    id,
    kind: a.kind,
    parent: a.parent,
    createdAt: new Date().toISOString(),
    project: a.project,
    budgetCents: a.budgetCents,
    currency: a.currency,
    rules: a.rules,
    rulesFingerprint: fingerprint(a.rules),
    methodologyFingerprint: fingerprint(await loadAgentPrompt()),
    lockfiles: a.lockfiles,
    candidates: a.signals.length,
    signals: a.signals,
    baseline,
    plan,
    ...enforced,
    events: [],
  };
  addEvent(run, `Planned ${money(a.budgetCents - enforced.unspentCents, a.currency)} across ${enforced.allocations.length} packages`);
  await saveRun(run);
  printPlan(run);
  return run;
}

/** Re-splits unclaimed payouts from an earlier run into a new, linked run. */
async function resplitRun(parent: RunRecord, opts: Opts): Promise<RunRecord | undefined> {
  if (!parent.payout) throw new Error("This run hasn't been paid yet.");
  if (parent.resplit) {
    out(`\n  Already re-split into run ${parent.resplit.childId}. Nothing moved twice.`);
    return;
  }
  const pp = new PayPalClient(paypalConfigFromEnv());
  const st = await getBatch(pp, parent.payout.batchId);
  const lineOf = (senderItemId: string) => parent.payout!.lines.find((l) => l.senderItemId === senderItemId);
  const open = st.items.filter((i) => i.status === "UNCLAIMED" || i.status === "RETURNED");
  if (!open.length) {
    out("\n  Nothing unclaimed. Every payout in this run reached its maintainer.");
    return;
  }

  step(`${open.length} payout(s) not claimed: asking PayPal to cancel them`);
  const cancels: NonNullable<RunRecord["resplit"]>["cancels"] = [];
  for (const it of open) {
    const pkg = lineOf(it.senderItemId)?.package ?? it.senderItemId;
    let result: { ok: boolean; error?: string } = { ok: it.status === "RETURNED" };
    for (let attempt = 1; it.status === "UNCLAIMED" && attempt <= 3; attempt++) {
      result = await cancelItem(pp, it.itemId);
      if (result.ok) break;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
    }
    const outcome = result.ok
      ? "cancelled: the money is back in your PayPal balance"
      : `PayPal could not cancel it now (${result.error}); it returns to you automatically after 30 days`;
    out(`  ${pad(pkg, 22)} ${pad(`${it.currency} ${it.amount}`, 11)} ${outcome}`);
    cancels.push({ itemId: it.itemId, package: pkg, amount: it.amount, cancelled: result.ok, error: result.error });
    addEvent(parent, `${pkg}: unclaimed ${it.currency} ${it.amount}; ${outcome}`);
  }

  const amountCents = Math.round(open.reduce((s, i) => s + Number(i.amount) * 100, 0));
  const unreachable = new Set(open.map((i) => parent.allocations.find((a) => a.package === lineOf(i.senderItemId)?.package)?.payee.email));
  const funded = new Set(parent.allocations.map((a) => a.package));
  const signals = parent.signals.filter((s) => !funded.has(s.name) && !s.maintainers.some((m) => unreachable.has(m.email)));

  step(`Agent is re-splitting ${money(amountCents, parent.currency)}`);
  const context = [
    `Run ${parent.id} paid ${st.items.length - open.length} maintainers.`,
    `These payouts were not claimed (PayPal found no account for the published email):`,
    ...cancels.map((c) => `- ${c.package}: ${parent.currency} ${c.amount} (${c.cancelled ? "cancelled, money returned" : "will return automatically after 30 days"})`),
    `Re-allocate ${money(amountCents, parent.currency)} to packages that were not funded in that run. The candidates below exclude every funded package and the unreachable maintainer. Pick 1 to 3 packages.`,
  ].join("\n");
  const child = await agentRun({
    project: parent.project,
    signals,
    budgetCents: amountCents,
    currency: parent.currency,
    rules: parent.rules,
    lockfiles: parent.lockfiles,
    kind: "resplit",
    parent: parent.id,
    goal: `Goal: re-split ${money(amountCents, parent.currency)} of unclaimed payouts where it protects us most.`,
    context,
    // Keep the original per-package cap: 30% of the parent budget.
    hard: { ...DEFAULT_LIMITS, maxShare: Math.min(1, (DEFAULT_LIMITS.maxShare * parent.budgetCents) / amountCents) },
  });
  parent.resplit = { childId: child.id, cancels };
  addEvent(parent, `Re-split ${money(amountCents, parent.currency)} into run ${child.id}`);
  await saveRun(parent);
  return child;
}

function printPlan(run: RunRecord) {
  const cur = run.currency;
  step(`${run.kind === "resplit" ? "Re-split plan" : "Plan"} ${run.id}${run.parent ? ` (from run ${run.parent})` : ""}`);
  out(`  ${run.plan.summary}`);
  out("");
  out(`  ${pad("package", 22)} ${pad("amount", 9)} ${pad("rel/frag/fund", 14)} reason`);
  const tag = (name: string) => (run.signals?.find((s) => s.name === name)?.planted ? "  [planted test package]" : "");
  for (const a of run.allocations) {
    const lv = [a.pick.reliance, a.pick.fragility, a.pick.underfunded].map((l) => (l ?? "?")[0].toUpperCase()).join("/");
    out(`  ${pad(a.package, 22)} ${pad(money(a.amountCents, cur), 9)} ${pad(lv, 14)} ${a.pick.reason}${tag(a.package)}`);
  }
  if (run.unspentCents > 0) out(`  (unspent: ${money(run.unspentCents, cur)})`);
  if (run.plan.skipped.length) {
    out("\n  Skipped by the agent:");
    for (const s of run.plan.skipped) out(`    ${pad(s.package, 22)} ${s.why}${tag(s.package)}`);
  }
  if (run.rejected.length) {
    out("\n  Blocked by the rules engine:");
    for (const r of run.rejected) out(`    ${pad(r.package, 22)} ${r.why}`);
  }
  const funded = new Set(run.allocations.map((a) => a.package));
  const overlap = run.baseline.filter((b) => funded.has(b.package)).length;
  out(`\n  A download-count ranking would fund: ${run.baseline.map((b) => b.package).join(", ")}`);
  out(`  Overlap with the agent's picks: ${overlap}/${run.baseline.length}`);
  out(`\n  Rules fingerprint ${run.rulesFingerprint} · method ${run.methodologyFingerprint} · model ${run.plan.model}`);
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

/** A person approves before anything is paid: on the site when one is connected, otherwise here. */
async function approve(run: RunRecord, opts: Opts): Promise<boolean> {
  if (run.approval) return true;
  const total = money(runTotal(run), run.currency);
  const site = siteApprovalFromEnv();
  if (site) {
    if (opts.yes) throw new Error("Plans for this project are approved on the site, so --yes can't approve them. Use the approval link.");
    const req = await requestApproval(run, site);
    if (req.state === "waiting") {
      step(`Waiting for a person to approve ${total}`);
      out(`  Approve or reject it here: ${req.url}`);
      out("  (the agent can't approve it: that needs the approver's passphrase)");
    }
    let shown = "";
    const s = req.state === "waiting" ? await waitForApproval(run, site, 30, (x) => {
      if (x.state !== shown && x.state !== "waiting") out("");
      shown = x.state;
    }) : req;
    if (s.state === "waiting") {
      out("  Still waiting. Nothing was paid. Once it's approved, run: pay-it-upstream pay " + run.id);
      return false;
    }
    if (s.state === "rejected") {
      addEvent(run, `Rejected on the site by ${s.by ?? "the approver"}${s.note ? `: ${s.note}` : ""}`);
      await saveRun(run);
      out(`  ✗ Rejected by ${s.by ?? "the approver"}${s.note ? `: ${s.note}` : ""}. Nothing was paid.`);
      return false;
    }
    run.approval = { via: "site", by: s.by ?? "approver", at: s.decidedAt ?? new Date().toISOString() };
    out(`  ✓ Approved by ${run.approval.by} on the site`);
  } else {
    if (!opts.yes && !(await confirm(`\nApprove ${total} to ${run.allocations.length} maintainers? [y/N] `))) {
      out("  Not approved. The plan is saved; pay later with: pay-it-upstream pay " + run.id);
      return false;
    }
    run.approval = { via: "terminal", by: "the operator", at: new Date().toISOString() };
  }
  addEvent(run, `Approved by ${run.approval.by} (${run.approval.via === "site" ? "on the site, with the approver passphrase" : "in the terminal"})`);
  await saveRun(run);
  return true;
}

async function payRun(run: RunRecord, opts: Opts) {
  if (run.payout) {
    out(`\n  Already sent as PayPal batch ${run.payout.batchId}. Nothing paid twice.`);
    return;
  }
  if (!run.allocations.length) throw new Error("This plan has nothing to pay.");
  if (!(await approve(run, opts))) return;
  step(`Sending PayPal payouts${paypalConfigFromEnv().env === "sandbox" ? " (sandbox)" : ""}`);
  const res = await sendRunPayouts(run);
  if (res.outcome === "duplicate") return out("  PayPal already has this batch. Nothing paid twice.");
  out(`  Batch ${res.batchId}: ${res.batchStatus}`);
  if (res.published) out(`  Published to the public ledger: ${res.published}`);
  if (res.publishError) out(`  Could not publish to the ledger (${res.publishError}). Retry with: pay-it-upstream publish ${run.id}`);
  for (const l of res.lines) out(`  ${pad(l.package, 22)} ${pad(money(l.amountCents, run.currency), 9)} → ${l.maintainerMasked}${res.sandbox ? `  (sandbox: ${l.receiver})` : ""}`);
}

async function maybePublish(run: RunRecord) {
  const r = await publishIfConfigured(run);
  if (r.published) out(`  Published to the public ledger: ${r.published}`);
  if (r.publishError) out(`  Could not publish to the ledger (${r.publishError}). Retry with: pay-it-upstream publish ${run.id}`);
}

async function checkStatus(run: RunRecord, watch: boolean) {
  if (!run.payout) throw new Error("This run hasn't been paid yet.");
  const started = Date.now();
  step(`Status of batch ${run.payout.batchId}`);
  let last: StatusResult;
  for (;;) {
    last = await refreshStatus(run);
    out(`  ${new Date().toLocaleTimeString()}  batch ${last.status.status.toLowerCase()} · ${last.counts.map(([w, n]) => `${n} ${w}`).join(", ")}`);
    if (!watch || last.settled || Date.now() - started > 5 * 60_000) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  out("");
  for (const it of last.status.items) {
    const l = run.payout.lines.find((x) => x.senderItemId === it.senderItemId);
    out(`  ${pad(l?.package ?? it.senderItemId, 22)} ${pad(`${it.currency} ${it.amount}`, 11)} ${STATUS_WORDS[it.status] ?? it.status}`);
  }
}

/** `status` with no run: the setup, then the latest run. */
async function overview(dir: string, watch: boolean) {
  out(`\npay-it-upstream · ${path.resolve(dir)}\n`);
  out(setupSummary());
  let run: RunRecord;
  try {
    run = await loadRun(path.resolve(dir), "latest");
  } catch {
    out("\n  No runs yet. Start one with: pay-it-upstream --budget 50");
    return;
  }
  const state = run.payout ? `paid as PayPal batch ${run.payout.batchId}` : "proposed, not paid";
  out(`\n  Latest run ${run.id} · ${new Date(run.createdAt).toLocaleString()} · ${money(runTotal(run), run.currency)} to ${run.allocations.length} packages · ${state}`);
  if (run.payout) await checkStatus(run, watch);
  else out(`  Pay it with: pay-it-upstream pay ${run.id}`);
}

async function latestPage(dir: string) {
  try {
    const run = await loadRun(path.resolve(dir), "latest");
    return run.payout ? `/runs/${run.id}` : "";
  } catch {
    return "";
  }
}

type Opts = Record<string, string | boolean | undefined> & {
  budget?: string;
  currency?: string;
  rules?: string;
  "rules-file"?: string;
  env?: string;
  dir?: string;
  "max-candidates"?: string;
  planted?: string;
  yes?: boolean;
  watch?: boolean;
  help?: boolean;
  "security-fix"?: string;
  "request-feature"?: string;
  amount?: string;
  note?: string;
};

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      budget: { type: "string" },
      currency: { type: "string" },
      rules: { type: "string" },
      "rules-file": { type: "string" },
      env: { type: "string" },
      dir: { type: "string" },
      "max-candidates": { type: "string" },
      planted: { type: "string" },
      yes: { type: "boolean" },
      watch: { type: "boolean" },
      "security-fix": { type: "string" },
      "request-feature": { type: "string" },
      amount: { type: "string" },
      note: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const opts = values as Opts;
  if (opts.help || positionals[0] === "help") return out(HELP);

  const commands = ["run", "plan", "pay", "status", "resplit", "publish", "pledges", "shipped", "withdraw",
    "setup", "model", "paypal", "approver", "rules", "web"];
  const cmd = commands.includes(positionals[0]) ? positionals.shift()! : "run";
  const settingsCmd = ["model", "paypal", "approver", "rules"].includes(cmd);
  const takesDir = ["run", "plan", "setup", "pledges"].includes(cmd) || opts["security-fix"] || opts["request-feature"];
  const dir = (takesDir ? positionals[0] : undefined) ?? opts.dir ?? ".";
  if (opts.env) process.loadEnvFile(opts.env);
  await loadSettings(dir);

  if (cmd === "setup") return setupCommand(dir);
  if (cmd === "web") return webCommand(positionals[0] === "latest" ? await latestPage(dir) : "");
  if (settingsCmd) {
    const set = positionals[0] === "set";
    if (positionals[0] && !set) throw new Error(`Use "pay-it-upstream ${cmd}" to show it or "pay-it-upstream ${cmd} set" to change it.`);
    if (cmd === "model") return modelCommand(dir, set);
    if (cmd === "paypal") return paypalCommand(dir, set);
    if (cmd === "approver") return approvalCommand(dir, set);
    if (set && !positionals[1]) throw new Error('Give the rules as text: pay-it-upstream rules set "Prefer security-critical packages."');
    return rulesCommand(dir, set ? positionals[1] : undefined);
  }

  if (opts["security-fix"] && opts["request-feature"]) throw new Error("Use --security-fix or --request-feature, not both.");
  const pledgePkg = opts["security-fix"] ?? opts["request-feature"];
  if (pledgePkg) {
    if (cmd !== "run") throw new Error(`--security-fix and --request-feature make a new pledge; they don't go with "${cmd}".`);
    const kind = opts["security-fix"] ? "security-fix" : "feature";
    return pledgeCommand(positionals[0] ?? dir, { kind, package: pledgePkg, amount: opts.amount, note: opts.note, currency: opts.currency });
  }
  if (opts.amount || opts.note) throw new Error("--amount and --note go with --security-fix or --request-feature.");

  if (cmd === "pledges") {
    await pledgesCommand(positionals[0] ?? dir);
  } else if (cmd === "shipped" || cmd === "withdraw") {
    const id = positionals[0] ?? "latest";
    await (cmd === "shipped" ? shippedCommand : withdrawCommand)(dir, id, !!opts.yes);
  } else if (cmd === "plan") {
    await planRun(positionals[0] ?? dir, opts);
  } else if (cmd === "pay") {
    const run = await loadRun(path.resolve(dir), positionals[0] ?? "latest");
    printPlan(run);
    await payRun(run, opts);
    if (run.payout) await checkStatus(run, true);
  } else if (cmd === "resplit") {
    const child = await resplitRun(await loadRun(path.resolve(dir), positionals[0] ?? "latest"), opts);
    if (child) {
      await payRun(child, opts);
      if (child.payout) await checkStatus(child, true);
    }
  } else if (cmd === "publish") {
    if (!ledgerFromEnv()) throw new Error("Set LEDGER_URL and LEDGER_PUBLISH_TOKEN to publish.");
    await maybePublish(await loadRun(path.resolve(dir), positionals[0] ?? "latest"));
  } else if (cmd === "status") {
    if (positionals[0]) return checkStatus(await loadRun(path.resolve(dir), positionals[0]), !!opts.watch);
    await overview(dir, !!opts.watch);
  } else {
    const run = await planRun(positionals[0] ?? dir, opts);
    await payRun(run, opts);
    if (run.payout) await checkStatus(run, true);
  }
}

main().catch((e) => {
  console.error(`\nError: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
