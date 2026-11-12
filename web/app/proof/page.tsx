import type { Metadata } from "next";
import Link from "next/link";
import { readLedger } from "@/lib/store";
import { eventRows, stats, when } from "@/lib/views";
import { AutoRefresh } from "../components/auto-refresh";
import { FilterChips, Icon, PageHead, Status } from "../components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Proof", description: "The PayPal-signed event log behind every status on this site." };

type Params = { type?: string };

const short = (t: string) => t.replace(/^PAYMENT\./, "").replace("PAYOUTS-ITEM", "PAYOUT ITEM").replace("PAYOUTSBATCH", "BATCH").replace(/[._]/g, " ").toLowerCase();

export default async function ProofPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const params = { type: p.type ?? "" };
  const l = await readLedger();
  const s = stats(l);
  const all = eventRows(l);
  const list = all.filter((e) => !params.type || e.group === params.type).slice(0, 200);
  const count = (g: string) => all.filter((e) => e.group === g).length;

  return (
    <main className="page container">
      <AutoRefresh seconds={5} />
      <PageHead eyebrow="Proof" title="Don't trust the site. Check PayPal's signature.">
        A company can&apos;t mark its own payout as paid. Every status on this site changes only when PayPal sends a webhook and its
        signature checks out against PayPal&apos;s public certificate. Forged or tampered messages are refused and counted.
      </PageHead>

      <div className="stats">
        <div className="stat"><div className="v ok">{s.signedEvents}</div><div className="l">PayPal-signed webhooks accepted</div></div>
        <div className="stat"><div className="v" style={{ color: s.refused ? "var(--bad)" : undefined }}>{s.refused}</div><div className="l">refused: signature didn&apos;t check out</div></div>
        <div className="stat"><div className="v">{s.payouts}</div><div className="l">payouts tracked</div></div>
        <div className="stat"><div className="v">{s.runs}</div><div className="l">runs published</div></div>
      </div>

      <section className="block grid-3">
        <div className="card step">
          <div className="icon"><Icon name="shield" size={17} /></div>
          <div className="n">signature</div>
          <h3>Checked offline, against PayPal</h3>
          <p>SHA256withRSA over the transmission id, time, webhook id and a CRC32 of the body. The certificate is fetched only from paypal.com.</p>
        </div>
        <div className="card step">
          <div className="icon"><Icon name="repeat" size={17} /></div>
          <div className="n">idempotent</div>
          <h3>A re-run can&apos;t pay twice</h3>
          <p>Each batch uses an id derived from the run. PayPal refuses a repeated id, so a retried or replayed run pays nothing more.</p>
        </div>
        <div className="card step">
          <div className="icon"><Icon name="lock" size={17} /></div>
          <div className="n">privacy</div>
          <h3>No emails leave the company</h3>
          <p>Runs reach this site with maintainer contacts already masked. Anything carrying a full email address is rejected.</p>
        </div>
      </section>

      <section className="block">
        <div className="block-head">
          <div>
            <div className="eyebrow"><span className="live">live</span></div>
            <h2>PayPal event log</h2>
          </div>
        </div>
        <div className="filters">
          <FilterChips
            label="Type" param="type" base="/proof" params={params} current={params.type}
            options={[
              { value: "", label: "All", count: all.length },
              { value: "payouts", label: "Payouts", count: count("payouts") },
              { value: "pledges", label: "Pledges", count: count("pledges") },
            ]}
          />
        </div>
        <div className="list">
          <div className="list-head cols-event">
            <span>Received</span>
            <span>PayPal event</span>
            <span>For</span>
            <span className="right">Amount</span>
          </div>
          {list.map((e) => (
            <div key={e.id} className="list-row cols-event">
              <span className="mono tiny muted">{when(e.receivedAt)}</span>
              <span className="cell-stack wide">
                <span className="mono small" style={{ color: "var(--text)" }}>{short(e.type)}</span>
                {e.status && <Status status={e.status} />}
              </span>
              <span className="small">{e.subject ? <Link href={e.subject.href} className="pkg-name">{e.subject.label}</Link> : <span className="faint">batch</span>}</span>
              <span className="num right small">{e.amount ?? ""}</span>
            </div>
          ))}
          {!list.length && <div className="empty">No PayPal events yet.</div>}
        </div>
      </section>
    </main>
  );
}
