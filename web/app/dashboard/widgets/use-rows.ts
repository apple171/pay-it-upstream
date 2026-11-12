// Loads a custom widget's rows and keeps Studio's overlays (loading, no data, missing fields) in step.
import { useEffect, useRef, useState } from "react";
import type { AgWidgetApi, AgWidgetDataQuery } from "ag-studio";

export function useRows(widgetApi: AgWidgetApi, query: AgWidgetDataQuery | null, refresh: unknown) {
  const [rows, setRows] = useState<Record<string, unknown>[]>();
  const loaded = useRef(false);
  const key = JSON.stringify(query);
  useEffect(() => {
    if (!query) {
      widgetApi.setDisplayState("incompleteDataMapping");
      setRows(undefined);
      return;
    }
    let live = true;
    widgetApi.setDisplayState("loading", { prominent: !loaded.current });
    widgetApi.getData(query, { queryId: "rows" }).then((res) => {
      if (!live) return;
      const r = res.results.rows;
      loaded.current = r.length > 0;
      setRows(r);
      widgetApi.setDisplayState(r.length ? "displayed" : "noData");
    });
    return () => {
      live = false;
    };
    // `refresh` is the widget's dataMapping: Studio passes a new one when filters change.
  }, [key, refresh, widgetApi]);
  return rows;
}
