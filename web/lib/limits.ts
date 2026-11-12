// Caps on AI calls, so a public demo can't run up the bill.
import { getD1 } from "./store";

const num = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);
const limits = () => ({
  perIpPerDay: num(process.env.AI_IP_DAILY_LIMIT, 16),
  perDay: num(process.env.AI_DAILY_LIMIT, 60),
  total: num(process.env.AI_TOTAL_LIMIT, 400),
});

const memory = new Map<string, number>();

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}

/** Counts one call and returns null, or returns why it is refused. */
export async function takeAiCall(ip: string): Promise<string | null> {
  const day = new Date().toISOString().slice(0, 10);
  const lim = limits();
  const keys: [string, string, number, string][] = [
    [day, ip, lim.perIpPerDay, "You've reached today's limit for AI questions. Try again tomorrow."],
    [day, "*", lim.perDay, "The demo's AI is at today's limit. Try again tomorrow."],
    ["all", "*", lim.total, "The demo's AI budget is used up."],
  ];
  const db = await getD1();
  for (const [d, who, max, msg] of keys) {
    const used = db
      ? ((await db.prepare("SELECT calls FROM ai_usage WHERE day = ? AND ip = ?").bind(d, who).first<{ calls: number }>())?.calls ?? 0)
      : (memory.get(`${d}|${who}`) ?? 0);
    if (used >= max) return msg;
  }
  for (const [d, who] of keys) {
    if (db) {
      await db
        .prepare("INSERT INTO ai_usage (day, ip, calls) VALUES (?, ?, 1) ON CONFLICT (day, ip) DO UPDATE SET calls = calls + 1")
        .bind(d, who)
        .run();
    } else memory.set(`${d}|${who}`, (memory.get(`${d}|${who}`) ?? 0) + 1);
  }
  return null;
}
