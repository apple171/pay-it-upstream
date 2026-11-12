import type { Metadata } from "next";
import Link from "next/link";
import { readLedger } from "@/lib/store";
import { money, runSummaries, when } from "@/lib/views";
import { AutoRefresh } from "../components/auto-refresh";
import { EnvTag, FilterChips, PageHead, SplitBar } from "../components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Runs", description: "Every published funding run: who funded what, and why." };

type Params = { company?: string; env?: string; kind?: string };

export default async function RunsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const params = { company: p.company ?? "", env: p.env ?? "", kind: p.kind ?? "" };
  const all = runSummaries(await readLedger());
  const runs = all.filter(
    (r) => (!params.company || r.company === params.company) && (!params.env || r.env === params.env) && (!params.kind || r.kind === params.kind),
  );
  const companies = [...new Set(all.map((r) => r.company))].sort();
  const count = (f: (r: (typeof all)[number]) => boolean) => all.filter(f).length;

  return (
    <main className="page container">
      <AutoRefresh seconds={8} />
      <PageHead eyebrow="Runs" title="Every funding run">
        Each run is one company pointing the agent at its code with a budget. Open a run to see the agent&apos;s reasoning, what it
        skipped, and each payout&apos;s PayPal status.
      </PageHead>

      <div className="filters">
        {companies.length > 1 && (
          <FilterChips
            label="Company" param="company" base="/runs" params={params} current={params.company}
            options={[{ value: "", label: "All" }, ...companies.map((c) => ({ value: c, label: c, count: count((r) => r.company === c) }))]}
          />
        )}
        <FilterChips
          label="Type" param="kind" base="/runs" params={params} current={params.kind}
          options={[
            { value: "", label: "All", count: all.length },
            { value: "plan", label: "Funding runs", count: count((r) => r.kind === "plan") },
            { value: "resplit", label: "Re-splits", count: count((r) => r.kind === "resplit") },
          ]}
        />
        <FilterChips
          label="Money" param="env" base="/runs" params={params} current={params.env}
          options={[
            { value: "", label: "All" },
            { value: "sandbox", label: "Sandbox", count: count((r) => r.env === "sandbox") },
            { value: "live", label: "Live", count: count((r) => r.env === "live") },
          ]}
        />
      </div>

      <div className="list">
        <div className="list-head cols-run">
          <span>Run</span>
          <span>Sent</span>
          <span>Packages</span>
          <span>Agent&apos;s summary</span>
          <span>Paid / waiting</span>
        </div>
        {runs.map((r) => (
          <Link key={r.id} href={`/runs/${r.id}`} className="list-row cols-run">
            <span className="cell-stack">
              <span className="mono small" style={{ color: "var(--text)" }}>{r.id}</span>
              <span className="tiny faint" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {r.company} · {when(r.createdAt)}
                {r.kind === "resplit" && <span className="tag accent">re-split</span>}
                <EnvTag env={r.env} />
              </span>
            </span>
            <span className="num right">{money(r.sentCents, r.currency)}</span>
            <span className="small muted hide-sm">{r.payouts} packages</span>
            <span className="small muted wide" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {r.summary}
            </span>
            <span className="wide">
              <SplitBar paid={r.paidCents} waiting={r.waitingCents} other={r.otherCents} legend={false} />
              <span className="tiny faint" style={{ display: "block", marginTop: 6 }}>
                {r.paid} paid · {r.waiting} waiting
              </span>
            </span>
          </Link>
        ))}
        {!runs.length && <div className="empty">No runs match these filters.</div>}
      </div>
    </main>
  );
}
