"use client";
// AG Studio needs the browser, so the dashboard is loaded on the client only.
import dynamic from "next/dynamic";

const Dashboard = dynamic(() => import("./dashboard"), {
  ssr: false,
  loading: () => <p className="piu-note">Loading the dashboard…</p>,
});

export function DashboardClient(props: { licenseKey?: string; aiModels?: string[] }) {
  return <Dashboard {...props} />;
}
