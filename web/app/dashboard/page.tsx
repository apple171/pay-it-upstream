import type { Metadata } from "next";
import { connection } from "next/server";
import { aiEnabled, claudeModel } from "@/lib/claude";
import { DashboardClient } from "./client";
import "./dashboard.css";

export const metadata: Metadata = {
  title: "Pay It Upstream: dashboard",
  description: "Explore every PayPal-verified payout to open-source maintainers, and ask the ledger questions.",
};

export default async function DashboardPage() {
  // Read env per request, not at build time.
  await connection();
  // Only the model id reaches the browser; the API key stays on the server (lib/claude.ts).
  return (
    <main className="piu-main">
      <DashboardClient
        licenseKey={process.env.AG_STUDIO_LICENSE || process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE || undefined}
        aiModels={aiEnabled() ? [claudeModel()] : undefined}
      />
    </main>
  );
}
