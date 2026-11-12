// Dashboard tables (payouts, runs, critical packages, PayPal events) for AG Studio.
import { readLedger } from "@/lib/store";
import { dashboardData } from "@/lib/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(dashboardData(await readLedger()), { headers: { "Cache-Control": "no-store" } });
}
