// Flat tables for the AG Studio dashboard, built from the ledger. No emails beyond the masked ones stored.
import type { Ledger, LedgerItem, Level } from "./store";

export const STATUS_LABEL: Record<string, string> = {
  SUCCESS: "paid",
  UNCLAIMED: "waiting to claim",
  SENT: "sent",
  PENDING: "processing",
  ONHOLD: "on hold",
  RETURNED: "returned",
  FAILED: "failed",
  BLOCKED: "blocked",
  DENIED: "denied",
  CANCELED: "canceled",
  REFUNDED: "refunded",
};
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.toLowerCase();

const SCORE: Record<Level, number> = { low: 1, medium: 2, high: 3 };
const dollars = (cents: number) => Math.round(cents) / 100;

export interface PayoutRow {
  id: string;
  sentAt: string;
  /** When PayPal last confirmed a status; null while it is still only "sent". */
  settledAt: string | null;
  package: string;
  ecosystem: string;
  amount: number;
  currency: string;
  status: string;
  statusCode: string;
  verified: boolean;
  /** e.g. "sent → paid" */
  steps: string;
  reliance: string;
  fragility: string;
  underfunded: string;
  relianceScore: number | null;
  fragilityScore: number | null;
  underfundedScore: number | null;
  maintainer: string;
  company: string;
  runId: string;
  env: string;
  reason: string;
  evidence: string;
  paidAmount: number;
  waitingAmount: number;
}

export interface RunRow {
  id: string;
  date: string;
  company: string;
  kind: string;
  env: string;
  budget: number;
  spent: number;
  paid: number;
  waiting: number;
  payouts: number;
  model: string;
  methodFingerprint: string;
  rulesFingerprint: string;
  summary: string;
}

export interface CriticalRow {
  package: string;
  funded: boolean;
  fundedCount: number;
  paid: number;
}

export interface EventRow {
  id: string;
  receivedAt: string;
  type: string;
  status: string;
  amount: number | null;
  currency: string;
  package: string;
  payoutId: string | null;
}

export interface DashboardData {
  asOf: string;
  rejectedWebhooks: number;
  payouts: PayoutRow[];
  runs: RunRow[];
  critical: CriticalRow[];
  events: EventRow[];
}

const isPaid = (i: LedgerItem) => i.verified && i.status === "SUCCESS";
const isWaiting = (i: LedgerItem) => i.verified && i.status === "UNCLAIMED";

export function dashboardData(l: Ledger): DashboardData {
  const items = Object.values(l.items);

  const payouts: PayoutRow[] = items.map((i) => {
    const run = l.runs[i.runId];
    const final = i.history.at(-1);
    return {
      id: i.senderItemId,
      sentAt: i.history[0]?.at ?? i.updatedAt,
      settledAt: final?.eventId ? final.at : null,
      package: i.package,
      ecosystem: i.ecosystem,
      amount: dollars(i.amountCents),
      currency: i.currency,
      status: statusLabel(i.status),
      statusCode: i.status,
      verified: i.verified,
      steps: i.history.map((h) => statusLabel(h.status)).join(" → "),
      reliance: i.levels.reliance ?? "",
      fragility: i.levels.fragility ?? "",
      underfunded: i.levels.underfunded ?? "",
      relianceScore: i.levels.reliance ? SCORE[i.levels.reliance] : null,
      fragilityScore: i.levels.fragility ? SCORE[i.levels.fragility] : null,
      underfundedScore: i.levels.underfunded ? SCORE[i.levels.underfunded] : null,
      maintainer: i.maintainerMasked,
      company: run?.company ?? "",
      runId: i.runId,
      env: run?.env ?? "",
      reason: i.reason,
      evidence: i.evidence.join(" · "),
      paidAmount: isPaid(i) ? dollars(i.amountCents) : 0,
      waitingAmount: isWaiting(i) ? dollars(i.amountCents) : 0,
    };
  });

  const runs: RunRow[] = Object.values(l.runs).map((r) => {
    const mine = items.filter((i) => i.runId === r.id);
    const sum = (xs: LedgerItem[]) => dollars(xs.reduce((s, i) => s + i.amountCents, 0));
    return {
      id: r.id,
      date: r.createdAt,
      company: r.company,
      kind: r.kind,
      env: r.env,
      budget: dollars(r.budgetCents),
      spent: sum(mine),
      paid: sum(mine.filter(isPaid)),
      waiting: sum(mine.filter(isWaiting)),
      payouts: mine.length,
      model: r.model,
      methodFingerprint: r.methodologyFingerprint,
      rulesFingerprint: r.rulesFingerprint,
      summary: r.summary,
    };
  });

  const paidByPkg = new Map<string, number>();
  for (const i of items.filter(isPaid)) paidByPkg.set(i.package, (paidByPkg.get(i.package) ?? 0) + i.amountCents);
  const critical: CriticalRow[] = [...new Set(Object.values(l.runs).flatMap((r) => r.critical ?? []))]
    .sort()
    .map((p) => ({
      package: p,
      funded: paidByPkg.has(p),
      fundedCount: paidByPkg.has(p) ? 1 : 0,
      paid: dollars(paidByPkg.get(p) ?? 0),
    }));

  const events: EventRow[] = Object.values(l.events).map((e) => {
    const money = e.summary.match(/([A-Z]{3}) (\d+(?:\.\d+)?)$/);
    const item = e.senderItemId ? l.items[e.senderItemId] : undefined;
    return {
      id: e.id,
      receivedAt: e.receivedAt,
      type: e.type.replace(/^PAYMENT\./, ""),
      status: e.status ? statusLabel(e.status) : "",
      amount: money ? Number(money[2]) : null,
      currency: money?.[1] ?? "",
      package: item?.package ?? "",
      payoutId: item ? item.senderItemId : null,
    };
  });

  return {
    asOf: new Date().toISOString(),
    rejectedWebhooks: l.rejected.length,
    payouts,
    runs,
    critical,
    events,
  };
}
