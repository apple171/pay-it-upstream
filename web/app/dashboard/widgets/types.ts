// Widget state types for our custom AG Studio widgets, and the registry that adds them to Studio's.
import type {
  AgBaseRegistry,
  AgBaseWidgetDefinition,
  AgDefaultWidgetDefinition,
  AgWidgetDataFormat,
  AgWidgetFieldReference,
} from "ag-studio";

type Fields = AgWidgetFieldReference[];
type Format = AgWidgetDataFormat<Record<string, never>>;

export interface TimelineDef {
  type: "payout-timeline";
  dataMapping: { payout: Fields; status: Fields; verified: Fields; sentAt: Fields; settledAt: Fields; amount: Fields };
  format?: Format;
}

export interface QuadrantDef {
  type: "risk-quadrant";
  dataMapping: { label: Fields; x: Fields; y: Fields; size: Fields };
  format?: Format;
}

export interface CriticalDef {
  type: "critical-meter";
  dataMapping: { package: Fields; funded: Fields };
  format?: Format;
}

export interface Registry extends AgBaseRegistry {
  widgets: readonly (
    | AgDefaultWidgetDefinition
    | AgBaseWidgetDefinition<"payout-timeline", TimelineDef>
    | AgBaseWidgetDefinition<"risk-quadrant", QuadrantDef>
    | AgBaseWidgetDefinition<"critical-meter", CriticalDef>
  )[];
}

/** paid / waiting / pending / bad, for colouring a status. */
export function tone(status: unknown): "ok" | "wait" | "pending" | "bad" {
  const s = String(status ?? "");
  if (s === "paid") return "ok";
  if (s.startsWith("waiting") || s === "on hold") return "wait";
  if (s === "sent" || s === "processing" || s === "") return "pending";
  return "bad";
}
