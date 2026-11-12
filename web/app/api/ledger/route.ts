// Public ledger data (totals, recent payments, critical packages).
import { readLedger } from "@/lib/store";
import { view } from "@/lib/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(view(await readLedger()), { headers: { "Cache-Control": "no-store" } });
}
