import type { Metadata } from "next";
import Link from "next/link";
import { readLedger } from "@/lib/store";
import { money, packageSummaries, pkgHref } from "@/lib/views";
import { FilterChips, Icon, Levels, PageHead } from "../components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Packages", description: "Every open-source package funded so far, with what was paid and what is waiting." };

type Params = { q?: string; status?: string; eco?: string; sort?: string };

export default async function PackagesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const params = { q: p.q ?? "", status: p.status ?? "", eco: p.eco ?? "", sort: p.sort ?? "" };
  const all = packageSummaries(await readLedger());
  const q = params.q.trim().toLowerCase();
  const byStatus = {
    paid: (x: (typeof all)[number]) => x.paidCents > 0,
    waiting: (x: (typeof all)[number]) => x.waitingCents > 0,
    pledged: (x: (typeof all)[number]) => x.pledges > 0,
    critical: (x: (typeof all)[number]) => x.critical,
  } as const;
  const list = all
    .filter((x) => !q || x.name.toLowerCase().includes(q))
    .filter((x) => !params.status || byStatus[params.status as keyof typeof byStatus]?.(x))
    .filter((x) => !params.eco || x.ecosystem === params.eco)
    .sort((a, b) =>
      params.sort === "name" ? a.name.localeCompare(b.name)
      : params.sort === "recent" ? b.lastAt.localeCompare(a.lastAt)
      : b.sentCents + b.pledgedCents - (a.sentCents + a.pledgedCents),
    );
  const count = (f: (x: (typeof all)[number]) => boolean) => all.filter(f).length;
  const ecos = [...new Set(all.map((x) => x.ecosystem))].sort();

  return (
    <main className="page container">
      <PageHead eyebrow="Packages" title="Every package funded so far">
        The open-source packages companies have paid, pledged to, or flagged as critical. Open one for its full history.
      </PageHead>

      <form action="/packages" className="search-box" style={{ marginBottom: 18 }}>
        <Icon name="search" size={17} />
        <input name="q" defaultValue={params.q} placeholder="Filter by package name…" aria-label="Filter by package name" />
        {Object.entries(params).filter(([k, v]) => k !== "q" && v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      </form>

      <div className="filters">
        <FilterChips
          label="Show" param="status" base="/packages" params={params} current={params.status}
          options={[
            { value: "", label: "All", count: all.length },
            { value: "paid", label: "Paid", count: count(byStatus.paid) },
            { value: "waiting", label: "Waiting", count: count(byStatus.waiting) },
            { value: "pledged", label: "Pledged", count: count(byStatus.pledged) },
            { value: "critical", label: "Critical", count: count(byStatus.critical) },
          ]}
        />
        {ecos.length > 1 && (
          <FilterChips
            label="Ecosystem" param="eco" base="/packages" params={params} current={params.eco}
            options={[{ value: "", label: "All" }, ...ecos.map((e) => ({ value: e, label: e, count: count((x) => x.ecosystem === e) }))]}
          />
        )}
        <FilterChips
          label="Sort" param="sort" base="/packages" params={params} current={params.sort}
          options={[{ value: "", label: "Most funded" }, { value: "recent", label: "Recent" }, { value: "name", label: "A–Z" }]}
        />
      </div>

      <div className="list">
        <div className="list-head cols-pkg">
          <span>Package</span>
          <span className="right">Paid</span>
          <span className="right">Waiting</span>
          <span className="right">Pledged</span>
          <span>Risk</span>
          <span>Maintainer</span>
        </div>
        {list.map((x) => (
          <Link key={x.name} href={pkgHref(x.name)} className="list-row cols-pkg">
            <span className="cell-stack">
              <span className="pkg-name">{x.name}</span>
              <span className="tiny faint" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {x.ecosystem} · {x.payouts} payout{x.payouts === 1 ? "" : "s"}
                {x.critical && <span className="tag accent">critical</span>}
              </span>
            </span>
            <span className={`num right${x.paidCents ? "" : " faint zero"}`} style={x.paidCents ? { color: "var(--ok)" } : undefined}>{money(x.paidCents)}</span>
            <span className={`num right${x.waitingCents ? "" : " faint zero"}`} style={x.waitingCents ? { color: "var(--wait)" } : undefined}>{money(x.waitingCents)}</span>
            <span className={`num right hide-sm${x.pledgedCents ? "" : " faint"}`}>{money(x.pledgedCents)}</span>
            <span className="hide-sm"><Levels levels={x.levels} /></span>
            <span className="mono tiny muted hide-sm">{x.maintainer}</span>
          </Link>
        ))}
        {!list.length && <div className="empty">No packages match{params.q ? ` "${params.q}"` : ""}.</div>}
      </div>
    </main>
  );
}
