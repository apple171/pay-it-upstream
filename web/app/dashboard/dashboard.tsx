"use client";
// The AG Studio dashboard. Loads the ledger tables from /api/dashboard, then renders one Studio
// instance with our theme, custom widgets, starting report and (when enabled) the Claude AI team.
// Studio leaves page navigation to the host, so the page tabs and edit toggle live here.
import { useEffect, useMemo, useRef, useState } from "react";
import { AgStudioAiModule, enableStudioDevValidations, type AgStudioMode } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import type { DashboardData } from "@/lib/dashboard";
import { buildAi } from "./studio/ai";
import { buildStudioData, hasData } from "./studio/data";
import { PAGES, initialReport, stacked } from "./studio/report";
import { phoneTheme, theme } from "./studio/theme";
import { aiToolDisplay } from "./studio/tool-display";
import { widgets } from "./studio/widgets";
import type { Registry } from "./widgets/types";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

const PHONE = "(max-width: 720px)";

export default function DashboardLoader({ licenseKey, aiModels }: { licenseKey?: string; aiModels?: string[] }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/dashboard", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="piu-note">Couldn&apos;t load the ledger. Try reloading.</p>;
  if (!data) return <p className="piu-note">Loading the ledger…</p>;
  if (!hasData(data)) return <p className="piu-note">No payments yet. The dashboard fills in once a run is published.</p>;
  return <Dashboard data={data} licenseKey={licenseKey} aiModels={aiModels} />;
}

function Dashboard({ data, licenseKey, aiModels }: { data: DashboardData; licenseKey?: string; aiModels?: string[] }) {
  const studio = useRef<AgStudio<Registry>>(null);
  const [phone] = useState(() => window.matchMedia(PHONE).matches);
  const [start] = useState(() => (phone ? stacked(initialReport) : initialReport));
  const [page, setPage] = useState(start.selectedPageId);
  const [mode, setMode] = useState<AgStudioMode>("view");
  const studioData = useMemo(() => buildStudioData(data), [data]);
  // Charts are drawn on canvas with the colours of the moment; redraw when the theme flips.
  const [themeKey, setThemeKey] = useState(0);
  useEffect(() => {
    const bump = () => setThemeKey((k) => k + 1);
    window.addEventListener("piu-theme", bump);
    return () => window.removeEventListener("piu-theme", bump);
  }, []);
  const ai = useMemo(() => (aiModels?.length ? buildAi(aiModels, data) : undefined), [aiModels, data]);

  const go = (id: string) => {
    const api = studio.current?.api;
    if (api) api.setState({ ...api.getState(), selectedPageId: id });
  };
  const reset = () => {
    const api = studio.current?.api;
    api?.setState({ ...start, selectedPageId: page });
    api?.clearHistory();
  };

  return (
    <div className="piu-dash">
      <div className="piu-bar-top">
        <div className="piu-title">
          <h1>Dashboard</h1>
          <div className="piu-tabs" role="tablist">
            {PAGES.map((p) => (
              <button key={p.id} role="tab" aria-selected={page === p.id} onClick={() => go(p.id)}>
                {p.title}
              </button>
            ))}
          </div>
        </div>
        <div className="piu-actions">
          {mode === "edit" && <button onClick={reset}>Reset layout</button>}
          <button className="primary" onClick={() => setMode(mode === "edit" ? "view" : "edit")}>
            {mode === "edit" ? "Done" : ai ? "Edit · Ask AI" : "Edit layout"}
          </button>
        </div>
      </div>
      <div className="piu-studio">
        <AgStudioProvider licenseKey={licenseKey} modules={ai ? [AgStudioAiModule] : undefined}>
          <AgStudio<Registry>
            key={themeKey}
            ref={studio}
            style={{ height: "100%", width: "100%" }}
            theme={phone ? phoneTheme : theme}
            layout={{ widgetBorderEnabled: true, ...(phone && { minWidth: 320 }) }}
            // On a phone the filters panel would take a third of the screen.
            panels={phone ? { view: { left: [], right: [] } } : undefined}
            data={studioData}
            widgets={widgets}
            initialState={start}
            mode={mode}
            ai={ai}
            aiToolDisplay={aiToolDisplay}
            onStateUpdated={(e) => setPage(e.state.selectedPageId)}
          />
        </AgStudioProvider>
      </div>
      <p className="piu-foot">
        <span className="live">live</span>
        <span>Data as of {new Date(data.asOf).toLocaleString()}</span>
        <span>{data.events.length} PayPal-signed webhooks · {data.rejectedWebhooks} refused</span>
        <span>Sandbox runs are demo payments to test accounts.</span>
      </p>
    </div>
  );
}
