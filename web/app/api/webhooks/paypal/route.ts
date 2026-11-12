// PayPal sends payout events here. Only signature-checked events change the ledger.
import { verifyPayPalWebhook } from "@/lib/paypal-webhook";
import { updateLedger } from "@/lib/store";
import { applyVerifiedEvent } from "@/lib/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return Response.json({ error: "PAYPAL_WEBHOOK_ID not set" }, { status: 503 });

  const raw = new Uint8Array(await req.arrayBuffer());
  const check = await verifyPayPalWebhook(raw, (n) => req.headers.get(n), webhookId);
  if (!check.ok) {
    await updateLedger((l) => {
      l.rejected.push({ at: new Date().toISOString(), reason: check.reason ?? "invalid" });
      l.rejected = l.rejected.slice(-200);
    });
    return Response.json({ error: "signature check failed", reason: check.reason }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }
  const fresh = await updateLedger((l) => applyVerifiedEvent(l, event));
  return Response.json({ ok: true, duplicate: !fresh });
}
