// Custom widget: "critical one-maintainer packages funded X/Y", with a progress bar and a chip per package.
import type { AgWidgetParams } from "ag-studio";
import type { CriticalDef } from "./types";
import { useRows } from "./use-rows";

export default function CriticalMeter({ widgetApi, dataMapping }: AgWidgetParams<CriticalDef>) {
  const [pkg, funded] = [dataMapping.package?.[0], dataMapping.funded?.[0]];
  const query = pkg && funded ? { fields: [pkg, funded], sort: [{ field: pkg, direction: "asc" as const }] } : null;
  const rows = useRows(widgetApi, query, dataMapping);
  if (!rows?.length || !pkg || !funded) return null;

  const done = rows.filter((r) => Number(r[funded.key]) > 0);
  const pct = Math.round((100 * done.length) / rows.length);
  return (
    <div className="piu-meter">
      <div className="piu-meter-t">Critical packages funded</div>
      <div className="piu-meter-n">
        {done.length}
        <span>/{rows.length}</span>
      </div>
      <div className="piu-meter-l">one-maintainer packages others rely on</div>
      <div className="piu-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="piu-chips">
        {/* Funded first; the card shows as many as fit. */}
        {[...done, ...rows.filter((r) => !(Number(r[funded.key]) > 0))].map((r, i) => {
          const ok = Number(r[funded.key]) > 0;
          return (
            <span key={i} className={ok ? "ok" : ""} title={ok ? "funded" : "not funded yet"}>
              {ok ? "✓ " : ""}
              {String(r[pkg.key])}
            </span>
          );
        })}
      </div>
    </div>
  );
}
