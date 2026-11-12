import type { Metadata } from "next";
import Link from "next/link";
import { pledgeRows } from "@/lib/ledger";
import { readLedger } from "@/lib/store";
import { day, money, pkgHref } from "@/lib/views";
import { AutoRefresh } from "../components/auto-refresh";
import { ScrollTo } from "../components/scroll-to";
import { EnvTag, FilterChips, Icon, PageHead, Signed, Status } from "../components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pledges", description: "Money held with PayPal toward a security fix or a feature, paid when the work ships." };

type Params = { state?: string; kind?: string; focus?: string; pledge?: string };

const STATE: Record<string, [string, string]> = {
  held: ["held", "UNCLAIMED"],
  shipped: ["shipped, collected", "SUCCESS"],
  withdrawn: ["withdrawn, released", "RELEASED"],
  expired: ["expired", "RELEASED"],
};
const SIGNED: Record<string, string> = { held: "hold PayPal-signed", shipped: "capture PayPal-signed", withdrawn: "release PayPal-signed" };
const PAYOUT: Record<string, string> = { SUCCESS: "maintainer paid", UNCLAIMED: "maintainer payout waiting to claim", PENDING: "maintainer payout processing" };

export default async function PledgesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const params = { state: p.state ?? "", kind: p.kind ?? "" };
  const focus = p.focus ?? p.pledge ?? "";
  const all = pledgeRows(await readLedger());
  const list = all.filter((x) => (!params.state || x.state === params.state) && (!params.kind || x.kind === params.kind));
  const count = (f: (x: (typeof all)[number]) => boolean) => all.filter(f).length;
  const sum = (f: (x: (typeof all)[number]) => boolean) => all.filter(f).reduce((s, x) => s + x.amountCents, 0);

  return (
    <main className="page container">
      <AutoRefresh seconds={5} />
      {focus && <ScrollTo id={`pledge-${focus}`} />}
      <PageHead eyebrow="Pledges" title="Pay for the fix, not just the thanks">
        A company holds money with PayPal toward a specific security fix or feature in a package it depends on. When the work
        ships, the hold is collected and paid to the maintainer. If it doesn&apos;t, the hold is released and nothing is charged.
      </PageHead>

      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="v">{money(sum((x) => x.state === "held"))}</div><div className="l">held right now</div></div>
        <div className="stat"><div className="v ok">{money(sum((x) => x.state === "shipped"))}</div><div className="l">collected for shipped work</div></div>
        <div className="stat"><div className="v">{count((x) => x.state === "withdrawn" || x.state === "expired")}</div><div className="l">released, nothing charged</div></div>
        <div className="stat"><div className="v">29 <small>days</small></div><div className="l">longest PayPal holds money</div></div>
      </div>

      <div className="grid-3" style={{ marginBottom: 36 }}>
        <div className="card step"><div className="icon"><Icon name="lock" size={17} /></div><div className="n">01 · hold</div><h3>Approve once in PayPal</h3><p>The funder approves a PayPal hold. Nothing is charged yet.</p></div>
        <div className="card step"><div className="icon"><Icon name="send" size={17} /></div><div className="n">02 · shipped</div><h3>Collect and pay</h3><p>The hold is captured and the same amount goes to the maintainer with PayPal Payouts.</p></div>
        <div className="card step"><div className="icon"><Icon name="repeat" size={17} /></div><div className="n">02 · or not</div><h3>Release</h3><p>The hold is voided. The money never left the funder&apos;s account.</p></div>
      </div>

      <div className="filters">
        <FilterChips
          label="State" param="state" base="/pledges" params={params} current={params.state}
          options={[
            { value: "", label: "All", count: all.length },
            { value: "held", label: "Held", count: count((x) => x.state === "held") },
            { value: "shipped", label: "Shipped", count: count((x) => x.state === "shipped") },
            { value: "withdrawn", label: "Withdrawn", count: count((x) => x.state === "withdrawn") },
          ]}
        />
        <FilterChips
          label="Type" param="kind" base="/pledges" params={params} current={params.kind}
          options={[
            { value: "", label: "All" },
            { value: "security-fix", label: "Security fix", count: count((x) => x.kind === "security-fix") },
            { value: "feature", label: "Feature", count: count((x) => x.kind === "feature") },
          ]}
        />
      </div>

      <div className="list">
        <div className="list-head cols-pledge">
          <span>Package</span>
          <span>Pledged toward</span>
          <span>Amount</span>
          <span>State</span>
        </div>
        {list.map((x) => (
          <div key={x.id} id={`pledge-${x.id}`} className={`list-row cols-pledge${focus === x.id ? " focus" : ""}`}>
            <span className="cell-stack">
              <Link href={pkgHref(x.package)} className="pkg-name">{x.package}</Link>
              <span className="tiny faint" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {x.company} · {day(x.at)} <EnvTag env={x.env} />
              </span>
            </span>
            <span className="wide">
              <span className={`tag ${x.kind === "security-fix" ? "bad" : "accent"}`}>{x.kind === "security-fix" ? "security fix" : "feature"}</span>{" "}
              <span className="small">{x.what}</span>
              <span className="tiny faint" style={{ display: "block", marginTop: 4 }}>
                maintainer {x.maintainer}
                {x.state === "held" && x.heldUntil && <> · held until {day(x.heldUntil)}</>}
                {x.payout && <> · {PAYOUT[x.payout] ?? x.payout.toLowerCase()}</>}
              </span>
            </span>
            <span className="num right">{money(x.amountCents, x.currency)}</span>
            <span className="cell-stack">
              <Status status={STATE[x.state]?.[1] ?? "SENT"} label={STATE[x.state]?.[0] ?? x.state} />
              <Signed yes={x.verified} label={SIGNED[x.state]} />
            </span>
          </div>
        ))}
        {!list.length && <div className="empty">No pledges match these filters.</div>}
      </div>

      <p className="small muted" style={{ marginTop: 20 }}>
        Make one from the command line: <code>pay-it-upstream --security-fix &lt;package&gt; --amount 100 --note &quot;…&quot;</code>
      </p>
    </main>
  );
}
