import type { Metadata } from "next";
import Link from "next/link";
import { REPO } from "@/lib/views";
import { Icon, PageHead } from "../components/ui";

export const metadata: Metadata = { title: "How it works", description: "Signals, the agent, money rules in code, and PayPal from payout to signed proof." };

const FLOW = [
  { icon: "scan", t: "Lockfile", d: "package-lock.json, uv.lock, requirements.txt" },
  { icon: "search", t: "Facts", d: "npm, PyPI and deps.dev, per package" },
  { icon: "spark", t: "Agent", d: "Claude weighs, inspects, explains" },
  { icon: "lock", t: "Money rules", d: "caps and payees, in plain code" },
  { icon: "send", t: "PayPal Payouts", d: "one batch, one payout per email" },
  { icon: "shield", t: "Signed proof", d: "webhooks verified, then shown here" },
];

export default function HowItWorks() {
  return (
    <main className="page container">
      <PageHead eyebrow="How it works" title="Facts in, judgment from the agent, money rules in code">
        A run reads your lockfile, gathers public facts about each package, lets an AI agent decide where money protects you
        most, and pays maintainers with PayPal. Nothing the agent says can move money outside the rules below.
      </PageHead>

      <div className="flow">
        {FLOW.map((f, i) => (
          <div key={f.t} className="flow-node">
            <div className="icon"><Icon name={f.icon} size={17} /></div>
            <div className="n mono tiny faint">{String(i + 1).padStart(2, "0")}</div>
            <h3>{f.t}</h3>
            <p>{f.d}</p>
          </div>
        ))}
      </div>

      <section className="block">
        <div className="block-head">
          <div>
            <div className="eyebrow">Signals</div>
            <h2>Three questions about every package</h2>
            <p>High on all three means more money. Popularity alone counts for nothing.</p>
          </div>
        </div>
        <div className="grid-3">
          <div className="card pad">
            <span className="tag accent">R · reliance</span>
            <h3 style={{ marginTop: 12 }}>How much do you lean on it?</h3>
            <p>Direct or deep in the tree, how many of your packages need it, and how many projects across the ecosystem depend on it.</p>
          </div>
          <div className="card pad">
            <span className="tag bad">F · fragility</span>
            <h3 style={{ marginTop: 12 }}>How likely is it to break?</h3>
            <p>Number of maintainers, release history, open security advisories, the OpenSSF Scorecard, and deprecation.</p>
          </div>
          <div className="card pad">
            <span className="tag wait">U · underfunded</span>
            <h3 style={{ marginTop: 12 }}>Is anyone already paying?</h3>
            <p>Declared funding links, sponsors and company backing, relative to the project&apos;s size.</p>
          </div>
        </div>
      </section>

      <section className="block grid-2">
        <div className="card pad">
          <div className="eyebrow">The agent</div>
          <h3 style={{ fontSize: 18, margin: "8px 0 10px" }}>An agent with tools, not a single prompt</h3>
          <ul className="checks">
            <li>Gets a goal, &ldquo;spend $500 where it protects us most&rdquo;, plus your rules in plain English.</li>
            <li>Can <code>inspect_package</code> to read a README and the full facts before deciding.</li>
            <li>Watches for gaming: inflated downloads with few real dependents, brand-new packages, promotional READMEs.</li>
            <li>Returns weights, a reason and evidence for each pick, and why it skipped others.</li>
            <li>Plans the re-split when a payout goes unclaimed.</li>
          </ul>
          <p className="small" style={{ marginTop: 14 }}>
            Its full instructions are public: <a href={`${REPO}/blob/main/methodology/agent-prompt.md`}>methodology/agent-prompt.md</a>
          </p>
        </div>
        <div className="card pad">
          <div className="eyebrow">Money rules, enforced in code</div>
          <h3 style={{ fontSize: 18, margin: "8px 0 10px" }}>The AI proposes. Code decides the dollars.</h3>
          <ul className="checks">
            <li>Never more than the budget; whole-dollar amounts.</li>
            <li>At most 30% of the budget to one package; the rest stays unspent.</li>
            <li>$5 minimum per payout, at most 10 packages.</li>
            <li>Payees only from emails published in registry metadata. The agent can&apos;t add or change one.</li>
            <li>Company rules can make limits stricter, never looser.</li>
            <li>A person approves before anything is paid: on the approval page with a passphrase the agent never has, or in their own terminal.</li>
          </ul>
        </div>
      </section>

      <section className="block">
        <div className="block-head">
          <div>
            <div className="eyebrow">PayPal</div>
            <h2>What PayPal does at each step</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Feature</th><th>How it is used</th></tr></thead>
            <tbody>
              <tr><td>Payouts API</td><td>One batch per run, one payout per maintainer email. The batch id comes from the run id, so a re-run can&apos;t pay twice.</td></tr>
              <tr><td>Payout item cancel</td><td>Unclaimed payouts are cancelled so the agent can re-split the money to other packages.</td></tr>
              <tr><td>Orders: authorize, capture, void</td><td>Pledges. The funder approves a hold once; it is captured when the work ships or voided if not.</td></tr>
              <tr><td>Webhooks</td><td>Payout, batch, authorization and capture events drive every status on this site.</td></tr>
              <tr><td>Webhook signature check</td><td>SHA256withRSA over transmission id, time, webhook id and CRC32 of the body, with PayPal&apos;s certificate fetched only from paypal.com.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="block grid-2">
        <div>
          <div className="eyebrow">Command line</div>
          <h2 style={{ fontSize: 20, margin: "4px 0 14px" }}>Run it on your project</h2>
          <pre className="code">{`# install the command (straight from GitHub)
npm install -g https://github.com/apple171/pay-it-upstream/tarball/main

cd your-app
pay-it-upstream setup          # model, PayPal, approver
pay-it-upstream --budget 500   # propose, wait for approval, pay
pay-it-upstream status         # who has been paid
pay-it-upstream resplit        # re-split unclaimed payouts`}</pre>
          <p className="small muted" style={{ marginTop: 12 }}>
            Or run it once without installing: <code>npx github:apple171/pay-it-upstream --help</code>
          </p>
        </div>
        <div id="agents">
          <div className="eyebrow">Coding agents (MCP)</div>
          <h2 style={{ fontSize: 20, margin: "4px 0 14px" }}>Let your coding agent fund what it installs</h2>
          <pre className="code">{`{
  "mcpServers": {
    "pay-it-upstream": {
      "command": "node",
      "args": ["/path/to/pay-it-upstream/mcp/server.ts"]
    }
  }
}`}</pre>
          <p className="small muted" style={{ marginTop: 12 }}>
            Tools: <code>scan_dependencies</code>, <code>propose_funding</code>, <code>send_payouts</code> (pays only after a person approves the plan on its approval page) and{" "}
            <code>payout_status</code>. <a href={`${REPO}/tree/main/mcp`}>Setup guide</a>
          </p>
        </div>
      </section>

      <section className="block">
        <div className="callout accent">
          <Icon name="github" size={20} />
          <div style={{ flex: 1 }}>
            <h3>Open source, MIT licensed</h3>
            <p>The CLI, the agent&apos;s instructions, the MCP server and this site are all in one repository.</p>
          </div>
          <a className="btn small" href={REPO}>View on GitHub</a>
        </div>
        <p className="small faint" style={{ marginTop: 16 }}>
          Want to see it in practice? <Link href="/runs">Browse the runs</Link> or <Link href="/proof">check the signed event log</Link>.
        </p>
      </section>
    </main>
  );
}
