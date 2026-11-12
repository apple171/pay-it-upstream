// Custom widget: each payout's PayPal journey (sent → PayPal-signed webhook → paid or waiting),
// newest first. Clicking a payout cross-filters the page to that package.
import type { MouseEvent } from "react";
import type { AgWidgetParams } from "ag-studio";
import { tone, type TimelineDef } from "./types";
import { useRows } from "./use-rows";

const MAX_ROWS = 7;

export default function PayoutTimeline({ widgetApi, dataMapping }: AgWidgetParams<TimelineDef>) {
  const [payout, status, verified, sentAt, settledAt, amount] = [
    dataMapping.payout?.[0],
    dataMapping.status?.[0],
    dataMapping.verified?.[0],
    dataMapping.sentAt?.[0],
    dataMapping.settledAt?.[0],
    dataMapping.amount?.[0],
  ];
  const extra = [verified, sentAt, settledAt, amount].filter((f) => f != null);
  const query =
    payout && status
      ? { fields: [payout, status, ...extra], sort: sentAt ? [{ field: sentAt, direction: "desc" as const }] : undefined }
      : null;
  const rows = useRows(widgetApi, query, dataMapping);
  if (!rows?.length || !payout || !status) return null;

  const selected = new Set(
    widgetApi.getCrossFilterSelections()?.flatMap((s) => (s.type === "value" ? s.values : [])) ?? [],
  );
  const fmt = (f: typeof payout | undefined, row: Record<string, unknown>) =>
    f && row[f.key] != null ? widgetApi.formatFieldValue(f, row[f.key]) : "";
  const pick = (e: MouseEvent, value: unknown) => {
    e.stopPropagation();
    widgetApi.toggleCrossFilter({ type: "value", field: payout, value, group: 0, reset: !(e.metaKey || e.ctrlKey) });
  };

  // Newest first, only as many as fit: the full list is in the Payouts table, so no inner scroll bar.
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <div className="piu-timeline" onClick={() => widgetApi.resetCrossFilter()}>
      {shown.map((row, i) => {
        const name = row[payout.key];
        const st = String(row[status.key] ?? "");
        const signed = verified ? row[verified.key] === true || row[verified.key] === "true" : false;
        const t = tone(st);
        return (
          <button
            key={i}
            className={`piu-trow${selected.size && !selected.has(name) ? " dim" : ""}`}
            onClick={(e) => pick(e, name)}
          >
            <span className="piu-tname">
              {String(name)}
              {amount && <b>{fmt(amount, row)}</b>}
            </span>
            <span className="piu-track">
              <span className="piu-step done" title={fmt(sentAt, row)}>
                <i />
                sent
              </span>
              <span className={`piu-line${signed ? " done" : ""}`} />
              <span className={`piu-step ${signed ? "done" : ""}`} title={fmt(settledAt, row)}>
                <i />
                PayPal webhook
              </span>
              <span className={`piu-line${signed ? ` ${t}` : ""}`} />
              <span className={`piu-step ${signed ? t : ""}`}>
                <i />
                {st || "sent"}
              </span>
            </span>
            <span className={`piu-badge ${signed ? "ok" : ""}`}>{signed ? "✓ PayPal-signed" : "awaiting PayPal"}</span>
          </button>
        );
      })}
      {rows.length > shown.length && <div className="piu-more">+{rows.length - shown.length} more in the Payouts table below</div>}
    </div>
  );
}
