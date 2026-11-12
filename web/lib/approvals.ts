// Human approval of agent-proposed plans. The CLI or MCP server posts a proposal with a salted hash of
// the approver's passphrase; a person approves on /approve/<id> by typing the passphrase. The hash is
// recomputed here with the same PBKDF2 settings as the CLI (src/approval.ts) and never sent to browsers.
import type { Approval, Ledger, Proposal } from "./store";
import { EMAIL, MASKED } from "./ledger";

export const MAX_FAILED = 8;

export function checkProposal(p: Proposal, approver: { salt?: string; hash?: string }) {
  if (!p || typeof p.id !== "string" || !/^[\w-]{6,80}$/.test(p.id)) throw new Error("bad run id");
  if (!/^[0-9a-f]{32}$/.test(approver?.salt ?? "") || !/^[0-9a-f]{64}$/.test(approver?.hash ?? "")) throw new Error("bad approver hash");
  if (!Array.isArray(p.items) || !p.items.length || p.items.length > 100) throw new Error("bad items");
  for (const it of p.items) {
    if (!(Number.isInteger(it.amountCents) && it.amountCents > 0) || !it.package) throw new Error("bad item");
    if (!MASKED.test(it.maintainerMasked)) throw new Error("maintainer emails must be masked");
  }
  if (EMAIL.test(JSON.stringify({ ...p, items: p.items.map((i) => ({ ...i, maintainerMasked: "" })) }))) throw new Error("payload contains an email address");
}

/** Adds or refreshes a waiting proposal. A decided one stays as it was decided. */
export function applyProposal(l: Ledger, proposal: Proposal, approver: { salt: string; hash: string }): Approval {
  const prev = l.approvals[proposal.id];
  if (prev && prev.state !== "waiting") return prev;
  l.approvals[proposal.id] = { proposal, approver, state: "waiting", requestedAt: prev?.requestedAt ?? new Date().toISOString(), failedAttempts: prev?.failedAttempts ?? 0 };
  return l.approvals[proposal.id];
}

/** What anyone may see about the decision: no hash. */
export const publicState = (a: Approval) => ({ state: a.state, by: a.by, decidedAt: a.decidedAt, note: a.note, locked: a.failedAttempts >= MAX_FAILED });

export { passphraseMatches } from "./passphrase";
