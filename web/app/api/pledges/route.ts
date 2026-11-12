// The CLI publishes each pledge here when it is held, shipped or withdrawn (masked maintainer only).
import { updateLedger, type PublishedPledge } from "@/lib/store";
import { applyPledge, checkPledge } from "@/lib/ledger";
import { authorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let pledge: PublishedPledge;
  try {
    pledge = await req.json();
    checkPledge(pledge);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  await updateLedger((l) => applyPledge(l, pledge));
  return Response.json({ ok: true, url: `/pledges?focus=${pledge.id}` });
}
