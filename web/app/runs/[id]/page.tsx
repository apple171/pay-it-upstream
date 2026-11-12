import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readLedger } from "@/lib/store";
import { money, pkgHref, runDetail, when } from "@/lib/views";
import { AutoRefresh } from "../../components/auto-refresh";
import { EnvTag, Icon, Levels, PageHead, Signed, SplitBar, Status } from "../../components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `Run ${(await params).id}` };
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = runDetail(await readLedger(), id);
  if (!d) notFound();
  const { run, summary: s, picks, children } = d;
  const picked = new Set(picks.map((p) => p.package));
  const baseline = run.baseline ?? [];
  const overlap = baseline.filter((b) => picked.has(b)).length;

  return (
    <main className="page container">
      <AutoRefresh seconds={5} />
      <PageHead
        crumbs={<><Link href="/runs">Runs</Link><span>/</span><span className="mono">{run.id}</span></>}
        title={<>{money(s.sentCents, s.currency)} to {s.payouts} packages</>}
      >
        {run.company} · {when(run.createdAt)} · budget {money(run.budgetCents, run.currency)}
      </PageHead>
      <div className="chips" style={{ marginTop: -14, marginBottom: 28 }}>
        <EnvTag env={run.env} />
        {s.kind === "resplit" && <span className="tag accent">re-split of unclaimed money</span>}
        <span className="tag">model {run.model}</span>
        <span className="tag">PayPal batch {run.batchId}</span>
      </div>

      <div className="ai-summary">
        <div className="who"><Icon name="spark" size={14} /> The agent&apos;s summary</div>
        <p>{run.summary}</p>
      </div>

      <section className="block" style={{ marginTop: 28 }}>
        <div className="stats">
          <div className="stat">
            <div className="v">{money(s.sentCents, s.currency)}</div>
            <div className="l">sent of {money(run.budgetCents, run.currency)} budget</div>
          </div>
          <div className="stat">
            <div className="v ok">{money(s.paidCents, s.currency)}</div>
            <div className="l">{s.paid} paid</div>
          </div>
          <div className="stat">
            <div className="v wait">{money(s.waitingCents, s.currency)}</div>
            <div className="l">{s.waiting} waiting to claim</div>
          </div>
          <div className="stat">
            <div className="v">{run.skipped.length}</div>
            <div className="l">packages skipped, with reasons</div>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <SplitBar paid={s.paidCents} waiting={s.waitingCents} other={s.otherCents} currency={s.currency} />
        </div>
      </section>

      <section className="block">
        <div className="block-head">
          <div>
            <div className="eyebrow">Picks</div>
            <h2>Where the money went, and why</h2>
            <p>R, F and U are how much the project relies on the package, how fragile it is, and how underfunded it is.</p>
          </div>
        </div>
        <div className="list">
          <div className="list-head cols-pick">
            <span>Package</span>
            <span>Amount</span>
            <span>Risk</span>
            <span>Reason and evidence</span>
            <span>PayPal status</span>
          </div>
          {picks.map((p) => (
            <div key={p.senderItemId} className="list-row cols-pick">
              <span className="cell-stack">
                <Link href={pkgHref(p.package)} className="pkg-name">{p.package}</Link>
                <span className="tiny faint">{p.ecosystem} · {p.maintainerMasked}</span>
              </span>
              <span className="num right">{money(p.amountCents, p.currency)}</span>
              <span className="hide-sm"><Levels levels={p.levels} /></span>
              <span className="wide">
                <span className="small">{p.reason}</span>
                {p.evidence?.length > 0 && (
                  <details className="evidence">
                    <summary>{p.evidence.length} facts behind this</summary>
                    <ul>{p.evidence.map((e, n) => <li key={n}>{e}</li>)}</ul>
                  </details>
                )}
              </span>
              <span className="cell-stack">
                <Status status={p.status} />
                <Signed yes={p.verified} />
              </span>
            </div>
          ))}
        </div>
      </section>

      {run.skipped.length > 0 && (
        <section className="block">
          <div className="block-head">
            <div>
              <div className="eyebrow">Skipped</div>
              <h2>What the agent chose not to fund</h2>
              <p>Popular isn&apos;t the same as at risk. These were looked at and passed over.</p>
            </div>
          </div>
          <div className="list">
            {run.skipped.map((k) => {
              const gaming = /gaming|inflated|spam|slopsquat|injection/i.test(k.why);
              return (
                <div key={k.package} className="list-row" style={{ gridTemplateColumns: "minmax(150px, 1fr) minmax(0, 3fr)" }}>
                  <span className="cell-stack">
                    <span className="pkg-name">{k.package}</span>
                    {gaming && <span><span className="tag bad">likely gaming</span></span>}
                  </span>
                  <span className="small muted wide">{k.why}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="block grid-2">
        {baseline.length > 0 ? (
          <div className="card pad">
            <div className="eyebrow">Versus a download ranking</div>
            <h3 style={{ fontSize: 18, margin: "8px 0 6px" }}>
              {overlap}/{baseline.length} overlap
            </h3>
            <p>Funding the most-downloaded packages would have paid these. Most are already well supported.</p>
            <div className="chips" style={{ marginTop: 14 }}>
              {baseline.map((b) => (
                <span key={b} className={`tag${picked.has(b) ? " ok" : ""}`}>{picked.has(b) ? "✓ " : ""}{b}</span>
              ))}
            </div>
          </div>
        ) : (
          <div className="card pad">
            <div className="eyebrow">Critical packages</div>
            <h3 style={{ fontSize: 18, margin: "8px 0 6px" }}>{run.critical.length} one-maintainer packages others rely on</h3>
            <div className="chips" style={{ marginTop: 14 }}>
              {run.critical.map((c) => <span key={c} className={`tag${picked.has(c) ? " ok" : ""}`}>{picked.has(c) ? "✓ " : ""}{c}</span>)}
            </div>
          </div>
        )}
        <div className="card pad">
          <div className="eyebrow">Audit trail</div>
          <dl className="facts" style={{ marginTop: 14 }}>
            <dt>Run</dt><dd className="mono small">{run.id}</dd>
            {run.approval && (<><dt>Approved by</dt><dd className="small">{run.approval.by} · {run.approval.via === "site" ? <Link href={`/approve/${run.id}`}>on the site</Link> : "in the terminal"} · {when(run.approval.at)}</dd></>)}
            {run.parent && (<><dt>Re-split of</dt><dd><Link href={`/runs/${run.parent}`} className="mono small">{run.parent}</Link></dd></>)}
            {children.map((c) => (<Fragment key={c.id}><dt>Re-split into</dt><dd><Link href={`/runs/${c.id}`} className="mono small">{c.id}</Link></dd></Fragment>))}
            <dt>Company rules</dt><dd className="mono small">{run.rulesFingerprint}</dd>
            <dt>Method version</dt><dd className="mono small">{run.methodologyFingerprint}</dd>
            <dt>Model</dt><dd className="mono small">{run.model}</dd>
            <dt>PayPal batch</dt><dd className="mono small">{run.batchId}</dd>
          </dl>
        </div>
      </section>
    </main>
  );
}
