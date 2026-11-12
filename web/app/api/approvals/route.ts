// The CLI or MCP server puts an agent's plan here to wait for a person's approval.
import { updateLedger, type Proposal } from "@/lib/store";
import { applyProposal, checkProposal, publicState } from "@/lib/approvals";
import { authorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: { proposal: Proposal; approver: { salt: string; hash: string } };
  try {
    body = await req.json();
    checkProposal(body.proposal, body.approver);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  const a = await updateLedger((l) => applyProposal(l, body.proposal, { salt: body.approver.salt, hash: body.approver.hash }));
  return Response.json({ ok: true, url: `/approve/${a.proposal.id}`, ...publicState(a) });
}
