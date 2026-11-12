// The CLI publishes each run here (amounts, reasons, masked maintainers).
import { updateLedger, type PublishedRun } from "@/lib/store";
import { applyPublished, checkPublished } from "@/lib/ledger";
import { authorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let run: PublishedRun;
  try {
    run = await req.json();
    checkPublished(run);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  await updateLedger((l) => applyPublished(l, run));
  return Response.json({ ok: true, url: `/runs/${run.id}` });
}
