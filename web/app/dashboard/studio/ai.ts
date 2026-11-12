// The dashboard's AI team: Studio's five built-in agents running on Claude, plus our own
// "Payout explainer" agent that the lead can delegate to.
import { createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgAiPromptStarter } from "ag-studio";
import type { DashboardData } from "@/lib/dashboard";
import { claudeAdapter } from "./claude-adapter";
import { PAYOUTS_AGENT, explainPayoutTool, payoutAgent } from "./payout-agent";

const BUILT_IN_DELEGATES = ["data", "widget", "page", "planning"];

const LEAD_EXTRA = `

## Payouts
When the user asks why a package was paid, or what PayPal confirmed for a payout, delegate to
"${PAYOUTS_AGENT}" with the package name. It answers from the ledger's own records; repeat its
answer and do not guess. Money only counts as paid once PayPal's signed webhook says so.`;

function starters(data: DashboardData): AgAiPromptStarter[] {
  const pkg = data.payouts.find((p) => p.verified)?.package ?? data.payouts[0]?.package ?? "debug";
  return [
    { label: `Why was ${pkg} paid?`, prompt: `Why was ${pkg} paid, and what has PayPal confirmed for that payout?` },
    { label: "Who is still waiting?", prompt: "Which maintainers have not claimed their payout yet, and how much is waiting?" },
    { label: "Summarise this page", prompt: "Summarise what this page shows and what stands out." },
  ];
}

/** `models` holds the model CLAUDE_MODEL allows on the server. */
export function buildAi(models: string[], data: DashboardData): AgAiHarnessSetup {
  const adapter = claudeAdapter({ endpoint: "/api/ai/claude", model: models[0] });

  return ({ api }) =>
    createAiHarness(api, ({ builtIn }) => {
      const run = (id: keyof typeof builtIn) => directLlmRunner({ ...builtIn[id], adapter });
      const lead = directLlmRunner({
        ...builtIn.lead,
        adapter,
        instructions: (ctx, params) => (builtIn.lead.instructions?.(ctx, params) ?? "") + LEAD_EXTRA,
        // Same tools as the built-in lead, but able to hand work to our agent too.
        tools: (ctx, params) => [
          ...(builtIn.lead.tools?.(ctx, params) ?? []).filter((t) => t.name !== "delegate_to"),
          ctx.tools.delegateTo([...BUILT_IN_DELEGATES, PAYOUTS_AGENT]),
        ],
      });
      return {
        agents: [lead, run("data"), run("widget"), run("page"), run("planning"), payoutAgent(explainPayoutTool(api, data))],
        primary: "lead",
        models: models.length > 1 ? models.map((id) => ({ id, label: id })) : undefined,
        promptStarters: starters(data),
      };
    });
}
