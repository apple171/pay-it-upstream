// AG Studio data sources: the four ledger tables, how they join, a shared calendar and one measure.
import type { AgDataSourcesDefinition, AgFieldDefinition, AgFormat } from "ag-studio";
import type { DashboardData } from "@/lib/dashboard";
import type { Registry } from "../widgets/types";

type Spec = [id: string, name: string, format: AgFormat<Registry>, hide?: boolean, description?: string];
const usd = { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }) };
const fields = (specs: Spec[]): AgFieldDefinition<Registry>[] =>
  specs.map(([id, name, format, hide, description]) => ({
    id,
    name,
    format,
    ...(format === "currencyFormat" && { formatOptions: usd }),
    ...(hide && { hide }),
    ...(description && { description }),
  }));

export const hasData = (d: DashboardData) => d.payouts.length > 0 || d.runs.length > 0;

export function buildStudioData(d: DashboardData): AgDataSourcesDefinition<Registry> {
  const dates = [...d.payouts.map((p) => p.sentAt), ...d.runs.map((r) => r.date), ...d.events.map((e) => e.receivedAt)]
    .map((s) => s.slice(0, 10))
    .sort();
  const today = d.asOf.slice(0, 10);

  return {
    description:
      "Pay It Upstream's public ledger. Companies run a CLI on their code; an AI agent picks the open-source packages they depend on " +
      "that are most at risk and underfunded; PayPal Payouts pays the maintainers. A payout counts as paid only once a " +
      "signature-checked PayPal webhook says so (verified = true). Amounts are USD. Maintainer contacts are masked.",
    sources: [
      {
        id: "payouts",
        description: "One row per payout to a package maintainer.",
        data: d.payouts,
        fields: fields([
          ["id", "Payout ID", "textFormat", true],
          ["sentAt", "Sent", "dateTimeFormat"],
          ["settledAt", "Confirmed by PayPal", "dateTimeFormat", false, "When the last PayPal-signed webhook arrived. Blank while only sent."],
          ["package", "Package", "textFormat"],
          ["ecosystem", "Ecosystem", "textFormat"],
          ["amount", "Amount", "currencyFormat"],
          ["currency", "Currency", "textFormat", true],
          ["status", "Status", "textFormat", false, "paid, waiting to claim, sent, returned, ..."],
          ["statusCode", "PayPal Status", "textFormat", true],
          ["verified", "PayPal-signed", "booleanFormat", false, "True once the status came from a signature-checked PayPal webhook."],
          ["steps", "Status History", "textFormat"],
          ["reliance", "Reliance", "textFormat", false, "How much the company's software relies on the package: low, medium, high."],
          ["fragility", "Fragility", "textFormat", false, "How fragile its upkeep is (few maintainers, stale releases): low, medium, high."],
          ["underfunded", "Underfunded", "textFormat"],
          ["relianceScore", "Reliance Score", "decimalFormat", false, "Reliance as 1 (low) to 3 (high)."],
          ["fragilityScore", "Fragility Score", "decimalFormat", false, "Fragility as 1 (low) to 3 (high)."],
          ["underfundedScore", "Underfunded Score", "decimalFormat", false, "Underfunding as 1 (low) to 3 (high)."],
          ["maintainer", "Maintainer (masked)", "textFormat"],
          ["company", "Company", "textFormat"],
          ["runId", "Run ID", "textFormat", true],
          ["env", "Environment", "textFormat", false, "sandbox (test money) or live."],
          ["reason", "Why", "textFormat"],
          ["evidence", "Evidence", "textFormat"],
          ["paidAmount", "Paid", "currencyFormat", false, "Amount when PayPal confirmed it paid, else 0."],
          ["waitingAmount", "Waiting to Claim", "currencyFormat", false, "Amount sent but not yet claimed by the maintainer, else 0."],
        ]),
      },
      {
        id: "runs",
        description: "One row per CLI run (a plan, or a re-split of an earlier plan).",
        data: d.runs,
        fields: fields([
          ["id", "Run", "textFormat"],
          ["date", "Run Date", "dateTimeFormat"],
          ["company", "Run Company", "textFormat"],
          ["kind", "Kind", "textFormat"],
          ["env", "Run Environment", "textFormat"],
          ["budget", "Budget", "currencyFormat"],
          ["spent", "Sent Total", "currencyFormat"],
          ["paid", "Run Paid", "currencyFormat"],
          ["waiting", "Run Waiting", "currencyFormat"],
          ["payouts", "Payouts", "integerFormat"],
          ["model", "Model", "textFormat"],
          ["methodFingerprint", "Method Fingerprint", "textFormat"],
          ["rulesFingerprint", "Rules Fingerprint", "textFormat"],
          ["summary", "Plan Summary", "textFormat"],
        ]),
      },
      {
        id: "critical",
        name: "Critical Packages",
        description: "Packages with one maintainer that much of the ecosystem relies on, and whether any verified payout has reached them.",
        data: d.critical,
        fields: fields([
          ["package", "Critical Package", "textFormat"],
          ["funded", "Funded", "booleanFormat"],
          ["fundedCount", "Funded (1/0)", "integerFormat"],
          ["paid", "Critical Paid", "currencyFormat"],
        ]),
      },
      {
        id: "events",
        name: "PayPal Events",
        description: "Signature-checked PayPal webhook log. Payout statuses change only on these.",
        data: d.events,
        fields: fields([
          ["id", "Event ID", "textFormat"],
          ["receivedAt", "Received", "dateTimeFormat"],
          ["type", "Event Type", "textFormat"],
          ["status", "Event Status", "textFormat"],
          ["amount", "Event Amount", "currencyFormat"],
          ["currency", "Event Currency", "textFormat", true],
          ["package", "Event Package", "textFormat"],
          ["payoutId", "Event Payout ID", "textFormat", true],
        ]),
      },
    ],
    relationships: [
      { id: "payout-run", source: { tableId: "payouts", fieldId: "runId" }, target: { tableId: "runs", fieldId: "id" }, type: "many-to-one" },
      { id: "event-payout", source: { tableId: "events", fieldId: "payoutId" }, target: { tableId: "payouts", fieldId: "id" }, type: "many-to-one" },
      { id: "payouts-calendar", source: { tableId: "payouts", fieldId: "sentAt" }, target: { calendarId: "calendar" }, truncate: "day" },
      { id: "runs-calendar", source: { tableId: "runs", fieldId: "date" }, target: { calendarId: "calendar" }, truncate: "day" },
      { id: "events-calendar", source: { tableId: "events", fieldId: "receivedAt" }, target: { calendarId: "calendar" }, truncate: "day" },
    ],
    calendars: [
      {
        id: "calendar",
        label: "Calendar",
        range: { from: { type: "date", value: dates[0] ?? today }, to: { type: "date", value: dates.at(-1) ?? today } },
        fragments: ["year", "quarter", "month", "week", "day"],
      },
    ],
    expressions: [
      {
        id: "claimRate",
        name: "Claimed Share",
        description: "Paid / sent: how much of the money sent maintainers have received.",
        format: "percentageFormat",
        isMeasure: true,
        expression: { operator: "divide", inputs: [{ id: "payouts.paidAmount", aggregation: "sum" }, { id: "payouts.amount", aggregation: "sum" }] },
      },
    ],
  };
}
