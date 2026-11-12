// PayPal Payouts: send a batch, read statuses, cancel unclaimed items.
import { PayPalError, type PayPalClient } from "./client.ts";

export interface PayoutLine {
  /** Our own id for the line, unique within the batch. */
  senderItemId: string;
  receiverEmail: string;
  amountCents: number;
  currency: string;
  note: string;
}

export interface BatchResult {
  batchId: string;
  status: string;
  /** True when PayPal already had a batch with this sender_batch_id. Nothing was paid twice. */
  duplicate?: boolean;
}

export interface ItemStatus {
  itemId: string;
  senderItemId: string;
  receiver: string;
  amount: string;
  currency: string;
  status: string; // SUCCESS, UNCLAIMED, PENDING, FAILED, RETURNED, BLOCKED, REFUNDED, ONHOLD...
  transactionId?: string;
  error?: string;
}

export interface BatchStatus {
  batchId: string;
  status: string; // PENDING, PROCESSING, SUCCESS, DENIED, CANCELED
  items: ItemStatus[];
}

const toValue = (cents: number) => (cents / 100).toFixed(2);

export async function sendBatch(
  pp: PayPalClient,
  senderBatchId: string,
  lines: PayoutLine[],
  emailSubject = "You've received a payment for your open-source work",
  emailMessage = "A company that depends on your package is saying thanks.",
): Promise<BatchResult> {
  try {
    const res = await pp.call("POST", "/v1/payments/payouts", {
      sender_batch_header: {
        sender_batch_id: senderBatchId,
        email_subject: emailSubject,
        email_message: emailMessage,
      },
      items: lines.map((l) => ({
        recipient_type: "EMAIL",
        receiver: l.receiverEmail,
        amount: { value: toValue(l.amountCents), currency: l.currency },
        note: l.note.slice(0, 4000),
        sender_item_id: l.senderItemId,
      })),
    });
    return { batchId: res.batch_header.payout_batch_id, status: res.batch_header.batch_status };
  } catch (e) {
    // PayPal refuses a reused sender_batch_id, so a re-run can't pay twice.
    if (e instanceof PayPalError && /already exists/i.test(JSON.stringify(e.body))) {
      return { batchId: "", status: "DUPLICATE", duplicate: true };
    }
    throw e;
  }
}

export async function getBatch(pp: PayPalClient, batchId: string): Promise<BatchStatus> {
  const res = await pp.call("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}?page_size=1000`);
  return {
    batchId,
    status: res.batch_header.batch_status,
    items: (res.items ?? []).map((it: any) => ({
      itemId: it.payout_item_id,
      senderItemId: it.payout_item?.sender_item_id ?? "",
      receiver: it.payout_item?.receiver ?? "",
      amount: it.payout_item?.amount?.value ?? "",
      currency: it.payout_item?.amount?.currency ?? "",
      status: it.transaction_status ?? "UNKNOWN",
      transactionId: it.transaction_id,
      error: it.errors?.name,
    })),
  };
}

/** Cancel an UNCLAIMED item so the money returns now instead of after 30 days. */
export async function cancelItem(pp: PayPalClient, itemId: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  try {
    const res = await pp.call("POST", `/v1/payments/payouts-item/${encodeURIComponent(itemId)}/cancel`);
    return { ok: true, status: res.transaction_status };
  } catch (e) {
    if (e instanceof PayPalError) return { ok: false, error: e.issue ?? e.message };
    throw e;
  }
}
