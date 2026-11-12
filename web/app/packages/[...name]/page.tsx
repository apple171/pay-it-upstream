import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readLedger } from "@/lib/store";
import { day, money, packageDetail } from "@/lib/views";
import { AutoRefresh } from "../../components/auto-refresh";
import { EnvTag, Icon, Levels, PageHead, Signed, Status } from "../../components/ui";

export const dynamic = "force-dynamic";

const nameOf = async (params: Promise<{ name: string[] }>) => (await params).name.map(decodeURIComponent).join("/");

export async function generateMetadata({ params }: { params: Promise<{ name: string[] }> }): Promise<Metadata> {
  return { title: await nameOf(params) };
}

const PLEDGE_STATE: Record<string, [string, string]> = {
  held: ["held for the maintainer", "UNCLAIMED"],
  shipped: ["shipped, collected", "SUCCESS"],
  withdrawn: ["withdrawn", "RELEASED"],
  expired: ["expired", "RELEASED"],
};

export default async function PackagePage({ params }: { params: Promise<{ name: string[] }> }) {
  const name = await nameOf(params);
  const d = packageDetail(await readLedger(), name);
  if (!d) notFound();
  const { summary: s, payments, pledges } = d;

  return (
    <main className="page container">
      <AutoRefresh seconds={8} />
      <PageHead crumbs={<><Link href="/packages">Packages</Link><span>/</span><span className="mono">{s.name}</span></>} title={<span className="mono">{s.name}</span>}>
        {s.ecosystem} package · maintainer {s.maintainer} · {s.runs} run{s.runs === 1 ? "" : "s"} funded it
      </PageHead>
      <div className="chips" style={{ marginTop: -14, marginBottom: 28 }}>
        {s.critical && <span className="tag accent">critical: one maintainer, others rely on it</span>}
        <Levels levels={s.levels} />
      </div>

      <div className="stats">
        <div className="stat">
          <div className="v ok">{money(s.paidCents)}</div>
          <div className="l">paid (PayPal-verified)</div>
        </div>
        <div className="stat">
          <div className="v wait">{money(s.waitingCents)}</div>
          <div className="l">waiting to be claimed</div>
        </div>
        <div className="stat">
          <div className="v">{money(s.pledgedCents)}</div>
          <div className="l">{s.pledges} pledge{s.pledges === 1 ? "" : "s"}</div>
        </div>
        <div className="stat">
          <div className="v">{money(s.sentCents)}</div>
          <div className="l">sent in total</div>
        </div>
      </div>

      {s.waitingCents > 0 && (
        <div className="callout wait" style={{ marginTop: 16 }}>
          <Icon name="hand" size={20} />
          <div style={{ flex: 1 }}>
            <h3>{money(s.waitingCents)} is waiting for the maintainer</h3>
            <p>PayPal emailed the address published for this package. Signing up for PayPal with that email claims it.</p>
          </div>
          <Link className="btn small" href="/maintainers#claim">How to claim</Link>
        </div>
      )}

      {s.reason && (
        <section className="block" style={{ marginTop: 32 }}>
          <div className="ai-summary">
            <div className="who"><Icon name="spark" size={14} /> Why the agent funded it, most recently</div>
            <p>{s.reason}</p>
          </div>
        </section>
      )}

      {pledges.length > 0 && (
        <section className="block">
          <div className="block-head"><div><div className="eyebrow">Pledges</div><h2>Money promised for specific work</h2></div></div>
          <div className="list">
            {pledges.map((p) => (
              <div key={p.id} className="list-row cols-pledge">
                <span className="cell-stack">
                  <span><span className={`tag ${p.kind === "security-fix" ? "bad" : "accent"}`}>{p.kind === "security-fix" ? "security fix" : "feature"}</span></span>
                  <span className="tiny faint">{p.company} · {day(p.at)}</span>
                </span>
                <span className="small wide">{p.what}</span>
                <span className="num right">{money(p.amountCents, p.currency)}</span>
                <span className="cell-stack">
                  <Status status={PLEDGE_STATE[p.state]?.[1] ?? "SENT"} label={PLEDGE_STATE[p.state]?.[0] ?? p.state} />
                  <Signed yes={p.verified} />
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="block">
        <div className="block-head"><div><div className="eyebrow">Payouts</div><h2>Every payment to this package</h2></div></div>
        <div className="list">
          <div className="list-head cols-pay">
            <span>Run</span>
            <span>Amount</span>
            <span>Reason</span>
            <span>Status</span>
          </div>
          {payments.map((p) => (
            <Link key={p.senderItemId} href={`/runs/${p.runId}`} className="list-row cols-pay">
              <span className="cell-stack">
                <span className="small" style={{ color: "var(--text)" }}>{p.company}</span>
                <span className="tiny faint" style={{ display: "flex", gap: 6, alignItems: "center" }}>{day(p.sentAt)} <EnvTag env={p.env} /></span>
              </span>
              <span className="num right">{money(p.amountCents, p.currency)}</span>
              <span className="small muted wide">{p.reason}</span>
              <span className="cell-stack hide-sm">
                <Status status={p.status} />
                <Signed yes={p.verified} />
              </span>
            </Link>
          ))}
          {!payments.length && <div className="empty">No payouts yet, only pledges.</div>}
        </div>
      </section>
    </main>
  );
}
