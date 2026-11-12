// How the chat panel shows our explain_payout tool: a one-line label, and a payout card when expanded.
import type { AgAiToolDetailParams } from "ag-studio";
import type { AgAiToolDisplay } from "ag-studio-react";
import { EXPLAIN_TOOL, type ExplainData } from "./payout-agent";

function PayoutCard({ result }: AgAiToolDetailParams) {
  if (!result) return null;
  if (!result.success) return <div className="piu-card">{result.issues.map((i) => i.message).join(" ")}</div>;
  const data = result.data as ExplainData;
  return (
    <div className="piu-card">
      {data.payouts.map((p, i) => (
        <div key={i}>
          <div className="piu-card-head">
            <b>{data.package}</b>
            <span>
              {p.currency} {p.amount.toFixed(2)}
            </span>
            <span className={`piu-badge ${p.verified ? "ok" : ""}`}>{p.verified ? "✓ PayPal-signed" : "awaiting PayPal"}</span>
          </div>
          <div className="muted">
            {p.steps} · {p.company}
            {p.env === "sandbox" ? " · sandbox" : ""} · {p.maintainer}
          </div>
          <p>{p.reason}</p>
          {p.evidence && <div className="muted">{p.evidence}</div>}
        </div>
      ))}
    </div>
  );
}

export const aiToolDisplay: Record<string, AgAiToolDisplay> = {
  [EXPLAIN_TOOL]: {
    label: ({ args, result }) => {
      const pkg = typeof args.package === "string" ? args.package : "a payout";
      const first = result?.success ? (result.data as ExplainData).payouts[0] : undefined;
      return {
        text: result ? `Looked up the payout to ${pkg}` : `Looking up the payout to ${pkg}`,
        pill: first ? (first.verified ? `✓ ${first.status}` : first.status) : undefined,
      };
    },
    detail: PayoutCard,
  },
};
