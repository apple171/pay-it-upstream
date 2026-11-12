// Human approval. The agent proposes a plan; a person approves it on the site with a passphrase.
// Only a salted PBKDF2 hash of the passphrase is stored or sent, so an agent that can read the
// settings or the run still can't approve. The site recomputes the hash from what the person types.
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { isCritical, ledgerFromEnv } from "./publish.js";
import { maskEmail } from "./payees.js";
// Cloudflare Workers caps PBKDF2 at 100k iterations; the site verifies with the same numbers.
export const APPROVER_KDF = { name: "PBKDF2-SHA256", iterations: 100_000, bytes: 32 };
export function approverHash(passphrase, salt = randomBytes(16).toString("hex")) {
    const hash = pbkdf2Sync(passphrase, salt, APPROVER_KDF.iterations, APPROVER_KDF.bytes, "sha256").toString("hex");
    return { salt, hash };
}
/** Set when a site approves plans (LEDGER_URL, LEDGER_PUBLISH_TOKEN and an approver passphrase). */
export function siteApprovalFromEnv(env = process.env) {
    const target = ledgerFromEnv(env);
    if (!target || !env.APPROVER_HASH || !env.APPROVER_SALT)
        return undefined;
    return { ...target, salt: env.APPROVER_SALT, hash: env.APPROVER_HASH };
}
/** What the approver sees: the whole plan, maintainers masked. */
export function proposalOf(run, company) {
    return {
        id: run.id,
        kind: run.kind ?? "plan",
        parent: run.parent,
        createdAt: run.createdAt,
        company,
        env: (process.env.PAYPAL_ENV ?? "sandbox").toLowerCase() === "live" ? "live" : "sandbox",
        budgetCents: run.budgetCents,
        currency: run.currency,
        unspentCents: run.unspentCents,
        rules: run.rules,
        rulesFingerprint: run.rulesFingerprint,
        methodologyFingerprint: run.methodologyFingerprint,
        model: run.plan.model,
        summary: run.plan.summary,
        lockfiles: run.lockfiles.map((f) => f.split(/[\\/]/).pop()),
        candidates: run.candidates,
        critical: (run.signals ?? []).filter(isCritical).map((s) => s.name),
        skipped: run.plan.skipped.map((s) => ({ package: s.package, why: s.why })),
        rejected: run.rejected,
        baseline: (run.baseline ?? []).slice(0, 10).map((b) => b.package),
        items: run.allocations.map((a) => ({
            package: a.package,
            ecosystem: a.ecosystem,
            amountCents: a.amountCents,
            maintainerMasked: maskEmail(a.payee.email),
            reason: a.pick.reason,
            evidence: a.pick.evidence ?? [],
            levels: { reliance: a.pick.reliance, fragility: a.pick.fragility, underfunded: a.pick.underfunded },
        })),
    };
}
async function call(site, method, p, body) {
    const res = await fetch(`${site.url}${p}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${site.token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok)
        throw new Error(`The site refused: ${res.status} ${json.error ?? ""}`.trim());
    return json;
}
/** Puts the plan on the site's approval page. Safe to repeat: a decided plan stays decided. */
export async function requestApproval(run, site) {
    const r = await call(site, "POST", "/api/approvals", { proposal: proposalOf(run, site.company), approver: { salt: site.salt, hash: site.hash } });
    return { ...r, url: `${site.url}${r.url}` };
}
export const approvalUrl = (run, site) => `${site.url}/approve/${run.id}`;
export async function approvalState(run, site) {
    return call(site, "GET", `/api/approvals/${encodeURIComponent(run.id)}`);
}
/** Polls until a person decides, or gives up after `minutes`. */
export async function waitForApproval(run, site, minutes = 30, onTick) {
    const until = Date.now() + minutes * 60_000;
    for (;;) {
        const s = await approvalState(run, site).catch(() => ({ state: "waiting" }));
        onTick?.(s);
        if (s.state !== "waiting" || Date.now() > until)
            return s;
        await new Promise((r) => setTimeout(r, 3000));
    }
}
