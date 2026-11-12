/** One maintainer, and other packages here (or across the ecosystem) lean on it. */
export function isCritical(s) {
    // Type-definition packages (@types/*) are published by a shared bot account, so skip them.
    return !s.planted && !s.name.startsWith("@types/") && s.maintainers.length === 1 && (s.direct || s.dependedOnBy >= 2 || (s.dependents ?? 0) >= 10_000);
}
export function publishedRun(run, company) {
    if (!run.payout)
        throw new Error("Only paid runs can be published.");
    const lineOf = (pkg) => run.payout.lines.find((l) => l.package === pkg);
    return {
        id: run.id,
        kind: run.kind ?? "plan",
        parent: run.parent,
        createdAt: run.createdAt,
        company,
        env: run.payout.env,
        budgetCents: run.budgetCents,
        currency: run.currency,
        rulesFingerprint: run.rulesFingerprint,
        methodologyFingerprint: run.methodologyFingerprint,
        model: run.plan.model,
        summary: run.plan.summary,
        batchId: run.payout.batchId,
        critical: (run.signals ?? []).filter(isCritical).map((s) => s.name),
        skipped: run.plan.skipped.map((s) => ({ package: s.package, why: s.why })),
        baseline: (run.baseline ?? []).slice(0, 10).map((b) => b.package),
        approval: run.approval,
        items: run.allocations.map((a) => ({
            senderItemId: lineOf(a.package).senderItemId,
            package: a.package,
            ecosystem: a.ecosystem,
            amountCents: a.amountCents,
            maintainerMasked: lineOf(a.package).maintainerMasked,
            reason: a.pick.reason,
            evidence: a.pick.evidence ?? [],
            levels: { reliance: a.pick.reliance, fragility: a.pick.fragility, underfunded: a.pick.underfunded },
        })),
    };
}
export function ledgerFromEnv(env = process.env) {
    if (!env.LEDGER_URL || !env.LEDGER_PUBLISH_TOKEN)
        return undefined;
    return { url: env.LEDGER_URL.replace(/\/$/, ""), token: env.LEDGER_PUBLISH_TOKEN, company: env.LEDGER_COMPANY ?? "A company" };
}
export async function publishRun(run, target) {
    const res = await fetch(`${target.url}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.token}` },
        body: JSON.stringify(publishedRun(run, target.company)),
        signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok)
        throw new Error(`Ledger refused the run: ${res.status} ${body.error ?? ""}`);
    return `${target.url}${body.url ?? ""}`;
}
