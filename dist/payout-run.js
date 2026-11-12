// Paying a saved run and reading its status. Shared by the CLI and the MCP server; prints nothing.
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { maskEmail, sandboxStandIns, standInsFromEnv } from "./payees.js";
import { PayPalClient, paypalConfigFromEnv } from "./paypal/client.js";
import { sendBatch, getBatch } from "./paypal/payouts.js";
import { ledgerFromEnv, publishRun } from "./publish.js";
import { addEvent, saveRun } from "./runs.js";
export const STATUS_WORDS = {
    SUCCESS: "paid",
    UNCLAIMED: "waiting to claim",
    PENDING: "processing",
    ONHOLD: "processing",
    RETURNED: "returned to you",
    FAILED: "failed",
    BLOCKED: "blocked",
    REFUNDED: "refunded",
    REVERSED: "reversed",
};
export const runTotal = (run) => run.allocations.reduce((s, a) => s + a.amountCents, 0);
const exists = (p) => access(p).then(() => true, () => false);
/**
 * Who PayPal should pay for each maintainer email. In sandbox, real maintainers are replaced by
 * test accounts, kept stable per project in .pay-it-upstream/sandbox-stand-ins.json.
 */
export async function receiversFor(project, emails, sandbox) {
    if (!sandbox)
        return (e) => e;
    const file = path.join(project, ".pay-it-upstream", "sandbox-stand-ins.json");
    const saved = (await exists(file)) ? JSON.parse(await readFile(file, "utf8")) : {};
    const map = sandboxStandIns(emails, standInsFromEnv(), saved);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(Object.fromEntries(map), null, 2));
    return (e) => map.get(e);
}
/** Sends one PayPal Payouts batch for the run. A run is never paid twice. */
export async function sendRunPayouts(run) {
    const config = paypalConfigFromEnv();
    const sandbox = config.env === "sandbox";
    if (run.payout)
        return { outcome: "already-sent", batchId: run.payout.batchId, sandbox, lines: run.payout.lines };
    if (!run.allocations.length)
        throw new Error("This plan has nothing to pay.");
    // Last line of defence: nothing is paid without a person's approval on record.
    if (!run.approval)
        throw new Error("This plan hasn't been approved by a person yet.");
    const pp = new PayPalClient(config);
    const receiver = await receiversFor(run.project, run.allocations.map((a) => a.payee.email), sandbox);
    const lines = run.allocations.map((a, i) => ({
        senderItemId: `${run.id}-${i + 1}`,
        package: a.package,
        amountCents: a.amountCents,
        receiver: receiver(a.payee.email),
        maintainerMasked: maskEmail(a.payee.email),
    }));
    const senderBatchId = `piu-${run.id}`;
    const res = await sendBatch(pp, senderBatchId, lines.map((l) => ({
        senderItemId: l.senderItemId,
        receiverEmail: l.receiver,
        amountCents: l.amountCents,
        currency: run.currency,
        note: `Thank you for maintaining ${l.package}. Funded by a project that depends on it, via Pay It Upstream (run ${run.id}).`,
    })));
    if (res.duplicate) {
        addEvent(run, "Re-send refused by PayPal (duplicate batch id); nothing paid twice");
        await saveRun(run);
        return { outcome: "duplicate", sandbox, lines };
    }
    run.payout = { env: config.env, senderBatchId, batchId: res.batchId, sentAt: new Date().toISOString(), lines };
    addEvent(run, `Sent PayPal batch ${res.batchId} (${(runTotal(run) / 100).toFixed(2)} ${run.currency})`);
    await saveRun(run);
    return { outcome: "sent", batchId: res.batchId, batchStatus: res.status, sandbox, lines, ...(await publishIfConfigured(run)) };
}
/** Sends the masked run summary to the public ledger, if LEDGER_URL is set. */
export async function publishIfConfigured(run) {
    const target = ledgerFromEnv();
    if (!target)
        return {};
    try {
        const url = await publishRun(run, target);
        addEvent(run, `Published to the ledger: ${url}`);
        await saveRun(run);
        return { published: url };
    }
    catch (e) {
        return { publishError: e.message };
    }
}
/** Reads the batch from PayPal once, records new item statuses on the run, and saves it. */
export async function refreshStatus(run) {
    if (!run.payout)
        throw new Error("This run hasn't been paid yet.");
    const pp = new PayPalClient(paypalConfigFromEnv());
    const st = await getBatch(pp, run.payout.batchId);
    const counts = new Map();
    for (const it of st.items) {
        const w = STATUS_WORDS[it.status] ?? it.status.toLowerCase();
        counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    const prev = run.status;
    run.status = { ...st, checkedAt: new Date().toISOString() };
    for (const it of st.items) {
        const before = prev?.items.find((p) => p.itemId === it.itemId)?.status;
        if (before !== it.status && it.status !== "PENDING") {
            const l = run.payout.lines.find((x) => x.senderItemId === it.senderItemId);
            addEvent(run, `${l?.package ?? it.senderItemId}: ${STATUS_WORDS[it.status] ?? it.status} (${it.currency} ${it.amount})`);
        }
    }
    await saveRun(run);
    const settled = !["PENDING", "PROCESSING"].includes(st.status) && !st.items.some((i) => ["PENDING", "ONHOLD"].includes(i.status));
    return { status: st, counts: [...counts], settled };
}
