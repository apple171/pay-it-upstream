"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DecideForm({ id, total }: { id: string; total: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "approve" | "reject">("");
  const [error, setError] = useState("");

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setError("");
    try {
      const res = await fetch(`/api/approvals/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, name, passphrase, note }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? `Something went wrong (${res.status}).`);
      else router.refresh();
    } finally {
      setBusy("");
    }
  }

  return (
    <form className="decide" onSubmit={(e) => { e.preventDefault(); decide("approve"); }}>
      <div className="row">
        <label className="field">Your name (shown in the audit trail)
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jason, Eng lead" maxLength={60} required autoComplete="name" />
        </label>
        <label className="field">Approver passphrase
          <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} required autoComplete="current-password" />
        </label>
      </div>
      <label className="field">Note (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why you approved or rejected it" />
      </label>
      {error && <div className="callout bad"><p style={{ color: "var(--bad)" }}>{error}</p></div>}
      <div className="actions">
        <button className="btn approve" type="submit" disabled={!!busy || !name || !passphrase}>{busy === "approve" ? "Approving…" : `Approve ${total}`}</button>
        <button className="btn reject" type="button" disabled={!!busy || !name || !passphrase} onClick={() => decide("reject")}>{busy === "reject" ? "Rejecting…" : "Reject"}</button>
        <span className="tiny faint">After you approve, PayPal sends the payouts within a minute.</span>
      </div>
    </form>
  );
}
