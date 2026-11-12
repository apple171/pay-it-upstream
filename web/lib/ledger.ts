// Ledger rules: publishing a run, applying verified PayPal events, and the public totals.
import type { Ledger, LedgerEvent, LedgerPledge, PublishedPledge, PublishedRun } from "./store";

const ITEM_EVENT_STATUS: Record<string, string> = {
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": "SUCCESS",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": "UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED": "RETURNED",
  "PAYMENT.PAYOUTS-ITEM.FAILED": "FAILED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED": "BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED": "CANCELED",
  "PAYMENT.PAYOUTS-ITEM.DENIED": "DENIED",
  "PAYMENT.PAYOUTS-ITEM.HELD": "ONHOLD",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED": "REFUNDED",
};

export const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/;
/** e.g. "m***@g***.com": one visible letter on each side. */
export const MASKED = /^[^@*]?\*\*\*@[^@*]?\*\*\*(\.[A-Za-z0-9.-]+)?$/;

/** Throws if the payload is malformed or carries an unmasked email. */
export function checkPublished(run: PublishedRun) {
  if (!run || typeof run.id !== "string" || !/^[\w-]{6,80}$/.test(run.id)) throw new Error("bad run id");
  if (!Array.isArray(run.items) || run.items.length > 100) throw new Error("bad items");
  for (const it of run.items) {
    if (!(Number.isInteger(it.amountCents) && it.amountCents > 0)) throw new Error("bad amount");
    if (!it.senderItemId || !it.package) throw new Error("bad item");
    if (!MASKED.test(it.maintainerMasked)) {
      throw new Error("maintainer emails must be masked");
    }
  }
  if (EMAIL.test(JSON.stringify({ ...run, items: run.items.map((i) => ({ ...i, maintainerMasked: "" })) }))) {
    throw new Error("payload contains an email address");
  }
}

const PLEDGE_EVENT_STEP: Record<string, LedgerEvent["pledgeStep"]> = {
  "PAYMENT.AUTHORIZATION.CREATED": "held",
  "PAYMENT.AUTHORIZATION.VOIDED": "released",
  "PAYMENT.CAPTURE.COMPLETED": "collected",
};
const PLEDGE_STATES = ["held", "shipped", "withdrawn", "expired"];

/** Throws if the pledge payload is malformed or carries an unmasked email. */
export function checkPledge(p: PublishedPledge) {
  if (!p || typeof p.id !== "string" || !/^pl-[\w-]{6,80}$/.test(p.id)) throw new Error("bad pledge id");
  if (p.kind !== "security-fix" && p.kind !== "feature") throw new Error("bad kind");
  if (!(Number.isInteger(p.amountCents) && p.amountCents > 0)) throw new Error("bad amount");
  if (!p.package || typeof p.what !== "string" || p.what.length > 300) throw new Error("bad pledge");
  if (!PLEDGE_STATES.includes(p.state)) throw new Error("bad state");
  if (!MASKED.test(p.maintainerMasked)) throw new Error("maintainer emails must be masked");
  if (EMAIL.test(JSON.stringify({ ...p, maintainerMasked: "" }))) throw new Error("payload contains an email address");
}

export function applyPledge(l: Ledger, p: PublishedPledge) {
  l.pledges ??= {};
  const prev = l.pledges[p.id];
  // Keep only the published fields (drop anything extra the client sent).
  const { id, kind, company, env, package: pkg, ecosystem, what, amountCents, currency, createdAt, maintainerMasked, state, heldUntil, authorizationId, captureId, payoutBatchId, payoutItemId } = p;
  l.pledges[p.id] = {
    id, kind, company, env, package: pkg, ecosystem, what, amountCents, currency, createdAt, maintainerMasked, state, heldUntil, authorizationId, captureId, payoutBatchId, payoutItemId,
    paypal: prev?.paypal ?? {},
    updatedAt: new Date().toISOString(),
  };
  for (const ev of Object.values(l.events)) applyEventToPledge(l, ev);
}

function applyEventToPledge(l: Ledger, ev: LedgerEvent) {
  const pledges = Object.values(l.pledges ?? {});
  if (ev.pledgeRef && ev.pledgeStep) {
    const p = pledges.find((x) => [x.id, x.authorizationId, x.captureId].includes(ev.pledgeRef));
    if (p && !p.paypal[ev.pledgeStep]) {
      p.paypal[ev.pledgeStep] = ev.receivedAt;
      p.updatedAt = ev.receivedAt;
    }
  }
  // The maintainer payout for a shipped pledge has sender item id "<pledge id>-1".
  if (ev.senderItemId && ev.status) {
    const p = pledges.find((x) => `${x.id}-1` === ev.senderItemId);
    if (p && !(ev.status === "PENDING" && p.paypal.payout)) {
      p.paypal.payout = ev.status;
      p.updatedAt = ev.receivedAt;
    }
  }
}

export function applyPublished(l: Ledger, run: PublishedRun) {
  const { items, ...meta } = run;
  l.runs[run.id] = meta;
  const now = new Date().toISOString();
  for (const it of items) {
    const prev = l.items[it.senderItemId];
    l.items[it.senderItemId] = {
      ...it,
      runId: run.id,
      currency: run.currency,
      status: prev?.status ?? "SENT",
      verified: prev?.verified ?? false,
      payoutItemId: prev?.payoutItemId,
      transactionId: prev?.transactionId,
      updatedAt: prev?.updatedAt ?? now,
      history: prev?.history ?? [{ status: "SENT", at: now }],
    };
  }
  // A webhook can arrive before the run is published: apply what we already have.
  for (const ev of Object.values(l.events)) applyEventToItem(l, ev);
}

function applyEventToItem(l: Ledger, ev: LedgerEvent) {
  if (!ev.senderItemId || !ev.status) return;
  const item = l.items[ev.senderItemId];
  if (!item || item.history.some((h) => h.eventId === ev.id)) return;
  // Never step back to "pending" after a final status.
  if (ev.status === "PENDING" && item.status !== "SENT") return;
  item.status = ev.status;
  item.verified = true;
  item.updatedAt = ev.receivedAt;
  item.history.push({ status: ev.status, at: ev.receivedAt, eventId: ev.id });
}

/** Records a signature-checked PayPal event. Returns false for a repeat delivery. */
export function applyVerifiedEvent(l: Ledger, event: any): boolean {
  if (!event?.id || l.events[event.id]) return false;
  const type = String(event.event_type ?? "");
  const r = event.resource ?? {};
  const senderItemId = r.payout_item?.sender_item_id;
  const status = type.startsWith("PAYMENT.PAYOUTS-ITEM.") ? (r.transaction_status ?? ITEM_EVENT_STATUS[type]) : undefined;
  const batchId = r.payout_batch_id ?? r.batch_header?.payout_batch_id;
  const pledgeStep = PLEDGE_EVENT_STEP[type];
  // Authorizations and captures carry our pledge id as custom_id; fall back to PayPal's own ids.
  const pledgeRef = pledgeStep ? (r.custom_id ?? r.supplementary_data?.related_ids?.authorization_id ?? r.id) : undefined;
  const amount = r.payout_item?.amount ?? r.batch_header?.amount ?? (pledgeStep ? { currency: r.amount?.currency_code, value: r.amount?.value } : undefined);
  const ev: LedgerEvent = {
    id: event.id,
    type,
    receivedAt: new Date().toISOString(),
    senderItemId,
    batchId,
    status,
    pledgeRef,
    pledgeStep,
    summary: [type, status, amount?.value ? `${amount.currency} ${amount.value}` : ""].filter(Boolean).join(" · "),
  };
  l.events[ev.id] = ev;
  const item = senderItemId ? l.items[senderItemId] : undefined;
  if (item) {
    if (r.payout_item_id) item.payoutItemId = r.payout_item_id;
    if (r.transaction_id) item.transactionId = r.transaction_id;
  }
  applyEventToItem(l, ev);
  applyEventToPledge(l, ev);
  return true;
}

export interface LedgerView {
  totals: {
    paidCents: number;
    waitingCents: number;
    sentCents: number;
    packagesFunded: number;
    maintainersPaid: number;
    runs: number;
    companies: number;
  };
  critical: { total: number; funded: number; packages: { package: string; funded: boolean }[] };
  recent: {
    package: string;
    ecosystem: string;
    amount: string;
    status: string;
    verified: boolean;
    maintainer: string;
    company: string;
    reason: string;
    at: string;
    runId: string;
    env: string;
  }[];
  topPackages: { package: string; paid: string; payments: number }[];
  pledges: {
    id: string;
    kind: string;
    package: string;
    ecosystem: string;
    what: string;
    amountCents: number;
    currency: string;
    /** held, shipped, withdrawn or expired */
    state: string;
    /** True when PayPal's signed webhooks confirm the current state. */
    verified: boolean;
    payout?: string;
    maintainer: string;
    company: string;
    env: string;
    heldUntil?: string;
    at: string;
  }[];
  pledgeTotals: { heldCents: number; paidCents: number; open: number };
  events: LedgerEvent[];
  rejectedWebhooks: number;
}

const usd = (cents: number) => (cents / 100).toFixed(2);

export function view(l: Ledger): LedgerView {
  const items = Object.values(l.items);
  const paid = items.filter((i) => i.verified && i.status === "SUCCESS");
  const sum = (xs: typeof items) => xs.reduce((s, i) => s + i.amountCents, 0);
  const fundedPkgs = new Set(paid.map((i) => i.package));
  const critical = [...new Set(Object.values(l.runs).flatMap((r) => r.critical ?? []))].sort();

  const byPkg = new Map<string, { cents: number; n: number }>();
  for (const i of paid) {
    const v = byPkg.get(i.package) ?? { cents: 0, n: 0 };
    v.cents += i.amountCents;
    v.n++;
    byPkg.set(i.package, v);
  }

  return {
    totals: {
      paidCents: sum(paid),
      waitingCents: sum(items.filter((i) => i.verified && i.status === "UNCLAIMED")),
      sentCents: sum(items),
      packagesFunded: fundedPkgs.size,
      maintainersPaid: new Set(paid.map((i) => i.maintainerMasked)).size,
      runs: Object.keys(l.runs).length,
      companies: new Set(Object.values(l.runs).map((r) => r.company)).size,
    },
    critical: {
      total: critical.length,
      funded: critical.filter((p) => fundedPkgs.has(p)).length,
      packages: critical.map((p) => ({ package: p, funded: fundedPkgs.has(p) })),
    },
    recent: items
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 50)
      .map((i) => ({
        package: i.package,
        ecosystem: i.ecosystem,
        amount: `${i.currency} ${usd(i.amountCents)}`,
        status: i.status,
        verified: i.verified,
        maintainer: i.maintainerMasked,
        company: l.runs[i.runId]?.company ?? "",
        reason: i.reason,
        at: i.updatedAt,
        runId: i.runId,
        env: l.runs[i.runId]?.env ?? "",
      })),
    pledges: pledgeRows(l),
    pledgeTotals: (() => {
      const rows = pledgeRows(l);
      const sumOf = (xs: typeof rows) => xs.reduce((s, p) => s + p.amountCents, 0);
      const held = rows.filter((p) => p.state === "held" && p.verified);
      return { heldCents: sumOf(held), paidCents: sumOf(rows.filter((p) => p.payout === "SUCCESS")), open: held.length };
    })(),
    topPackages: [...byPkg]
      .sort((a, b) => b[1].cents - a[1].cents)
      .slice(0, 10)
      .map(([pkg, v]) => ({ package: pkg, paid: usd(v.cents), payments: v.n })),
    events: Object.values(l.events)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, 20),
    rejectedWebhooks: l.rejected.length,
  };
}

/** Pledges for display. A state counts as confirmed only when the matching PayPal webhook arrived. */
export function pledgeRows(l: Ledger): LedgerView["pledges"] {
  const confirmed = (p: LedgerPledge) =>
    p.state === "held" ? !!p.paypal.held
    : p.state === "shipped" ? !!p.paypal.collected
    : p.state === "withdrawn" ? !!p.paypal.released
    : false;
  return Object.values(l.pledges ?? {})
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 50)
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      package: p.package,
      ecosystem: p.ecosystem,
      what: p.what,
      amountCents: p.amountCents,
      currency: p.currency,
      state: p.state,
      verified: confirmed(p),
      payout: p.paypal.payout,
      maintainer: p.maintainerMasked,
      company: p.company,
      env: p.env,
      heldUntil: p.heldUntil,
      at: p.updatedAt,
    }));
}
