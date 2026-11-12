// GET: the decision (polled by the CLI and MCP server). POST: a person approves or rejects with the passphrase.
import { readLedger, updateLedger } from "@/lib/store";
import { MAX_FAILED, passphraseMatches, publicState } from "@/lib/approvals";
import { EMAIL } from "@/lib/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(_req: Request, { params }: Ctx) {
  const a = (await readLedger()).approvals[(await params).id];
  return a ? json(publicState(a)) : json({ error: "no such plan" }, 404);
}

export async function POST(req: Request, { params }: Ctx) {
  const id = (await params).id;
  let body: { decision?: string; passphrase?: string; name?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  const decision = body.decision === "approve" ? "approved" : body.decision === "reject" ? "rejected" : undefined;
  const name = (body.name ?? "").trim().slice(0, 60);
  const note = (body.note ?? "").trim().slice(0, 300) || undefined;
  if (!decision) return json({ error: "Choose approve or reject." }, 400);
  if (!name) return json({ error: "Add your name, so the audit trail says who decided." }, 400);
  if (EMAIL.test(name) || (note && EMAIL.test(note))) return json({ error: "Please don't put an email address here: it's shown publicly." }, 400);

  const current = (await readLedger()).approvals[id];
  if (!current) return json({ error: "No such plan." }, 404);
  if (current.state !== "waiting") return json({ error: `Already ${current.state}.`, ...publicState(current) }, 409);
  if (current.failedAttempts >= MAX_FAILED) return json({ error: "Too many wrong passphrases. Propose the plan again from the CLI." }, 423);
  const ok = await passphraseMatches(String(body.passphrase ?? ""), current.approver);

  const result = await updateLedger((l) => {
    const a = l.approvals[id];
    if (!a || a.state !== "waiting") return { status: 409, a };
    if (!ok) {
      a.failedAttempts++;
      return { status: 403, a };
    }
    Object.assign(a, { state: decision, by: name, note, decidedAt: new Date().toISOString() });
    return { status: 200, a };
  });
  if (!result.a) return json({ error: "No such plan." }, 404);
  if (result.status === 403) return json({ error: "That passphrase isn't right.", ...publicState(result.a) }, 403);
  return json(publicState(result.a), result.status);
}
