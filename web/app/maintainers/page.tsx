import type { Metadata } from "next";
import Link from "next/link";
import { pledgeRows } from "@/lib/ledger";
import { readLedger } from "@/lib/store";
import { day, money, packageSummaries, pkgHref } from "@/lib/views";
import { Icon, PageHead } from "../components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "For maintainers",
  description: "See what companies have paid for your open-source package, and claim money waiting for you.",
};

export default async function MaintainersPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const raw = (await searchParams).q;
  const q = ((Array.isArray(raw) ? raw[0] : raw) ?? "").trim();
  const l = await readLedger();
  const all = packageSummaries(l);
  const waiting = all.filter((p) => p.waitingCents > 0);
  const waitingCents = waiting.reduce((s, p) => s + p.waitingCents, 0);
  const results = q
    ? all.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
    : [...waiting].sort((a, b) => b.waitingCents - a.waitingCents);
  const openPledges = pledgeRows(l).filter((p) => p.state === "held" && (!q || p.package.toLowerCase().includes(q.toLowerCase())));

  return (
    <main className="page container">
      <PageHead eyebrow="For maintainers" title="Companies that depend on your code can now pay you for it">
        Find your package to see what has been paid, what is waiting for you, and any money held toward a fix or feature.
      </PageHead>

      <form action="/maintainers" className="search-box" style={{ maxWidth: 620 }}>
        <Icon name="search" size={18} />
        <input name="q" defaultValue={q} placeholder="Your package name, e.g. depd" aria-label="Package name" autoComplete="off" />
        <button className="btn small primary" type="submit">Find</button>
      </form>

      {waitingCents > 0 && !q && (
        <div className="callout wait" style={{ marginTop: 20 }}>
          <Icon name="hand" size={20} />
          <div>
            <h3>{money(waitingCents)} is waiting to be claimed across {waiting.length} package{waiting.length === 1 ? "" : "s"}</h3>
            <p>PayPal emailed each maintainer at the address their package publishes. Unclaimed money returns to the company after 30 days.</p>
          </div>
        </div>
      )}

      <section className="block" style={{ marginTop: 36 }}>
        <div className="block-head">
          <div>
            <h2>{q ? `Results for “${q}”` : "Packages with money waiting"}</h2>
          </div>
          <Link className="more" href="/packages">All packages →</Link>
        </div>
        <div className="list">
          {results.map((p) => (
            <Link key={p.name} href={pkgHref(p.name)} className="list-row" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) auto" }}>
              <span className="cell-stack">
                <span className="pkg-name">{p.name}</span>
                <span className="tiny faint">{p.ecosystem} · sent to {p.maintainer}</span>
              </span>
              <span className="chips hide-sm">
                {p.waitingCents > 0 && <span className="tag wait">{money(p.waitingCents)} waiting</span>}
                {p.paidCents > 0 && <span className="tag ok">{money(p.paidCents)} paid</span>}
                {p.pledges > 0 && <span className="tag accent">{p.pledges} pledge{p.pledges > 1 ? "s" : ""}</span>}
              </span>
              <span className="muted"><Icon name="arrow" size={15} /></span>
            </Link>
          ))}
          {!results.length && (
            <div className="empty">{q ? `Nothing for “${q}” yet. Companies fund packages they depend on; check back after their next run.` : "Nothing is waiting right now."}</div>
          )}
        </div>
      </section>

      {openPledges.length > 0 && (
        <section className="block">
          <div className="block-head">
            <div>
              <div className="eyebrow">Open pledges</div>
              <h2>Money held for work you could ship</h2>
            </div>
            <Link className="more" href="/pledges">All pledges →</Link>
          </div>
          <div className="grid-3">
            {openPledges.map((p) => (
              <Link key={p.id} href={`/pledges?focus=${p.id}`} className="card run-card">
                <div className="top">
                  <span className="pkg-name">{p.package}</span>
                  <span className={`tag ${p.kind === "security-fix" ? "bad" : "accent"}`}>{p.kind === "security-fix" ? "security fix" : "feature"}</span>
                </div>
                <div className="amount">{money(p.amountCents, p.currency)}</div>
                <p className="summary">{p.what}</p>
                <div className="tiny faint">{p.company}{p.heldUntil ? ` · held until ${day(p.heldUntil)}` : ""}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="block" id="claim">
        <div className="block-head">
          <div>
            <div className="eyebrow">Claiming</div>
            <h2>How the money reaches you</h2>
          </div>
        </div>
        <div className="steps-row">
          <div className="card step">
            <div className="n">01</div>
            <h3>It goes to your registry email</h3>
            <p>Payments go to the contact email your package publishes on npm or PyPI. PayPal emails that address when money arrives.</p>
          </div>
          <div className="card step">
            <div className="n">02</div>
            <h3>Claim it with PayPal</h3>
            <p>If that email already has a PayPal account, the money is there. If not, sign up with that email, or add it to your account.</p>
          </div>
          <div className="card step">
            <div className="n">03</div>
            <h3>Unclaimed money isn&apos;t lost</h3>
            <p>After 30 days it returns to the company, which re-splits it to other packages. Keep your registry email current.</p>
          </div>
        </div>
        <p className="small faint" style={{ marginTop: 18 }}>
          Contact addresses are masked here. Pay It Upstream never holds money: companies pay from their own PayPal accounts.
        </p>
      </section>
    </main>
  );
}
