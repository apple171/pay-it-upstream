import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readLedger } from "@/lib/store";
import { money, pkgHref, when } from "@/lib/views";
import { MAX_FAILED } from "@/lib/approvals";
import { AutoRefresh } from "../../components/auto-refresh";
import { EnvTag, Icon, Levels, PageHead } from "../../components/ui";
import { DecideForm } from "./decide-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Approve a plan", robots: { index: false } };

export default async function ApprovePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = await readLedger();
  const a = l.approvals[id];
  if (!a) notFound();
  const p = a.proposal;
  const total = p.items.reduce((s, i) => s + i.amountCents, 0);
  const picked = new Set(p.items.map((i) => i.package));
  const overlap = p.baseline.filter((b) => picked.has(b)).length;
  const paid = l.runs[id];

  return (
    <main className="page container">
      {a.state === "waiting" && <AutoRefresh seconds={10} />}
      <PageHead
        eyebrow="Approval"
        title={<>An agent proposes {money(total, p.currency)} to {p.items.length} packages</>}
      >
        {p.company} · proposed {when(p.createdAt)} · budget {money(p.budgetCents, p.currency)}
        {p.unspentCents > 0 ? ` · ${money(p.unspentCents, p.currency)} left unspent` : ""}
      </PageHead>
      <div className="chips" style={{ marginTop: -14, marginBottom: 24 }}>
        <EnvTag env={p.env} />
        {p.kind === "resplit" && <span className="tag accent">re-split of unclaimed money</span>}
        <span className="tag">model {p.model}</span>
        <span className="tag">{p.candidates} packages looked at · {p.lockfiles.join(", ")}</span>
      </div>

      {a.state === "waiting" ? (
        <section className="card pad" style={{ marginBottom: 28 }}>
          <div className="eyebrow">Your decision</div>
          <h3 style={{ fontSize: 18, margin: "6px 0 4px" }}>The agent did the research. You decide if the money moves.</h3>
          <p className="small muted" style={{ marginBottom: 16 }}>
            Nothing is paid until a person with the approver passphrase approves. The agent that proposed this can&apos;t approve it.
          </p>
          {a.failedAttempts >= MAX_FAILED ? (
            <div className="callout bad"><p>Locked after too many wrong passphrases. Propose the plan again from the CLI.</p></div>
          ) : (
            <DecideForm id={id} total={money(total, p.currency)} />
          )}
        </section>
      ) : (
        <div className={`callout ${a.state === "approved" ? "ok" : "bad"}`} style={{ marginBottom: 28 }}>
          <Icon name={a.state === "approved" ? "shield" : "close"} size={20} />
          <div style={{ flex: 1 }}>
            <h3>{a.state === "approved" ? "Approved" : "Rejected"} by {a.by} · {a.decidedAt ? when(a.decidedAt) : ""}</h3>
            <p>
              {a.note ? <>&ldquo;{a.note}&rdquo; </> : null}
              {a.state === "approved" ? (paid ? "PayPal has the batch." : "The payouts go out as soon as the CLI or agent picks this up.") : "Nothing was paid."}
            </p>
          </div>
          {paid && <Link className="btn small" href={`/runs/${id}`}>See the payouts</Link>}
        </div>
      )}

      <div className="ai-summary">
        <div className="who"><Icon name="spark" size={14} /> Why the agent proposes this</div>
        <p>{p.summary}</p>
      </div>

      <section className="block" style={{ marginTop: 28 }}>
        <div className="block-head">
          <div>
            <div className="eyebrow">The plan</div>
            <h2>Who gets paid, and why</h2>
            <p>R, F and U: how much the project relies on the package, how fragile it is, how underfunded it is. Amounts are already within the rules.</p>
          </div>
        </div>
        <div className="list">
          <div className="list-head cols-pick">
            <span>Package</span>
            <span>Amount</span>
            <span>Risk</span>
            <span>Reason and evidence</span>
            <span>Paid to</span>
          </div>
          {p.items.map((it) => (
            <div key={it.package} className="list-row cols-pick">
              <span className="cell-stack">
                <Link href={pkgHref(it.package)} className="pkg-name">{it.package}</Link>
                <span className="tiny faint">{it.ecosystem}</span>
              </span>
              <span className="num right">{money(it.amountCents, p.currency)}</span>
              <span className="hide-sm"><Levels levels={it.levels} /></span>
              <span className="wide">
                <span className="small">{it.reason}</span>
                {it.evidence?.length > 0 && (
                  <details className="evidence">
                    <summary>{it.evidence.length} facts behind this</summary>
                    <ul>{it.evidence.map((e, n) => <li key={n}>{e}</li>)}</ul>
                  </details>
                )}
              </span>
              <span className="mono tiny muted">{it.maintainerMasked}</span>
            </div>
          ))}
        </div>
      </section>

      {(p.skipped.length > 0 || p.rejected.length > 0) && (
        <section className="block">
          <div className="block-head"><div><div className="eyebrow">Not funded</div><h2>What the agent skipped, and what the rules blocked</h2></div></div>
          <div className="list">
            {p.skipped.map((k) => (
              <div key={`s-${k.package}`} className="list-row" style={{ gridTemplateColumns: "minmax(150px, 1fr) 110px minmax(0, 3fr)" }}>
                <span className="pkg-name">{k.package}</span>
                <span><span className={`tag${/gaming|inflated|spam|inject|slop|typo/i.test(k.why) ? " bad" : ""}`}>agent skipped</span></span>
                <span className="small muted wide">{k.why}</span>
              </div>
            ))}
            {p.rejected.map((k) => (
              <div key={`r-${k.package}`} className="list-row" style={{ gridTemplateColumns: "minmax(150px, 1fr) 110px minmax(0, 3fr)" }}>
                <span className="pkg-name">{k.package}</span>
                <span><span className="tag wait">rules blocked</span></span>
                <span className="small muted wide">{k.why}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="block grid-2">
        <div className="card pad">
          <div className="eyebrow">Your rules</div>
          {p.rules.trim() ? (
            <pre className="code" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{p.rules.trim()}</pre>
          ) : (
            <p style={{ marginTop: 10 }}>No company rules: only the built-in limits (budget, 30% per package, $5 minimum, published emails only).</p>
          )}
          <p className="tiny faint" style={{ marginTop: 10 }}>Rules fingerprint {p.rulesFingerprint} · method {p.methodologyFingerprint}</p>
        </div>
        <div className="card pad">
          <div className="eyebrow">Versus a download ranking</div>
          <h3 style={{ fontSize: 18, margin: "8px 0 6px" }}>{overlap}/{p.baseline.length} overlap</h3>
          <p>Funding the most-downloaded packages would pay these instead.</p>
          <div className="chips" style={{ marginTop: 14 }}>
            {p.baseline.map((b) => <span key={b} className={`tag${picked.has(b) ? " ok" : ""}`}>{picked.has(b) ? "✓ " : ""}{b}</span>)}
          </div>
        </div>
      </section>
    </main>
  );
}
