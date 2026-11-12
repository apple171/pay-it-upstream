// Pledges: money promised toward a security fix or a feature in one package.
//
// The company's money is held with a PayPal authorization (Orders API, intent AUTHORIZE) made out
// to the company's own PayPal account, so the hold can always be released. When the fix or feature
// ships, the hold is captured and the same amount goes to the maintainer with PayPal Payouts. If it
// doesn't ship, the hold is voided and nothing is charged. Prints nothing; the CLI does that.
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PayPalError, type PayPalClient } from "./paypal/client.ts";
import { sendBatch, getBatch } from "./paypal/payouts.ts";
import { maskEmail } from "./payees.ts";
import { receiversFor, STATUS_WORDS } from "./payout-run.ts";
import { newRunId } from "./runs.ts";
import type { Ecosystem } from "./types.ts";

export type PledgeKind = "security-fix" | "feature";
export type PledgeState = "awaiting-approval" | "held" | "shipped" | "withdrawn" | "expired";

export interface PledgeRecord {
  id: string;
  kind: PledgeKind;
  project: string;
  package: string;
  ecosystem: Ecosystem;
  /** What has to ship for the money to be paid, in the company's words. */
  what: string;
  amountCents: number;
  currency: string;
  createdAt: string;
  env: "sandbox" | "live";
  /** Real maintainer email from registry metadata (kept on this machine only) and its masked form. */
  maintainerEmail: string;
  maintainerMasked: string;
  state: PledgeState;
  orderId: string;
  approveUrl: string;
  authorizationId?: string;
  /** When PayPal drops the hold if nothing happens (about 29 days). */
  heldUntil?: string;
  capture?: { id: string; at: string; feeCents?: number };
  payout?: { senderBatchId: string; batchId: string; receiver: string; sentAt: string; status?: string };
  events: { at: string; text: string }[];
}

export const KIND_WORDS: Record<PledgeKind, string> = { "security-fix": "security fix", feature: "feature" };
export const STATE_WORDS: Record<PledgeState, string> = {
  "awaiting-approval": "waiting for your PayPal approval",
  held: "held",
  shipped: "shipped",
  withdrawn: "withdrawn (hold released)",
  expired: "expired (hold released by PayPal)",
};

const cents = (v: string | undefined) => (v === undefined ? undefined : Math.round(Number(v) * 100));
const value = (c: number) => (c / 100).toFixed(2);
const note = (p: PledgeRecord, text: string) => p.events.push({ at: new Date().toISOString(), text });

export const pledgesDir = (project: string) => path.join(project, ".pay-it-upstream", "pledges");

export async function savePledge(p: PledgeRecord) {
  await mkdir(pledgesDir(p.project), { recursive: true });
  await writeFile(path.join(pledgesDir(p.project), `${p.id}.json`), JSON.stringify(p, null, 2));
}

export async function listPledges(project: string): Promise<PledgeRecord[]> {
  const files = (await readdir(pledgesDir(project)).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(pledgesDir(project), f), "utf8"))));
}

export async function loadPledge(project: string, id: string): Promise<PledgeRecord> {
  const all = await listPledges(project);
  if (!all.length) throw new Error(`No pledges yet in ${project}. Make one with --security-fix or --request-feature.`);
  const p = id === "latest" ? all[all.length - 1] : all.find((x) => x.id === id || x.id === `pl-${id}`);
  if (!p) throw new Error(`No pledge "${id}". Latest is ${all[all.length - 1].id}.`);
  return p;
}

export interface NewPledge {
  project: string;
  kind: PledgeKind;
  package: string;
  ecosystem: Ecosystem;
  what: string;
  amountCents: number;
  currency: string;
  maintainerEmail: string;
  /** Where PayPal sends the payer after approving. */
  returnUrl: string;
}

/** Creates the PayPal order. The payer approves it at approveUrl; then call settleApproval. */
export async function createPledge(pp: PayPalClient, n: NewPledge): Promise<PledgeRecord> {
  const id = `pl-${newRunId()}`;
  const label = `${KIND_WORDS[n.kind]} in ${n.package}`;
  const order = await pp.call(
    "POST",
    "/v2/checkout/orders",
    {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: id,
          custom_id: id,
          description: `Pledge toward a ${label}: ${n.what}`.slice(0, 127),
          amount: { currency_code: n.currency, value: value(n.amountCents) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Pay It Upstream",
            user_action: "CONTINUE",
            shipping_preference: "NO_SHIPPING",
            return_url: n.returnUrl.replace("{id}", id),
            cancel_url: n.returnUrl.replace("{id}", id),
          },
        },
      },
    },
    { "PayPal-Request-Id": id },
  );
  const p: PledgeRecord = {
    id,
    kind: n.kind,
    project: n.project,
    package: n.package,
    ecosystem: n.ecosystem,
    what: n.what,
    amountCents: n.amountCents,
    currency: n.currency,
    createdAt: new Date().toISOString(),
    env: pp.config.env,
    maintainerEmail: n.maintainerEmail,
    maintainerMasked: maskEmail(n.maintainerEmail),
    state: "awaiting-approval",
    orderId: order.id,
    approveUrl: order.links.find((l: any) => l.rel === "payer-action" || l.rel === "approve")?.href ?? "",
    events: [],
  };
  note(p, `Created PayPal order ${order.id} for ${value(n.amountCents)} ${n.currency}`);
  await savePledge(p);
  return p;
}

/** If the payer has approved the order, places the hold. Returns true once the money is held. */
export async function settleApproval(pp: PayPalClient, p: PledgeRecord): Promise<boolean> {
  if (p.state !== "awaiting-approval") return p.state === "held";
  const order = await pp.call("GET", `/v2/checkout/orders/${p.orderId}`);
  if (order.status !== "APPROVED" && order.status !== "COMPLETED") return false;
  const done =
    order.status === "COMPLETED"
      ? order
      : await pp.call("POST", `/v2/checkout/orders/${p.orderId}/authorize`, {}, { "PayPal-Request-Id": `${p.id}-auth`, Prefer: "return=representation" });
  const auth = done.purchase_units[0].payments.authorizations[0];
  p.authorizationId = auth.id;
  p.heldUntil = auth.expiration_time;
  p.state = "held";
  note(p, `Held ${auth.amount.value} ${auth.amount.currency_code} (authorization ${auth.id}) until ${auth.expiration_time?.slice(0, 10)}`);
  await savePledge(p);
  return true;
}

/** The fix or feature shipped: capture the hold and pay the maintainer with Payouts. Safe to re-run. */
export async function shipPledge(pp: PayPalClient, p: PledgeRecord): Promise<PledgeRecord> {
  if (p.state === "awaiting-approval") await settleApproval(pp, p);
  if (p.state === "withdrawn" || p.state === "expired") throw new Error(`This pledge is ${STATE_WORDS[p.state]}, so there is nothing to pay.`);
  if (p.state === "awaiting-approval") throw new Error("This pledge hasn't been approved in PayPal yet, so no money is held.");
  if (!p.capture) {
    const c = await pp.call(
      "POST",
      `/v2/payments/authorizations/${p.authorizationId}/capture`,
      { final_capture: true, invoice_id: p.id, note_to_payer: `${KIND_WORDS[p.kind]} in ${p.package} shipped` },
      { "PayPal-Request-Id": `${p.id}-capture`, Prefer: "return=representation" },
    );
    p.capture = { id: c.id, at: new Date().toISOString(), feeCents: cents(c.seller_receivable_breakdown?.paypal_fee?.value) };
    note(p, `Collected the hold (capture ${c.id})`);
    await savePledge(p);
  }
  if (!p.payout) {
    const receiver = (await receiversFor(p.project, [p.maintainerEmail], p.env === "sandbox"))(p.maintainerEmail);
    const senderBatchId = `piu-${p.id}`;
    const res = await sendBatch(
      pp,
      senderBatchId,
      [
        {
          senderItemId: `${p.id}-1`,
          receiverEmail: receiver,
          amountCents: p.amountCents,
          currency: p.currency,
          note: `The ${KIND_WORDS[p.kind]} you shipped in ${p.package} ("${p.what}") was pledged by a project that depends on it, via Pay It Upstream (${p.id}). Thank you.`,
        },
      ],
      `A pledge for your ${KIND_WORDS[p.kind]} in ${p.package} was paid`,
      "A company that depends on your package pledged this for the work you shipped.",
    );
    if (!res.duplicate) {
      p.payout = { senderBatchId, batchId: res.batchId, receiver, sentAt: new Date().toISOString() };
      note(p, `Paid the maintainer ${value(p.amountCents)} ${p.currency} (PayPal batch ${res.batchId})`);
    }
  }
  p.state = "shipped";
  await savePledge(p);
  return p;
}

/** The fix or feature didn't ship: release the hold. Nothing is charged. */
export async function withdrawPledge(pp: PayPalClient, p: PledgeRecord): Promise<PledgeRecord> {
  if (p.state === "awaiting-approval") await settleApproval(pp, p);
  if (p.state === "shipped") throw new Error("This pledge was already paid, so it can't be withdrawn.");
  if (p.state === "withdrawn" || p.state === "expired") return p;
  if (p.state === "held") {
    try {
      await pp.call("POST", `/v2/payments/authorizations/${p.authorizationId}/void`, undefined, { "PayPal-Request-Id": `${p.id}-void` });
    } catch (e) {
      // Already voided or expired on PayPal's side: read the real status below.
      if (!(e instanceof PayPalError && e.status === 422)) throw e;
    }
    const a = await pp.call("GET", `/v2/payments/authorizations/${p.authorizationId}`);
    p.state = a.status === "EXPIRED" ? "expired" : "withdrawn";
    note(p, `Released the hold (authorization ${a.status.toLowerCase()})`);
  } else {
    // Never approved: nothing was held, and the order lapses on its own.
    p.state = "withdrawn";
    note(p, "Withdrawn before it was approved; nothing was held");
  }
  await savePledge(p);
  return p;
}

/** Reads PayPal once: places the hold if just approved, notices an expired hold, and reads the payout. */
export async function refreshPledge(pp: PayPalClient, p: PledgeRecord): Promise<PledgeRecord> {
  if (p.state === "awaiting-approval") await settleApproval(pp, p);
  if (p.state === "held" && p.authorizationId) {
    const a = await pp.call("GET", `/v2/payments/authorizations/${p.authorizationId}`);
    if (a.status === "EXPIRED" || a.status === "VOIDED") {
      p.state = a.status === "EXPIRED" ? "expired" : "withdrawn";
      note(p, `PayPal reports the hold as ${a.status.toLowerCase()}`);
    }
  }
  if (p.payout) {
    const item = (await getBatch(pp, p.payout.batchId)).items[0];
    if (item && item.status !== p.payout.status) {
      p.payout.status = item.status;
      if (item.status !== "PENDING") note(p, `Maintainer payout: ${STATUS_WORDS[item.status] ?? item.status.toLowerCase()}`);
    }
  }
  await savePledge(p);
  return p;
}
