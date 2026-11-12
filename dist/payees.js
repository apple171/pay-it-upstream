// Who receives each payout. In sandbox, real maintainers are replaced by test accounts.
import { createHash } from "node:crypto";
export function maskEmail(email) {
    const [user, domain = ""] = email.split("@");
    // Keep only the first letters and the last label (".com"), so a personal domain isn't given away.
    const labels = domain.split(".");
    const tld = labels.length > 1 ? labels[labels.length - 1] : "";
    return `${user.slice(0, 1)}***@${domain.slice(0, 1)}***${tld ? "." + tld : ""}`;
}
/**
 * Sandbox only: maps each distinct real payee email to a stand-in test account
 * from SANDBOX_STAND_INS. The same maintainer keeps the same stand-in across runs
 * (pass the saved map). Payees beyond the list get an address no PayPal account
 * owns, so the payout shows up as "waiting to be claimed".
 */
export function sandboxStandIns(realEmails, standIns, saved = {}) {
    const map = new Map(Object.entries(saved));
    const used = new Set(map.values());
    for (const email of realEmails) {
        if (map.has(email))
            continue;
        const next = standIns.find((s) => !used.has(s));
        const unclaimed = `maintainer-${createHash("sha256").update(email).digest("hex").slice(0, 8)}@example.org`;
        map.set(email, next ?? unclaimed);
        if (next)
            used.add(next);
    }
    return map;
}
export function standInsFromEnv(env = process.env) {
    return (env.SANDBOX_STAND_INS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}
