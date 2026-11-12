// A person approves on the site; the CLI and the site must agree on the passphrase hash,
// and the payout code must refuse anything without an approval on record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { approverHash } from "../src/approval.ts";
import { passphraseMatches } from "../web/lib/passphrase.ts";
import { sendRunPayouts } from "../src/payout-run.ts";
import type { RunRecord } from "../src/runs.ts";

test("the site accepts the passphrase the CLI hashed, and nothing else", async () => {
  const h = approverHash("correct horse battery");
  assert.equal(await passphraseMatches("correct horse battery", h), true);
  assert.equal(await passphraseMatches("correct horse batterY", h), false);
  assert.equal(await passphraseMatches("", h), false);
});

test("the same passphrase gives a different hash per salt", () => {
  assert.notEqual(approverHash("same pass").hash, approverHash("same pass").hash);
});

test("an unapproved plan is never paid", async () => {
  process.env.PAYPAL_CLIENT_ID = "test";
  process.env.PAYPAL_CLIENT_SECRET = "test";
  const fetchBefore = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; throw new Error("no network in tests"); }) as typeof fetch;
  try {
    const run = { id: "t", project: ".", allocations: [{ package: "a", amountCents: 500, payee: { email: "a@example.org" } }] } as unknown as RunRecord;
    await assert.rejects(sendRunPayouts(run), /approved/);
    assert.equal(called, false, "PayPal must not be called");
  } finally {
    globalThis.fetch = fetchBefore;
  }
});
