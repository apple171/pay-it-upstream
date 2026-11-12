// Bearer-token check for the CLI's publish calls.
import crypto from "node:crypto";

export function authorized(req: Request): boolean {
  const token = process.env.LEDGER_PUBLISH_TOKEN;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || !given) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
