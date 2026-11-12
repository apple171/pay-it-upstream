import Link from "next/link";
import { readLedger } from "@/lib/store";
import { REPO, money, runSummaries, stats, when } from "@/lib/views";
import { AutoRefresh } from "./components/auto-refresh";
import { EnvTag, Icon, Signed, SplitBar, Status } from "./components/ui";

export const dynamic = "force-dynamic";

export default async function Home() {
  const l = await readLedger();
  const s = stats(l);
  const runs = runSummaries(l).slice(0, 3);
  const recent = Object.values(l.items)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6);
  const pct = s.critical.total ? Math.round((100 * s.critical.funded) / s.critical.total) : 0;

  return (
    <>
      <AutoRefresh seconds={6} />
      <section className="hero">
        <div className="container">
          <div>
            <span className="pill-note">
              <b>AGENTS-FIRST</b> open-source funding, humans approve
            </span>
            <h1>
              Agents pick. <em>You approve.</em> PayPal pays.
            </h1>
            <p className="lede">
              In the vibe-coded era, people barely look at the packages their code runs on. Agents do. Pay It Upstream lets
              your coding agent find the fragile open source your project depends on and propose who to fund, with reasons.
              You approve on one page. PayPal pays the maintainers, and a PayPal-signed webhook proves every payment.
            </p>
            <div className="actions">
              <a className="btn primary" href="#start">
                <Icon name="terminal" size={16} /> Get started
              </a>
              <a className="btn" href={REPO}>
                <Icon name="github" size={16} /> GitHub
              </a>
              <Link className="btn" href="/how-it-works" style={{ border: 0, background: "transparent" }}>
                How it works <Icon name="arrow" size={15} />
              </Link>
            </div>
          </div>
          <Terminal />
        </div>
      </section>

      <main className="container" style={{ paddingBottom: 80 }}>
        <section className="block" style={{ marginTop: 36 }}>
          <div className="block-head">
            <div>
              <div className="eyebrow">Why agents</div>
              <h2>Nobody reads the dependency tree any more</h2>
              <p>Our small sample app, by the numbers. Most of what it runs on arrived without a person ever looking at it.</p>
            </div>
          </div>
          <div className="stats">
            <div className="stat"><div className="v">113</div><div className="l">packages installed</div></div>
            <div className="stat"><div className="v">12</div><div className="l">chosen by a person</div></div>
            <div className="stat"><div className="v wait">101</div><div className="l">nobody looked at</div></div>
            <div className="stat"><div className="v ok">40</div><div className="l">looked up by the agent in one run, 10 funded with reasons</div></div>
          </div>
        </section>

        <section className="block">
          <div className="block-head">
            <div>
              <div className="eyebrow">Who does what</div>
              <h2>The agent leads. Code guards the money. You decide.</h2>
            </div>
            <Link className="more" href="/how-it-works">The full method →</Link>
          </div>
          <div className="roles">
            <div className="card step">
              <div className="icon"><Icon name="bot" size={17} /></div>
              <div className="n">agent</div>
              <h3>Researches and proposes</h3>
              <p>Reads the lockfile, weighs how much you rely on each package, how fragile it is and whether anyone funds it. Skips gamed and agent-bait packages. Explains every pick.</p>
            </div>
            <div className="card step">
              <div className="icon"><Icon name="lock" size={17} /></div>
              <div className="n">code</div>
              <h3>Enforces the money rules</h3>
              <p>Budget, at most 30% per package, $5 minimum, payees only from published registry emails. The agent can tighten these, never loosen them.</p>
            </div>
            <div className="card step">
              <div className="icon"><Icon name="hand" size={17} /></div>
              <div className="n">you</div>
              <h3>Approve on one page</h3>
              <p>The plan waits on an approval page. Only the approver passphrase moves it forward, and the agent never has it.</p>
            </div>
            <div className="card step">
              <div className="icon"><Icon name="shield" size={17} /></div>
              <div className="n">PayPal</div>
              <h3>Pays and proves it</h3>
              <p>One Payouts batch. Unclaimed payouts are cancelled and re-split. Every status here comes from a signed PayPal webhook.</p>
            </div>
          </div>
        </section>

        <section className="block" id="start">
          <div className="block-head">
            <div>
              <div className="eyebrow">Get started</div>
              <h2>Two minutes in your repo</h2>
              <p>Runs straight from GitHub today; the npm release comes next.</p>
            </div>
          </div>
          <div className="grid-3">
            <div className="card pad">
              <div className="n mono tiny faint">01 · set up once</div>
              <pre className="code wrap" style={{ marginTop: 10 }}>{`npx github:apple171/pay-it-upstream setup`}</pre>
              <p className="small" style={{ marginTop: 10 }}>Pick the model, connect your PayPal account, set the approver passphrase. Keys stay in a git-ignored file.</p>
            </div>
            <div className="card pad">
              <div className="n mono tiny faint">02 · let the agent work</div>
              <pre className="code wrap" style={{ marginTop: 10 }}>{`npx github:apple171/pay-it-upstream --budget 50`}</pre>
              <p className="small" style={{ marginTop: 10 }}>Or ask your coding agent: &ldquo;fund our dependencies with $50&rdquo;. It runs this, or uses the MCP tools.</p>
            </div>
            <div className="card pad">
              <div className="n mono tiny faint">03 · approve, PayPal pays</div>
              <pre className="code wrap" style={{ marginTop: 10 }}>{`pay-it-upstream status`}</pre>
              <p className="small" style={{ marginTop: 10 }}>Open the approval link, read the reasons, approve. Then see who has been paid and who still has to claim.</p>
            </div>
          </div>
        </section>

        <section className="block">
          <div className="block-head">
            <div>
              <div className="eyebrow">On the public ledger</div>
              <h2>What has been paid so far</h2>
            </div>
            <Link className="more" href="/proof">See the signed event log →</Link>
          </div>
          <div className="stats">
            <div className="stat">
              <div className="v ok">{money(s.paidCents)}</div>
              <div className="l">paid to maintainers</div>
            </div>
            <div className="stat">
              <div className="v wait">{money(s.waitingCents)}</div>
              <div className="l">waiting to be claimed</div>
            </div>
            <div className="stat">
              <div className="v">
                {s.critical.funded}
                <small>/{s.critical.total}</small>
              </div>
              <div className="l">critical one-maintainer packages funded</div>
              <div className="meter">
                <div style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="stat">
              <div className="v">{s.signedEvents}</div>
              <div className="l">
                <span className="live">live</span> PayPal-signed webhooks · {s.refused} refused
              </div>
            </div>
          </div>
        </section>

        <section className="block">
          <div className="block-head">
            <div>
              <div className="eyebrow">Latest runs</div>
              <h2>What companies funded, and why</h2>
            </div>
            <Link className="more" href="/runs">
              All {s.runs} runs →
            </Link>
          </div>
          {runs.length ? (
            <div className="grid-3">
              {runs.map((r) => (
                <Link key={r.id} href={`/runs/${r.id}`} className="card run-card">
                  <div className="top">
                    <span className="small">{r.company}</span>
                    <span className="chips">
                      {r.kind === "resplit" && <span className="tag accent">re-split</span>}
                      <EnvTag env={r.env} />
                    </span>
                  </div>
                  <div className="amount">{money(r.sentCents, r.currency)}</div>
                  <div className="tiny faint">
                    to {r.payouts} packages · {when(r.createdAt)}
                  </div>
                  <p className="summary">{r.summary}</p>
                  <SplitBar paid={r.paidCents} waiting={r.waitingCents} other={r.otherCents} currency={r.currency} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="list"><div className="empty">No runs published yet.</div></div>
          )}
        </section>

        <section className="block grid-2">
          <div className="card pad">
            <div className="eyebrow">For coding agents</div>
            <h3 style={{ fontSize: 18, margin: "8px 0 6px" }}>The agent that installs a package can fund it.</h3>
            <p>An MCP server gives any coding agent four tools: scan, propose (returns your approval link), pay once you&apos;ve approved, and check status.</p>
            <pre className="code" style={{ marginTop: 16 }}>{`"pay-it-upstream": {
  "command": "node",
  "args": ["pay-it-upstream/mcp/server.ts"]
}`}</pre>
            <div style={{ marginTop: 14 }}>
              <Link href="/how-it-works#agents">Set it up →</Link>
            </div>
          </div>
          <div className="card pad">
            <div className="eyebrow">Also: pledges</div>
            <h3 style={{ fontSize: 18, margin: "8px 0 6px" }}>Pay for the fix, not just the thanks.</h3>
            <p>Hold money with PayPal toward a security fix or a feature. It goes to the maintainer when the work ships, and is released if it doesn&apos;t.</p>
            <pre className="code" style={{ marginTop: 16 }}>{`$ pay-it-upstream --security-fix escape-html \\
    --amount 80 --note "Escape backticks"
✓ $80.00 held with PayPal until Dec 10`}</pre>
            <div style={{ marginTop: 14, display: "flex", gap: 18, flexWrap: "wrap" }}>
              <Link href="/pledges">{s.pledges} pledges so far →</Link>
              {s.openPledges > 0 && <span className="small muted">{money(s.heldCents)} held right now</span>}
            </div>
          </div>
        </section>

        <section className="block">
          <div className="callout accent">
            <Icon name="hand" size={20} />
            <div style={{ flex: 1 }}>
              <h3>Maintain an open-source package?</h3>
              <p>Money may already be waiting for you. Search your package to see what companies have paid, and how to claim it.</p>
            </div>
            <Link className="btn small" href="/maintainers">
              Find my package
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}

function Terminal() {
  return (
    <div className="terminal" aria-label="Example: a coding agent runs the command, a person approves, PayPal pays">
      <div className="terminal-bar">
        <i /><i /><i />
        <span>coding agent · ~/acme-api</span>
      </div>
      <pre>
        <span className="t-acc">you › </span><span className="t-cmd">fund our dependencies, budget $500</span>{"\n"}
        <span className="t-dim">$ </span><span className="t-cmd">pay-it-upstream --budget 500</span>{"\n"}
        <span className="t-acc">▸ </span>Reading lockfiles <span className="t-dim">113 packages, 12 chosen by a person</span>{"\n"}
        <span className="t-acc">▸ </span>Looking up 40 packages <span className="t-dim">npm · PyPI · deps.dev</span>{"\n"}
        <span className="t-acc">▸ </span>Agent is choosing where the money protects you most{"\n"}
        <span className="t-ok">  ✓ </span>depd          <span className="t-cmd">$70</span>  <span className="t-dim">8 years, no release, 1 maintainer</span>{"\n"}
        <span className="t-ok">  ✓ </span>escape-html   <span className="t-cmd">$60</span>  <span className="t-dim">security path, last release 2015</span>{"\n"}
        <span className="t-dim">    … 8 more, each with a reason</span>{"\n"}
        <span className="t-bad">  ✗ </span>colors-pro-max <span className="t-warn">skipped: likely gaming</span>{"\n"}
        <span className="t-acc">▸ </span>Waiting for a person to approve $500{"\n"}
        <span className="t-dim">  approve: pay-it-upstream.ienv.site/approve/…</span>{"\n"}
        <span className="t-ok">  ✓ Approved by Jason on the site</span>{"\n"}
        <span className="t-ok">  ✓ PayPal batch sent · verified by signed webhooks</span>{"\n"}
        <span className="t-dim">$ </span><span className="t-caret" />
      </pre>
    </div>
  );
}
