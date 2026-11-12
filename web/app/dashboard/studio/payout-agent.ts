// "Payout explainer": our own agent in Studio's team. The built-in lead delegates to it with a
// package name; it answers from the ledger itself (stored reason, evidence and PayPal-verified
// status history) through the explain_payout tool, with no model call, then reports back to the
// lead through complete_task.
import { createAiToolContext, type AgAiAgentRunner, type AgAiEvent, type AgAiTool, type AgStudioApi } from "ag-studio";
import type { DashboardData, PayoutRow } from "@/lib/dashboard";

export const PAYOUTS_AGENT = "payouts";
export const EXPLAIN_TOOL = "explain_payout";

export interface ExplainData {
  package: string;
  payouts: Pick<
    PayoutRow,
    "amount" | "currency" | "status" | "verified" | "steps" | "sentAt" | "settledAt" | "maintainer" | "company" | "env" | "reason" | "evidence" | "reliance" | "fragility" | "underfunded"
  >[];
}

const money = (n: number, c: string) => `${c} ${n.toFixed(2)}`;

function explain(rows: PayoutRow[]): string {
  return rows
    .map((p) => {
      const signed = p.verified ? "PayPal-signed webhook confirmed it" : "PayPal has not confirmed it yet";
      return [
        `${p.package} (${p.ecosystem}) got ${money(p.amount, p.currency)} from ${p.company}${p.env === "sandbox" ? " (sandbox)" : ""}.`,
        `Status: ${p.status} (${p.steps}); ${signed}.`,
        `Why: ${p.reason}`,
        p.evidence && `Evidence: ${p.evidence}.`,
        `Reliance ${p.reliance || "?"}, fragility ${p.fragility || "?"}, underfunded ${p.underfunded || "?"}. Maintainer ${p.maintainer}.`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export function explainPayoutTool(api: AgStudioApi, data: DashboardData): AgAiTool {
  return api.defineAiTool({
    name: EXPLAIN_TOOL,
    description:
      "Look up the payouts to one package in the ledger: amount, PayPal-verified status history, the stored reason and evidence, and the masked maintainer.",
    params: (s) => s.object({ package: s.string({ description: 'Package name, e.g. "debug".' }) }),
    execute: (args, ctx) => {
      const name = args.package.trim().toLowerCase();
      const rows = data.payouts.filter((p) => p.package.toLowerCase() === name);
      if (!rows.length) {
        const known = [...new Set(data.payouts.map((p) => p.package))].join(", ");
        return ctx.error(`No payout to "${args.package}" in the ledger. Paid packages: ${known || "none"}.`);
      }
      const payload: ExplainData = {
        package: rows[0].package,
        payouts: rows.map(({ amount, currency, status, verified, steps, sentAt, settledAt, maintainer, company, env, reason, evidence, reliance, fragility, underfunded }) => ({
          amount, currency, status, verified, steps, sentAt, settledAt, maintainer, company, env, reason, evidence, reliance, fragility, underfunded,
        })),
      };
      return ctx.success(explain(rows), payload);
    },
  });
}

type Params = { package: string };

export function payoutAgent(tool: AgAiTool): AgAiAgentRunner<Params> {
  return {
    id: PAYOUTS_AGENT,
    name: "Payout explainer",
    description:
      "Explains why one package was paid and what PayPal has confirmed, from the ledger's stored reason, evidence and signed webhook history. Give it the package name.",
    schema: (s) => s.object({ package: s.string({ description: "The package whose payout to explain." }) }),
    tools: () => [tool],
    run: async function* (input, ctx): AsyncGenerator<AgAiEvent> {
      const { threadId, runId } = input;
      yield { type: "RUN_STARTED", threadId, runId };

      // Look the payout up through the tool, so the step shows in the chat panel.
      const args = { package: ctx.params?.package ?? "" };
      const callId = `${runId}-explain`;
      yield { type: "TOOL_CALL_START", toolCallId: callId, toolCallName: EXPLAIN_TOOL };
      yield { type: "TOOL_CALL_ARGS", toolCallId: callId, delta: JSON.stringify(args) };
      yield { type: "TOOL_CALL_END", toolCallId: callId };
      const explainTool = ctx.tools().find((t) => t.name === EXPLAIN_TOOL);
      const result = await explainTool!.execute!(
        { toolCallId: callId, name: EXPLAIN_TOOL, args },
        createAiToolContext({ signal: ctx.signal, run: { threadId, runId } }),
      );
      yield { type: "TOOL_CALL_RESULT", messageId: `${callId}-result`, toolCallId: callId, content: JSON.stringify(result) };

      const answer = result.success ? result.response : result.issues.map((i) => i.message).join(" ");
      const messageId = `${runId}-answer`;
      yield { type: "TEXT_MESSAGE_START", messageId, role: "assistant" };
      yield { type: "TEXT_MESSAGE_CONTENT", messageId, delta: answer };
      yield { type: "TEXT_MESSAGE_END", messageId };

      // Hand the answer back to the agent that delegated to us.
      if (ctx.completeTask) {
        const doneId = `${runId}-complete`;
        const doneArgs = { summary: answer, artifacts: [] };
        yield { type: "TOOL_CALL_START", toolCallId: doneId, toolCallName: ctx.completeTask.name };
        yield { type: "TOOL_CALL_ARGS", toolCallId: doneId, delta: JSON.stringify(doneArgs) };
        yield { type: "TOOL_CALL_END", toolCallId: doneId };
        const done = await ctx.completeTask.execute!(
          { toolCallId: doneId, name: ctx.completeTask.name, args: doneArgs },
          createAiToolContext({ signal: ctx.signal, run: { threadId, runId } }),
        );
        yield { type: "TOOL_CALL_RESULT", messageId: `${doneId}-result`, toolCallId: doneId, content: JSON.stringify(done) };
      }
      yield { type: "RUN_FINISHED", threadId, runId };
    },
  };
}
