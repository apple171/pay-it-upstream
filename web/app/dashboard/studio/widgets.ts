// Registers our three custom widgets with Studio, in their own group at the top of the widget menu.
import type { AgDataMappingDefinition, AgFieldRole, AgWidgetsConfig } from "ag-studio";
import { createWidgets } from "ag-studio-react";
import CriticalMeter from "../widgets/critical-meter";
import PayoutTimeline from "../widgets/payout-timeline";
import RiskQuadrant from "../widgets/risk-quadrant";
import type { Registry } from "../widgets/types";

const icon = (path: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${path}</svg>`;

function field<K extends string>(roles: AgFieldRole[], required: boolean, per?: K): AgDataMappingDefinition<K> {
  return {
    type: "field",
    supportedRoles: roles,
    required,
    requires: per ? { cardinality: "one", per: `dataMapping.${per}` } : { cardinality: "many" },
  };
}

export const widgets = (defaults: AgWidgetsConfig): AgWidgetsConfig<Registry> =>
  createWidgets<Registry>({
    additionalTypes: [
      {
        id: "payout-timeline",
        label: "PayPal payout timeline",
        icon: icon('<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h3M14 12h3"/>'),
        dataMapping: {
          payout: field(["category"], true),
          status: field(["category"], true, "payout"),
          verified: field(["category"], false, "payout"),
          sentAt: field(["temporal"], false),
          settledAt: field(["temporal"], false),
          amount: field(["numeric"], false, "payout"),
        },
        form: (p) =>
          p.createDefaults({
            dataMappingItems: [
              { key: "payout", label: "Payout" },
              { key: "status", label: "Status" },
              { key: "verified", label: "PayPal-signed" },
              { key: "sentAt", label: "Sent" },
              { key: "settledAt", label: "Confirmed" },
              { key: "amount", label: "Amount" },
            ],
          }),
        comp: PayoutTimeline,
        defaultSize: { width: 560, height: 360 },
        minSize: { width: 280, height: 160 },
      },
      {
        id: "risk-quadrant",
        label: "Risk vs funding quadrant",
        icon: icon('<path d="M4 4v16h16"/><circle cx="15" cy="9" r="3"/><circle cx="9" cy="15" r="1.5"/>'),
        dataMapping: {
          label: field(["category"], true),
          x: field(["numeric"], true, "label"),
          y: field(["numeric"], true, "label"),
          size: field(["numeric"], false, "label"),
        },
        form: (p) =>
          p.createDefaults({
            dataMappingItems: [
              { key: "label", label: "Package" },
              { key: "x", label: "Across (x)" },
              { key: "y", label: "Up (y)" },
              { key: "size", label: "Bubble size" },
            ],
          }),
        comp: RiskQuadrant,
        defaultSize: { width: 420, height: 360 },
        minSize: { width: 240, height: 200 },
      },
      {
        id: "critical-meter",
        label: "Critical packages meter",
        icon: icon('<path d="M4 17h16"/><path d="M4 17h9" stroke-width="4"/><path d="M12 4l2 4h-4z"/>'),
        dataMapping: {
          package: field(["category"], true),
          funded: field(["numeric"], true, "package"),
        },
        form: (p) =>
          p.createDefaults({
            dataMappingItems: [
              { key: "package", label: "Package" },
              { key: "funded", label: "Funded (0/1)" },
            ],
          }),
        comp: CriticalMeter,
        defaultSize: { width: 300, height: 160 },
        minSize: { width: 200, height: 110 },
      },
    ],
    menu: [{ label: "Pay It Upstream", widgetIds: ["payout-timeline", "risk-quadrant", "critical-meter"] }, ...defaults.menu],
  });
