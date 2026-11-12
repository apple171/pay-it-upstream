// Read-only views of the ledger for the site's pages. Statuses count as paid or waiting only when
// they came from a signature-checked PayPal webhook.
import type { Ledger, LedgerItem, Level } from "./store";
import { pledgeRows } from "./ledger";

export const REPO = "https://github.com/apple171/pay-it-upstream";

export type Tone = "ok" | "wait" | "bad" | "info" | "";

const WORDS: Record<string, string> = {
  SUCCESS: "paid",
  UNCLAIMED: "waiting to claim",
  SENT: "sent",
  PENDING: "processing",
  ONHOLD: "on hold",
  RETURNED: "returned",
  FAILED: "failed",
  BLOCKED: "blocked",
  CANCELED: "cancelled, re-split",
  DENIED: "denied",
  REFUNDED: "refunded",
};
export const statusWord = (s: string) => WORDS[s] ?? s.toLowerCase();
export function tone(s: string): Tone {
  if (s === "SUCCESS") return "ok";
  if (s === "UNCLAIMED" || s === "ONHOLD") return "wait";
  if (["RETURNED", "FAILED", "BLOCKED", "DENIED", "REFUNDED"].includes(s)) return "bad";
  if (s === "PENDING" || s === "SENT") return "info";
  return "";
}

export const money = (cents: number, currency = "USD") => {
  const v = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
  return currency === "USD" ? `$${v}` : `${v} ${currency}`;
};
export const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const pkgHref = (name: string) => `/packages/${name.split("/").map(encodeURIComponent).join("/")}`;

const items = (l: Ledger) => Object.values(l.items);
const isPaid = (i: LedgerItem) => i.verified && i.status === "SUCCESS";
const isWaiting = (i: LedgerItem) => i.verified && i.status === "UNCLAIMED";

export function stats(l: Ledger) {
  const all = items(l);
  const paid = all.filter(isPaid);
  const sum = (xs: LedgerItem[]) => xs.reduce((s, i) => s + i.amountCents, 0);
  const funded = new Set(paid.map((i) => i.package));
  const critical = [...new Set(Object.values(l.runs).flatMap((r) => r.critical ?? []))];
  const pledges = pledgeRows(l);
  const held = pledges.filter((p) => p.state === "held" && p.verified);
  return {
    paidCents: sum(paid),
    waitingCents: sum(all.filter(isWaiting)),
    sentCents: sum(all),
    payouts: all.length,
    packagesFunded: funded.size,
    maintainersPaid: new Set(paid.map((i) => i.maintainerMasked)).size,
    runs: Object.keys(l.runs).length,
    companies: new Set(Object.values(l.runs).map((r) => r.company)).size,
    signedEvents: Object.keys(l.events).length,
    refused: l.rejected.length,
    critical: { total: critical.length, funded: critical.filter((p) => funded.has(p)).length },
    pledges: pledges.length,
    heldCents: held.reduce((s, p) => s + p.amountCents, 0),
    openPledges: held.length,
  };
}

/* ---------- Runs ---------- */

export interface RunSummary {
  id: string;
  kind: "plan" | "resplit";
  parent?: string;
  createdAt: string;
  company: string;
  env: string;
  model: string;
  summary: string;
  budgetCents: number;
  currency: string;
  sentCents: number;
  paidCents: number;
  waitingCents: number;
  otherCents: number;
  payouts: number;
  paid: number;
  waiting: number;
}

export function runSummaries(l: Ledger): RunSummary[] {
  const byRun = new Map<string, LedgerItem[]>();
  for (const i of items(l)) byRun.set(i.runId, [...(byRun.get(i.runId) ?? []), i]);
  return Object.values(l.runs)
    .map((r) => {
      const its = byRun.get(r.id) ?? [];
      const sum = (f: (i: LedgerItem) => boolean) => its.filter(f).reduce((s, i) => s + i.amountCents, 0);
      const sent = sum(() => true);
      const paid = sum(isPaid);
      const waiting = sum(isWaiting);
      return {
        id: r.id,
        kind: r.kind ?? "plan",
        parent: r.parent,
        createdAt: r.createdAt,
        company: r.company,
        env: r.env,
        model: r.model,
        summary: r.summary,
        budgetCents: r.budgetCents,
        currency: r.currency,
        sentCents: sent,
        paidCents: paid,
        waitingCents: waiting,
        otherCents: sent - paid - waiting,
        payouts: its.length,
        paid: its.filter(isPaid).length,
        waiting: its.filter(isWaiting).length,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function runDetail(l: Ledger, id: string) {
  const run = l.runs[id];
  if (!run) return null;
  const summary = runSummaries(l).find((r) => r.id === id)!;
  const picks = items(l)
    .filter((i) => i.runId === id)
    .sort((a, b) => b.amountCents - a.amountCents);
  const children = runSummaries(l).filter((r) => r.parent === id);
  return { run, summary, picks, children };
}

/* ---------- Packages ---------- */

export interface PackageSummary {
  name: string;
  ecosystem: string;
  maintainer: string;
  sentCents: number;
  paidCents: number;
  waitingCents: number;
  payouts: number;
  runs: number;
  pledges: number;
  pledgedCents: number;
  critical: boolean;
  lastAt: string;
  levels?: LedgerItem["levels"];
  reason?: string;
}

export function packageSummaries(l: Ledger): PackageSummary[] {
  const critical = new Set(Object.values(l.runs).flatMap((r) => r.critical ?? []));
  const map = new Map<string, PackageSummary>();
  const get = (name: string, ecosystem: string, maintainer: string, at: string) => {
    let p = map.get(name);
    if (!p) {
      p = { name, ecosystem, maintainer, sentCents: 0, paidCents: 0, waitingCents: 0, payouts: 0, runs: 0, pledges: 0, pledgedCents: 0, critical: critical.has(name), lastAt: at };
      map.set(name, p);
    }
    if (at > p.lastAt) p.lastAt = at;
    return p;
  };
  const runsOf = new Map<string, Set<string>>();
  for (const i of [...items(l)].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
    const p = get(i.package, i.ecosystem, i.maintainerMasked, i.updatedAt);
    p.sentCents += i.amountCents;
    if (isPaid(i)) p.paidCents += i.amountCents;
    if (isWaiting(i)) p.waitingCents += i.amountCents;
    p.payouts++;
    p.levels = i.levels;
    p.reason = i.reason;
    runsOf.set(i.package, (runsOf.get(i.package) ?? new Set()).add(i.runId));
  }
  for (const pl of pledgeRows(l)) {
    const p = get(pl.package, pl.ecosystem, pl.maintainer, pl.at);
    p.pledges++;
    if (pl.state === "held" || pl.state === "shipped") p.pledgedCents += pl.amountCents;
  }
  for (const [name, set] of runsOf) map.get(name)!.runs = set.size;
  return [...map.values()];
}

export function packageDetail(l: Ledger, name: string) {
  const summary = packageSummaries(l).find((p) => p.name === name);
  if (!summary) return null;
  const payments = items(l)
    .filter((i) => i.package === name)
    .sort((a, b) => (b.history[0]?.at ?? b.updatedAt).localeCompare(a.history[0]?.at ?? a.updatedAt))
    .map((i) => ({ ...i, company: l.runs[i.runId]?.company ?? "", env: l.runs[i.runId]?.env ?? "", sentAt: i.history[0]?.at ?? i.updatedAt }));
  const pledges = pledgeRows(l).filter((p) => p.package === name);
  return { summary, payments, pledges };
}

/* ---------- PayPal events ---------- */

export function eventRows(l: Ledger) {
  return Object.values(l.events)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .map((e) => {
      const item = e.senderItemId ? l.items[e.senderItemId] : undefined;
      const pledge = Object.values(l.pledges ?? {}).find(
        (p) => (e.pledgeRef && [p.id, p.authorizationId, p.captureId].includes(e.pledgeRef)) || (e.senderItemId && `${p.id}-1` === e.senderItemId),
      );
      const amount = e.summary.match(/[A-Z]{3} [\d.]+$/)?.[0];
      return {
        id: e.id,
        type: e.type,
        group: e.type.startsWith("PAYMENT.PAYOUTS") ? "payouts" : e.pledgeStep ? "pledges" : "other",
        receivedAt: e.receivedAt,
        status: e.status,
        amount,
        subject: item ? { label: item.package, href: `/runs/${item.runId}` } : pledge ? { label: `${pledge.package} pledge`, href: "/pledges" } : undefined,
      };
    });
}

/* ---------- Search ---------- */

export interface SearchHit {
  kind: "package" | "run" | "pledge" | "page";
  label: string;
  sub: string;
  href: string;
}

const PAGES: SearchHit[] = [
  { kind: "page", label: "Runs", sub: "every published funding run", href: "/runs" },
  { kind: "page", label: "Packages", sub: "everything funded so far", href: "/packages" },
  { kind: "page", label: "Pledges", sub: "money held for a fix or feature", href: "/pledges" },
  { kind: "page", label: "Proof", sub: "PayPal-signed event log", href: "/proof" },
  { kind: "page", label: "Dashboard", sub: "explore and ask AI", href: "/dashboard" },
  { kind: "page", label: "For maintainers", sub: "claim what's waiting", href: "/maintainers" },
  { kind: "page", label: "How it works", sub: "signals, money rules, PayPal", href: "/how-it-works" },
];

export function search(l: Ledger, q: string, limit = 12): SearchHit[] {
  const s = q.trim().toLowerCase();
  const pkgs: SearchHit[] = packageSummaries(l)
    .sort((a, b) => b.sentCents + b.pledgedCents - (a.sentCents + a.pledgedCents))
    .map((p) => ({
      kind: "package",
      label: p.name,
      sub: [p.paidCents && `${money(p.paidCents)} paid`, p.waitingCents && `${money(p.waitingCents)} waiting`, p.pledges && `${p.pledges} pledge${p.pledges > 1 ? "s" : ""}`].filter(Boolean).join(" · ") || p.ecosystem,
      href: pkgHref(p.name),
    }));
  const runs: SearchHit[] = runSummaries(l).map((r) => ({
    kind: "run",
    label: r.id,
    sub: `${r.company} · ${money(r.sentCents)} to ${r.payouts} packages`,
    href: `/runs/${r.id}`,
  }));
  const pledges: SearchHit[] = pledgeRows(l).map((p) => ({
    kind: "pledge",
    label: `${p.package}: ${p.what}`,
    sub: `${money(p.amountCents)} · ${p.state}`,
    href: `/pledges?focus=${p.id}`,
  }));
  if (!s) return [...pkgs.slice(0, 6), ...PAGES].slice(0, limit);
  const match = (h: SearchHit) => h.label.toLowerCase().includes(s) || h.sub.toLowerCase().includes(s);
  return [...pkgs, ...runs, ...pledges, ...PAGES].filter(match).slice(0, limit);
}

export const LEVEL_SCORE: Record<Level, number> = { low: 1, medium: 2, high: 3 };
