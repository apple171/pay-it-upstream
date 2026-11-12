import { isPayable } from "./agent/agent.js";
export const DEFAULT_LIMITS = { maxShare: 0.3, minPayoutCents: 500, maxPackages: 10 };
/** Agent limits can only tighten the hard limits, never loosen them. */
export function effectiveLimits(plan, budgetCents, hard) {
    const l = plan.limits ?? {};
    const pos = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : Infinity);
    return {
        maxPerPackageCents: Math.floor(Math.min(budgetCents * hard.maxShare, pos(l.maxPerPackageCents))),
        minPayoutCents: Math.max(hard.minPayoutCents, typeof l.minPayoutCents === "number" ? l.minPayoutCents : 0),
        maxPackages: Math.min(hard.maxPackages, pos(l.maxPackages)),
        exclude: Array.isArray(l.exclude) ? l.exclude.map(String) : [],
        onlyDirect: l.onlyDirect === true,
    };
}
/**
 * Splits `budget` by weight, in whole cents. A share above the cap is clipped and
 * the extra stays unspent (it is not pushed onto smaller picks).
 */
export function splitBudget(weights, budget, cap) {
    const sumW = weights.reduce((s, w) => s + w, 0);
    if (sumW <= 0)
        return weights.map(() => 0);
    const out = weights.map((w) => Math.min(cap, Math.floor((budget * w) / sumW)));
    // Hand out rounding cents (fewer than one per pick) to the largest weights under the cap.
    const unclipped = weights.map((w) => (budget * w) / sumW <= cap);
    let left = Math.min(budget - out.reduce((a, b) => a + b, 0), weights.reduce((s, w, i) => s + (unclipped[i] ? (budget * w) / sumW - out[i] : 0), 0));
    left = Math.round(left);
    const order = weights.map((_, i) => i).filter((i) => unclipped[i]).sort((a, b) => weights[b] - weights[a]);
    for (const i of order) {
        if (left <= 0)
            break;
        if (out[i] < cap) {
            out[i]++;
            left--;
        }
    }
    return out;
}
export function enforcePlan(plan, candidates, budgetCents, hard = DEFAULT_LIMITS) {
    const limits = effectiveLimits(plan, budgetCents, hard);
    const byName = new Map(candidates.map((c) => [c.name, c]));
    const rejected = [];
    const seen = new Set();
    let picks = [];
    for (const pick of plan.picks) {
        const sig = byName.get(pick.package);
        const w = Number(pick.weight);
        const why = !sig
            ? "not in this project's candidates"
            : seen.has(pick.package)
                ? "listed twice"
                : !isPayable(sig)
                    ? "no public contact email in registry metadata"
                    : limits.exclude.includes(pick.package)
                        ? "excluded by company rules"
                        : limits.onlyDirect && !sig.direct
                            ? "rules allow direct dependencies only"
                            : !(w > 0 && Number.isFinite(w))
                                ? "weight must be a positive number"
                                : "";
        if (why) {
            rejected.push({ package: pick.package, why });
            continue;
        }
        seen.add(pick.package);
        picks.push({ pick: { ...pick, weight: w }, sig: sig });
    }
    picks.sort((a, b) => b.pick.weight - a.pick.weight);
    for (const p of picks.slice(limits.maxPackages))
        rejected.push({ package: p.pick.package, why: `over the ${limits.maxPackages}-package limit` });
    picks = picks.slice(0, limits.maxPackages);
    // Drop the smallest pick until every payout clears the minimum.
    let amounts = [];
    for (;;) {
        // Split in whole dollars so payouts read cleanly; leftover cents stay unspent.
        amounts = splitBudget(picks.map((p) => p.pick.weight), Math.floor(budgetCents / 100), Math.floor(limits.maxPerPackageCents / 100)).map((d) => d * 100);
        const tooSmall = amounts.findIndex((a) => a < limits.minPayoutCents);
        if (tooSmall < 0 || !picks.length)
            break;
        const smallest = amounts.indexOf(Math.min(...amounts));
        rejected.push({ package: picks[smallest].pick.package, why: `share below the ${(limits.minPayoutCents / 100).toFixed(2)} minimum payout` });
        picks.splice(smallest, 1);
    }
    const allocations = picks.map((p, i) => ({
        package: p.sig.name,
        ecosystem: p.sig.ecosystem,
        version: p.sig.version,
        amountCents: amounts[i],
        payee: p.sig.maintainers.find((m) => m.email),
        pick: p.pick,
    }));
    const spent = allocations.reduce((s, a) => s + a.amountCents, 0);
    return { allocations, rejected, limits, unspentCents: budgetCents - spent };
}
