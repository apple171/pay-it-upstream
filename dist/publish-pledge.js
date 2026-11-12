// Sends a pledge's masked summary to the public ledger. The maintainer's real email never leaves this machine.
import { ledgerFromEnv } from "./publish.js";
export function publishedPledge(p, company) {
    return {
        id: p.id,
        kind: p.kind,
        company,
        env: p.env,
        package: p.package,
        ecosystem: p.ecosystem,
        what: p.what,
        amountCents: p.amountCents,
        currency: p.currency,
        createdAt: p.createdAt,
        maintainerMasked: p.maintainerMasked,
        state: p.state,
        heldUntil: p.heldUntil,
        authorizationId: p.authorizationId,
        captureId: p.capture?.id,
        payoutBatchId: p.payout?.batchId,
        payoutItemId: p.payout ? `${p.id}-1` : undefined,
        payoutStatus: p.payout?.status,
    };
}
export async function publishPledgeIfConfigured(p) {
    const target = ledgerFromEnv();
    if (!target || p.state === "awaiting-approval")
        return {};
    try {
        const res = await fetch(`${target.url}/api/pledges`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.token}` },
            body: JSON.stringify(publishedPledge(p, target.company)),
            signal: AbortSignal.timeout(15_000),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok)
            throw new Error(`${res.status} ${body.error ?? ""}`.trim());
        return { published: `${target.url}${body.url ?? ""}` };
    }
    catch (e) {
        return { publishError: e.message };
    }
}
