// Search for the ⌘K palette: packages, runs, pledges and pages.
import { readLedger } from "@/lib/store";
import { search } from "@/lib/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
  return Response.json({ hits: search(await readLedger(), q) }, { headers: { "Cache-Control": "no-store" } });
}
