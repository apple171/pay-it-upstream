// PayPal Payouts: send a batch, read statuses, cancel unclaimed items.
import { PayPalError } from "./client.js";
const toValue = (cents) => (cents / 100).toFixed(2);
export async function sendBatch(pp, senderBatchId, lines, emailSubject = "You've received a payment for your open-source work", emailMessage = "A company that depends on your package is saying thanks.") {
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
    }
    catch (e) {
        // PayPal refuses a reused sender_batch_id, so a re-run can't pay twice.
        if (e instanceof PayPalError && /already exists/i.test(JSON.stringify(e.body))) {
            return { batchId: "", status: "DUPLICATE", duplicate: true };
        }
        throw e;
    }
}
export async function getBatch(pp, batchId) {
    const res = await pp.call("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}?page_size=1000`);
    return {
        batchId,
        status: res.batch_header.batch_status,
        items: (res.items ?? []).map((it) => ({
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
export async function cancelItem(pp, itemId) {
    try {
        const res = await pp.call("POST", `/v1/payments/payouts-item/${encodeURIComponent(itemId)}/cancel`);
        return { ok: true, status: res.transaction_status };
    }
    catch (e) {
        if (e instanceof PayPalError)
            return { ok: false, error: e.issue ?? e.message };
        throw e;
    }
}
