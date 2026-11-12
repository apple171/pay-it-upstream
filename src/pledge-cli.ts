// CLI side of pledges: --security-fix / --request-feature, pledges, shipped, withdraw.
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { scanFolder } from "./lockfiles/index.ts";
import { mergeDeps } from "./candidates.ts";
import { gatherSignals } from "./signals/index.ts";
import { PayPalClient, paypalConfigFromEnv } from "./paypal/client.ts";
import { STATUS_WORDS } from "./payout-run.ts";
import { ledgerFromEnv } from "./publish.ts";
import {
  createPledge, settleApproval, shipPledge, withdrawPledge, refreshPledge, listPledges, loadPledge, savePledge,
  KIND_WORDS, STATE_WORDS, type PledgeKind, type PledgeRecord,
} from "./pledges.ts";
import { publishPledgeIfConfigured } from "./publish-pledge.ts";

const out = (s = "") => console.log(s);
const step = (s: string) => console.log(`\n▸ ${s}`);
const money = (c: number, cur: string) => (cur === "USD" ? `$${(c / 100).toFixed(2)}` : `${(c / 100).toFixed(2)} ${cur}`);
const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return a === "y" || a === "yes";
}

async function publish(p: PledgeRecord) {
  const r = await publishPledgeIfConfigured(p);
  if (r.published) out(`  On the public ledger: ${r.published}`);
  if (r.publishError) out(`  Couldn't update the public ledger: ${r.publishError}`);
}

function describe(p: PledgeRecord) {
  out(`  ${p.id}  ${KIND_WORDS[p.kind]} in ${p.package} (${p.ecosystem})`);
  out(`    "${p.what}"`);
  out(`    ${money(p.amountCents, p.currency)} · maintainer ${p.maintainerMasked} · ${STATE_WORDS[p.state]}` +
    (p.state === "held" && p.heldUntil ? ` until ${p.heldUntil.slice(0, 10)}` : "") +
    (p.payout?.status ? ` · payout ${STATUS_WORDS[p.payout.status] ?? p.payout.status.toLowerCase()}` : ""));
}

export interface PledgeOpts {
  kind: PledgeKind;
  package: string;
  amount?: string;
  note?: string;
  currency?: string;
}

/** pay-it-upstream --security-fix <pkg> | --request-feature <pkg> --amount 100 --note "..." [dir] */
export async function pledgeCommand(dir: string, o: PledgeOpts) {
  const project = path.resolve(dir);
  const amountCents = Math.round(Number(o.amount) * 100);
  if (!o.amount || !(amountCents >= 500)) throw new Error("Give --amount of at least 5, e.g. --amount 100.");
  if (amountCents % 100) throw new Error("--amount must be whole dollars.");
  const currency = (o.currency ?? "USD").toUpperCase();
  const what = o.note?.trim() || (o.kind === "security-fix" ? "a fix for a reported security issue" : "the requested feature");

  step(`Checking ${o.package}`);
  const dep = mergeDeps((await scanFolder(project)).map((s) => s.deps)).find((d) => d.name === o.package);
  if (!dep) throw new Error(`${o.package} isn't in this project's lockfiles. Pledges are for packages you depend on.`);
  const [sig] = await gatherSignals([dep], { cacheDir: path.join(project, ".pay-it-upstream", "cache") });
  const maintainer = sig.maintainers.find((m) => m.email);
  if (!maintainer?.email) throw new Error(`${o.package} has no maintainer contact in its registry metadata, so a pledge couldn't be paid out.`);
  out(`  ${dep.ecosystem} package, ${dep.direct ? "a direct dependency" : `used by ${dep.dependedOnBy} of your packages`}; maintainer ${sig.maintainers.length > 1 ? `(1 of ${sig.maintainers.length}) ` : ""}found in registry metadata`);

  const pp = new PayPalClient(paypalConfigFromEnv());
  const ledger = ledgerFromEnv();
  step(`Creating a ${money(amountCents, currency)} hold with PayPal`);
  const p = await createPledge(pp, {
    project, kind: o.kind, package: o.package, ecosystem: dep.ecosystem, what, amountCents, currency,
    maintainerEmail: maintainer.email,
    returnUrl: ledger ? `${ledger.url}/pledges?pledge={id}` : "https://example.org/pay-it-upstream-pledge",
  });
  out(`  Pledge ${p.id}: ${KIND_WORDS[p.kind]} in ${p.package}, "${what}"`);
  out(`  Nothing is charged now. The money is only held, and it is paid to the maintainer only if this ships.`);
  out(`\n  Approve the hold in PayPal:\n  ${p.approveUrl}\n`);

  // Wait for the approval, then place the hold.
  const started = Date.now();
  process.stdout.write("  Waiting for approval (Ctrl+C to stop; `pay-it-upstream pledges` finishes it later) ");
  for (;;) {
    if (await settleApproval(pp, p)) break;
    if (Date.now() - started > 15 * 60_000) {
      out("\n  Still not approved. Run `pay-it-upstream pledges` after approving to place the hold.");
      return;
    }
    process.stdout.write(".");
    await sleep(3000);
  }
  out("");
  step("Money held");
  describe(p);
  out(`\n  When it ships:      pay-it-upstream shipped ${p.id}`);
  out(`  If it doesn't:      pay-it-upstream withdraw ${p.id}`);
  out(`  PayPal releases the hold by itself on ${p.heldUntil?.slice(0, 10)} if neither happens.`);
  await publish(p);
}

/** pay-it-upstream pledges [--dir d]: lists pledges after reading their latest state from PayPal. */
export async function pledgesCommand(dir: string) {
  const project = path.resolve(dir);
  const all = await listPledges(project);
  if (!all.length) return out("No pledges yet. Make one with --security-fix <package> or --request-feature <package>.");
  const pp = new PayPalClient(paypalConfigFromEnv());
  step(`Pledges in ${project}`);
  for (const p of all) {
    const before = p.state + (p.payout?.status ?? "");
    if (p.state === "awaiting-approval" || p.state === "held" || (p.payout && p.payout.status !== "SUCCESS")) await refreshPledge(pp, p);
    describe(p);
    if (p.state === "awaiting-approval") out(`    approve: ${p.approveUrl}`);
    if (before !== p.state + (p.payout?.status ?? "")) await publish(p);
  }
  const held = all.filter((p) => p.state === "held");
  if (held.length) out(`\n  ${money(held.reduce((s, p) => s + p.amountCents, 0), held[0].currency)} held across ${held.length} pledge(s).`);
}

/** pay-it-upstream shipped <pledge>: collect the hold and pay the maintainer. */
export async function shippedCommand(dir: string, id: string, yes: boolean) {
  const p = await loadPledge(path.resolve(dir), id);
  describe(p);
  if (p.state === "shipped") return out("\n  Already paid. Nothing to do.");
  if (!yes && !(await confirm(`\nDid this ship? Collect ${money(p.amountCents, p.currency)} and pay the maintainer?`))) return out("Nothing was paid.");
  const pp = new PayPalClient(paypalConfigFromEnv());
  step("Collecting the hold and paying the maintainer");
  await shipPledge(pp, p);
  await sleep(4000);
  await refreshPledge(pp, p);
  if (p.env === "sandbox") out("  (sandbox: the maintainer is stood in for by a test account)");
  describe(p);
  await publish(p);
}

/** pay-it-upstream withdraw <pledge>: release the hold. */
export async function withdrawCommand(dir: string, id: string, yes: boolean) {
  const p = await loadPledge(path.resolve(dir), id);
  describe(p);
  if (p.state === "withdrawn" || p.state === "expired") return out("\n  Already released. Nothing to do.");
  if (!yes && !(await confirm(`\nRelease the ${money(p.amountCents, p.currency)} hold? The maintainer gets nothing for this pledge.`))) return out("Kept the hold.");
  const pp = new PayPalClient(paypalConfigFromEnv());
  step("Releasing the hold");
  await withdrawPledge(pp, p);
  describe(p);
  await savePledge(p);
  await publish(p);
}
