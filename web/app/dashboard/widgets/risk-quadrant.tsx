// Custom widget: risk vs funding quadrant. x = how much the company relies on a package,
// y = how fragile it is, bubble size = money sent. Top right is load-bearing and fragile.
// Clicking a bubble cross-filters the page to that package.
import type { MouseEvent } from "react";
import type { AgWidgetParams } from "ag-studio";
import type { QuadrantDef } from "./types";
import { useRows } from "./use-rows";

const W = 420;
const H = 300;
const PAD = { l: 34, r: 14, t: 26, b: 34 };

export default function RiskQuadrant({ widgetApi, dataMapping }: AgWidgetParams<QuadrantDef>) {
  const [label, x, y, size] = [dataMapping.label?.[0], dataMapping.x?.[0], dataMapping.y?.[0], dataMapping.size?.[0]];
  const all = useRows(widgetApi, label && x && y ? { fields: [label, x, y, ...(size ? [size] : [])] } : null, dataMapping);
  if (!all?.length || !label || !x || !y) return null;
  const rows = all.filter((r) => r[x.key] != null && r[y.key] != null);

  const xs = rows.map((r) => Number(r[x.key]));
  const ys = rows.map((r) => Number(r[y.key]));
  // Levels are scored 1-3; keep that scale fixed so the quadrants mean the same thing every time.
  const dom = (v: number[]) => [Math.min(0.5, ...v.map((n) => n - 0.5)), Math.max(3.5, ...v.map((n) => n + 0.5))];
  const [x0, x1] = dom(xs);
  const [y0, y1] = dom(ys);
  const px = (v: number) => PAD.l + ((v - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const py = (v: number) => H - PAD.b - ((v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const maxSize = Math.max(1, ...rows.map((r) => Number(size ? r[size.key] : 1) || 0));
  const midX = px((x0 + x1) / 2);
  const midY = py((y0 + y1) / 2);

  // Packages at the same spot are packed around it, biggest in the middle; only that one is labelled.
  const amount = (r: Record<string, unknown>) => Number(size ? r[size.key] : 1) || 0;
  const spot = (r: Record<string, unknown>) => `${r[x.key]}|${r[y.key]}`;
  const groups = new Map<string, number>();
  for (const r of rows) groups.set(spot(r), (groups.get(spot(r)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const points = [...rows]
    .sort((a, b) => amount(b) - amount(a))
    .map((r) => {
      const n = seen.get(spot(r)) ?? 0;
      seen.set(spot(r), n + 1);
      const spread = 9 * Math.sqrt(n);
      const others = (groups.get(spot(r)) ?? 1) - 1;
      return {
        row: r,
        cx: px(Number(r[x.key])) + spread * Math.cos(n * 2.4),
        cy: py(Number(r[y.key])) + spread * Math.sin(n * 2.4),
        r: 4 + 10 * Math.sqrt(amount(r) / maxSize),
        label: n === 0 ? `${r[label.key]}${others ? ` +${others}` : ""}` : "",
      };
    })
    .reverse();
  // Drop labels that would overlap one already placed (bigger bubbles are placed first).
  const placed: { x: number; y: number; w: number }[] = [];
  for (const p of [...points].reverse()) {
    if (!p.label) continue;
    const box = { x: p.cx, y: p.cy - p.r - 12, w: p.label.length * 6 + 6 };
    if (placed.some((b) => Math.abs(b.x - box.x) < (b.w + box.w) / 2 && Math.abs(b.y - box.y) < 12)) p.label = "";
    else placed.push(box);
  }

  const selected = new Set(
    widgetApi.getCrossFilterSelections()?.flatMap((s) => (s.type === "value" ? s.values : [])) ?? [],
  );
  const pick = (e: MouseEvent, value: unknown) => {
    e.stopPropagation();
    widgetApi.toggleCrossFilter({ type: "value", field: label, value, group: 0, reset: !(e.metaKey || e.ctrlKey) });
  };

  return (
    <svg className="piu-quadrant" viewBox={`0 0 ${W} ${H}`} role="img" onClick={() => widgetApi.resetCrossFilter()}>
      <rect className="hot" x={midX} y={PAD.t} width={W - PAD.r - midX} height={midY - PAD.t} />
      <rect className="frame" x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} />
      <line x1={midX} x2={midX} y1={PAD.t} y2={H - PAD.b} />
      <line x1={PAD.l} x2={W - PAD.r} y1={midY} y2={midY} />
      {/* Above the plot, so it never sits on top of a bubble label. */}
      <text className="corner" x={W - PAD.r} y={PAD.t - 9} textAnchor="end">
        load-bearing &amp; fragile
      </text>
      <text className="axis" x={(PAD.l + W - PAD.r) / 2} y={H - 10} textAnchor="middle">
        {widgetApi.getFieldName(x)} →
      </text>
      <text className="axis" transform={`translate(12 ${(PAD.t + H - PAD.b) / 2}) rotate(-90)`} textAnchor="middle">
        {widgetApi.getFieldName(y)} →
      </text>
      {points.map(({ row, cx, cy, r, label: text }, i) => {
        const name = row[label.key];
        const dim = selected.size > 0 && !selected.has(name);
        return (
          <g key={i} className={`bubble${dim ? " dim" : ""}`} onClick={(e) => pick(e, name)}>
            <title>
              {`${name}\n${widgetApi.getFieldName(x)}: ${widgetApi.formatFieldValue(x, row[x.key])}\n` +
                `${widgetApi.getFieldName(y)}: ${widgetApi.formatFieldValue(y, row[y.key])}` +
                (size ? `\n${widgetApi.getFieldName(size)}: ${widgetApi.formatFieldValue(size, row[size.key])}` : "")}
            </title>
            <circle cx={cx} cy={cy} r={r} />
            {text && (
              <text x={cx} y={cy - r - 12} textAnchor="middle">
                {text}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
