// The dashboard's starting report: an overview page and a runs / PayPal log page. Field ids
// ("payouts.paidAmount") refer to the tables in ./data.ts. Positions are on Studio's 24-column grid.
import type { AgAggregationFunction, AgReportState, AgWidgetLayoutState } from "ag-studio";
import type { Registry } from "../widgets/types";

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const f = (id: string, aggregation?: AgAggregationFunction) => ({ id, ...(aggregation && { aggregation }) });
const title = (text: string) => ({ title: { enabled: true, text } });
const legend = { style: { theme: { common: { legend: { enabled: true } } } } };

// Same stack as the site (app/globals.css --font).
const FONT = "var(--font-geist), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "var(--font-geist-mono), ui-monospace, Menlo, monospace";
const type = (fontSize: number, fontWeight: "normal" | "bold" = "normal", fontFamily = FONT) => ({ fontFamily, fontSize, fontWeight, fontStyle: "normal" as const });

const kpi = (text: string, value: ReturnType<typeof f>, sparklineX?: string) => ({
  type: "value" as const,
  dataMapping: { value: [value], ...(sparklineX && { sparklineX: [f(sparklineX)] }) },
  format: {
    title: { enabled: true, text, typography: type(13, "bold") },
    caption: { enabled: false, text: "" },
    style: { typography: type(26, "normal", MONO) },
  },
});

export const PAGES = [
  { id: "overview", title: "Overview" },
  { id: "runs", title: "Runs & PayPal log" },
];

export const initialReport: AgReportState<Registry> = {
  selectedPageId: "overview",
  panels: { filters: { collapsed: true }, ai: { collapsed: false } },
  pages: [
    {
      id: "overview",
      widgets: {
        "kpi-paid": kpi("Paid to maintainers (PayPal-verified)", f("payouts.paidAmount", "sum"), "calendar::day"),
        "kpi-waiting": kpi("Waiting to be claimed", f("payouts.waitingAmount", "sum"), "calendar::day"),
        "kpi-packages": kpi("Packages funded", f("payouts.package", "countd"), "calendar::day"),
        critical: {
          type: "critical-meter",
          dataMapping: { package: [f("critical.package")], funded: [f("critical.fundedCount", "sum")] },
        },
        timeline: {
          type: "payout-timeline",
          dataMapping: {
            payout: [f("payouts.package")],
            status: [f("payouts.status")],
            verified: [f("payouts.verified")],
            sentAt: [f("payouts.sentAt")],
            settledAt: [f("payouts.settledAt")],
            amount: [f("payouts.amount", "sum")],
          },
          format: {
            ...title("Every payout, as PayPal reported it"),
            subtitle: { enabled: true, text: "Statuses change only on signature-checked PayPal webhooks. Click one to filter." },
          },
        },
        quadrant: {
          type: "risk-quadrant",
          dataMapping: {
            label: [f("payouts.package")],
            x: [f("payouts.relianceScore", "avg")],
            y: [f("payouts.fragilityScore", "avg")],
            size: [f("payouts.amount", "sum")],
          },
          format: {
            ...title("Risk vs funding"),
            subtitle: { enabled: true, text: "Bubble size = money sent" },
          },
        },
        "by-status": {
          type: "donut-chart",
          dataMapping: { categoryKey: [f("payouts.status")], valueKey: [f("payouts.amount", "sum")] },
          format: { ...title("Money sent, by PayPal status"), style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } } } },
        },
        "by-package": {
          type: "bar-chart-stacked",
          dataMapping: {
            categoryKey: [f("payouts.package")],
            valueKey: [f("payouts.amount", "sum")],
            legendKey: [f("payouts.status")],
          },
          sort: [{ field: f("payouts.amount", "sum"), direction: "desc" }],
          format: { ...title("Sent per package"), ...legend },
        },
        "claim-rate": {
          type: "radial-gauge",
          dataMapping: { value: [f("claimRate")] },
          format: {
            ...title("Claimed so far"),
            style: {
              scaleLabel: { min: 0, max: 1 },
              label: { typography: type(24, "bold") },
              secondaryLabel: { enabled: true, text: "of money sent is claimed", typography: type(12) },
            },
          },
        },
        payouts: {
          type: "grid",
          dataMapping: {
            cols: [
              f("payouts.sentAt"),
              f("payouts.package"),
              f("payouts.ecosystem"),
              f("payouts.amount", "sum"),
              f("payouts.status"),
              f("payouts.verified"),
              f("payouts.maintainer"),
              f("payouts.company"),
              f("payouts.env"),
              f("payouts.reason"),
            ],
          },
          sort: [{ field: f("payouts.sentAt"), direction: "desc" }],
          format: title("Payouts"),
        },
      },
      widgetLayout: {
        "kpi-paid": at(0, 0, 6, 9),
        "kpi-waiting": at(6, 0, 6, 9),
        "kpi-packages": at(12, 0, 5, 9),
        critical: at(17, 0, 7, 9),
        timeline: at(0, 9, 14, 24),
        quadrant: at(14, 9, 10, 24),
        "by-status": at(0, 33, 8, 18),
        "by-package": at(8, 33, 10, 18),
        "claim-rate": at(18, 33, 6, 18),
        payouts: at(0, 51, 24, 22),
      },
      // "Packages funded" counts only packages PayPal has confirmed as paid.
      filter: {
        widget: {
          "kpi-packages": [
            { field: f("payouts.status"), model: { operator: "isIn", value: ["paid"] } },
            { field: f("payouts.verified"), model: { operator: "isTrue" } },
          ],
        },
      },
    },
    {
      id: "runs",
      widgets: {
        company: {
          type: "button-filter",
          dataMapping: { value: [f("runs.company")] },
          format: { ...title("Company"), style: { dimensions: { height: 28, minWidth: 60 } } },
        },
        "kpi-runs": kpi("Runs", f("runs.id", "countd")),
        "kpi-budget": kpi("Budget", f("runs.budget", "sum")),
        "kpi-sent": kpi("Sent", f("runs.spent", "sum")),
        "kpi-events": kpi("PayPal-signed events", f("events.id", "countd")),
        "budget-vs-paid": {
          type: "column-chart-grouped",
          dataMapping: {
            categoryKey: [f("runs.id")],
            valueKey: [f("runs.budget", "sum"), f("runs.paid", "sum"), f("runs.waiting", "sum")],
          },
          format: { ...title("Budget, paid and waiting per run"), ...legend },
        },
        "events-by-type": {
          type: "donut-chart",
          dataMapping: { categoryKey: [f("events.type")], valueKey: [f("events.id", "countd")] },
          format: { ...title("PayPal webhooks received"), style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } } } },
        },
        runs: {
          type: "grid",
          dataMapping: {
            cols: [
              f("runs.date"),
              f("runs.id"),
              f("runs.company"),
              f("runs.kind"),
              f("runs.env"),
              f("runs.budget", "sum"),
              f("runs.paid", "sum"),
              f("runs.waiting", "sum"),
              f("runs.model"),
              f("runs.methodFingerprint"),
              f("runs.rulesFingerprint"),
            ],
          },
          sort: [{ field: f("runs.date"), direction: "desc" }],
          format: title("Runs (method and rules fingerprints are published so anyone can check the split)"),
        },
        events: {
          type: "grid",
          dataMapping: {
            cols: [f("events.receivedAt"), f("events.type"), f("events.status"), f("events.package"), f("events.amount", "sum"), f("events.id")],
          },
          sort: [{ field: f("events.receivedAt"), direction: "desc" }],
          format: title("PayPal webhook log (signature-checked)"),
        },
      },
      widgetLayout: {
        "kpi-runs": at(0, 0, 4, 8),
        "kpi-budget": at(4, 0, 5, 8),
        "kpi-sent": at(9, 0, 5, 8),
        "kpi-events": at(14, 0, 5, 8),
        company: at(19, 0, 5, 8),
        "budget-vs-paid": at(0, 8, 15, 18),
        "events-by-type": at(15, 8, 9, 18),
        runs: at(0, 26, 24, 16),
        events: at(0, 42, 24, 20),
      },
    },
  ],
};

/** For phones: small tiles two to a row, everything else full width, in reading order. */
export function stacked(state: AgReportState<Registry>): AgReportState<Registry> {
  return {
    ...state,
    pages: state.pages.map((page) => {
      const items = Object.entries(page.widgetLayout ?? {}).sort(([, a], [, b]) => a!.yTrack - b!.yTrack || a!.xTrack - b!.xTrack);
      const layout: Record<string, AgWidgetLayoutState> = {};
      let y = 0;
      let half = 0;
      for (const [id, l] of items) {
        if (l!.xSpan <= 7) {
          layout[id] = at(half ? 12 : 0, y, 12, l!.ySpan);
          if (half) y += l!.ySpan;
          half = half ? 0 : l!.ySpan;
        } else {
          if (half) y += half;
          half = 0;
          layout[id] = at(0, y, 24, Math.max(l!.ySpan, 18));
          y += layout[id].ySpan;
        }
      }
      // Half-width KPI cards on a phone: a smaller number so "$1,440.00" fits.
      const widgets = Object.fromEntries(
        Object.entries(page.widgets ?? {}).map(([id, w]) => {
          const style = (w as { format?: { style?: { typography?: object } } }).format?.style;
          if (w?.type !== "value" || !style?.typography) return [id, w];
          const f = (w as { format: object }).format;
          return [id, { ...w, format: { ...f, style: { ...style, typography: { ...style.typography, fontSize: 20 } } } }];
        }),
      ) as typeof page.widgets;
      return { ...page, widgets, widgetLayout: layout };
    }),
  };
}
