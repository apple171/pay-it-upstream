# Pay It Upstream: MCP server for coding agents

> Agents now write much of our code and pull in its dependencies. This server lets the same agent **fund** them. The agent proposes, a person approves, PayPal pays.

It is a [Model Context Protocol](https://modelcontextprotocol.io) server. Any MCP-capable coding agent or editor can use it. The agent does the judging; Pay It Upstream supplies the facts, enforces the money rules in plain code, and moves the money with **PayPal Payouts** only after a person approves the plan on an approval page that the agent can't use.

## The flow

```
you:    "Fund the open source this project depends on. Budget $500."
agent → scan_dependencies   lockfile → public facts on each package + the funding method
agent → propose_funding     its picks + reasons → exact amounts (limits enforced in code) + an approval link
you:    open the link, read the plan, approve with your passphrase   (the agent can't do this step)
agent → send_payouts        checks the approval, then one PayPal Payouts batch, one payout per maintainer
agent → payout_status       "8 paid, 2 waiting to claim"
```

## Tools

| Tool | What it does | Moves money? |
|---|---|---|
| `scan_dependencies` | Reads `package-lock.json`, `uv.lock` or `requirements.txt`, and gathers reliance, fragility and funding facts from npm, PyPI and deps.dev. Returns a candidate table and the method to apply. | No |
| `propose_funding` | Takes the agent's picks (weights, reasons, evidence) and returns an exact plan plus an approval link. Budget, a 30% cap per package, a $5 minimum, company rules and payable-only payees are all enforced in code. | No |
| `send_payouts` | Pays a plan only after a person approved it on the approval page; otherwise it pays nothing and returns the link. A run can never be paid twice. | **Yes** |
| `payout_status` | Reads the PayPal batch: who has been paid and who still needs to claim. | No |

There is also a prompt, `fund_my_dependencies`, that walks the agent through the whole flow.

## Guardrails

- **Facts in, judgment from the agent, money rules in code.** The agent can make the limits stricter but never looser.
- **Payees come from registry metadata only.** The agent can't add or change a recipient.
- **A person approves, not the agent.** The plan waits on the site's approval page. Approving needs the approver passphrase, which the agent never has: only a salted hash of it is stored. Without a connected site, approval happens in the person's own terminal (`pay-it-upstream pay <run>`). The payout code itself refuses any plan without an approval on record.
- **Idempotent.** PayPal refuses a reused batch id, so a retried call never pays twice.
- **Sandbox by default.** With `PAYPAL_ENV=sandbox`, maintainers are replaced by your sandbox test accounts.

## Setup

```bash
npm install            # in the repository root (shared code)
cd mcp && npm install  # the MCP server's own packages
pay-it-upstream setup  # in your project: PayPal keys and the approver passphrase (in your own terminal)
```

Add it to your agent's MCP configuration (the usual `mcpServers` format):

```json
{
  "mcpServers": {
    "pay-it-upstream": {
      "command": "node",
      "args": ["/path/to/pay-it-upstream/mcp/server.ts", "--env", "/path/to/your/.env"]
    }
  }
}
```

`--env` is optional: the server also reads each project's `.pay-it-upstream/settings.env`, written by `pay-it-upstream setup` (same variables as [`../.env.example`](../.env.example)). No AI key is needed: the agent you're already using does the thinking.

### Claude Desktop and Claude Code (per project)

To give one project the tools, put a `.mcp.json` in that project's folder:

```json
{
  "mcpServers": {
    "pay-it-upstream": {
      "command": "node",
      "args": ["/path/to/pay-it-upstream/mcp/server.ts"]
    }
  }
}
```

Project servers need approval before they load. If no prompt appears, approve it in the project's `.claude/settings.local.json`:

```json
{ "enabledMcpjsonServers": ["pay-it-upstream"] }
```

Then start a **new** session in that folder (servers load when a session starts) and ask: *"Fund our dependencies with $20 using Pay It Upstream."* The agent scans, proposes, and hands you the approval link; after you approve, it pays and checks the status.

Requires Node.js 22.18 or newer (it runs TypeScript directly). Runs and scans are saved in the project's `.pay-it-upstream/` folder, the same as the CLI, so `pay-it-upstream status` and `resplit` work on them too.
