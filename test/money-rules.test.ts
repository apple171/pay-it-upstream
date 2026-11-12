// The AI proposes weights; plain code decides the dollars. These are the rules it must never break.
import { test } from "node:test";
import assert from "node:assert/strict";
import { enforcePlan } from "../src/plan.ts";
import type { AgentPlan } from "../src/agent/agent.ts";
import type { PackageSignals } from "../src/types.ts";

const pkg = (name: string, extra: Partial<PackageSignals> = {}): PackageSignals => ({
  name, ecosystem: "npm", version: "1.0.0", direct: true, dependedOnBy: 1,
  maintainers: [{ name, email: `${name}@example.org`, source: "npm-maintainers" }],
  advisories: [], funding: [], errors: [], ...extra,
});
const plan = (picks: [string, number][], limits: AgentPlan["limits"] = {}): AgentPlan => ({
  limits, picks: picks.map(([p, weight]) => ({ package: p, weight, reason: "test" })), skipped: [], summary: "", steps: [], model: "test",
});
const cands = ["a", "b", "c", "d", "e"].map((n) => pkg(n));
const total = (r: ReturnType<typeof enforcePlan>) => r.allocations.reduce((s, x) => s + x.amountCents, 0);

test("never spends more than the budget, in whole dollars", () => {
  const r = enforcePlan(plan([["a", 33], ["b", 33], ["c", 34], ["d", 7], ["e", 1]]), cands, 10_000);
  assert.ok(total(r) <= 10_000);
  for (const a of r.allocations) assert.equal(a.amountCents % 100, 0);
  assert.equal(r.unspentCents, 10_000 - total(r));
});

test("no package gets more than 30% of the budget; the rest stays unspent", () => {
  const r = enforcePlan(plan([["a", 100], ["b", 1], ["c", 1]]), cands, 10_000);
  for (const a of r.allocations) assert.ok(a.amountCents <= 3_000, `${a.package} got ${a.amountCents}`);
  assert.ok(r.unspentCents > 0);
});

test("payouts under $5 are dropped", () => {
  const r = enforcePlan(plan([["a", 100], ["b", 100], ["c", 100], ["d", 1]]), cands, 5_000);
  for (const a of r.allocations) assert.ok(a.amountCents >= 500);
  assert.ok(r.rejected.some((x) => x.package === "d" && /minimum/.test(x.why)));
});

test("only packages with a published email can be paid, and the payee comes from the registry", () => {
  const noEmail = pkg("f", { maintainers: [{ name: "f", source: "npm-maintainers" }] });
  const r = enforcePlan(plan([["a", 50], ["f", 50]]), [...cands, noEmail], 5_000);
  assert.deepEqual(r.allocations.map((a) => a.package), ["a"]);
  assert.equal(r.allocations[0].payee.email, "a@example.org");
  assert.ok(r.rejected.some((x) => x.package === "f"));
});

test("the agent can't pay packages outside the project, or the same one twice", () => {
  const r = enforcePlan(plan([["a", 50], ["a", 50], ["not-here", 50]]), cands, 5_000);
  assert.equal(r.allocations.length, 1);
  assert.equal(r.rejected.length, 2);
});

test("rules can tighten the limits but never loosen them", () => {
  const loose = enforcePlan(plan([["a", 100], ["b", 1]], { maxPerPackageCents: 1_000_000, minPayoutCents: 1, maxPackages: 50 }), cands, 10_000);
  assert.equal(loose.limits.maxPerPackageCents, 3_000);
  assert.equal(loose.limits.minPayoutCents, 500);
  assert.equal(loose.limits.maxPackages, 10);
  const tight = enforcePlan(plan([["a", 50], ["b", 50]], { maxPerPackageCents: 1_000, exclude: ["b"] }), cands, 10_000);
  assert.deepEqual(tight.allocations.map((a) => [a.package, a.amountCents]), [["a", 1_000]]);
});
