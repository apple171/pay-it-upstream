// Every status on the site comes from a PayPal webhook whose signature checks out.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { crc32, verifyPayPalWebhook } from "../web/lib/paypal-webhook.ts";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const CERT_URL = "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-TEST";
const WEBHOOK_ID = "WH-TEST";

function signed(body: string, opts: { certUrl?: string; webhookId?: string } = {}) {
  const h: Record<string, string> = {
    "paypal-transmission-id": "tx-1",
    "paypal-transmission-time": "2026-11-12T00:00:00Z",
    "paypal-cert-url": opts.certUrl ?? CERT_URL,
    "paypal-auth-algo": "SHA256withRSA",
  };
  const msg = `tx-1|${h["paypal-transmission-time"]}|${opts.webhookId ?? WEBHOOK_ID}|${crc32(Buffer.from(body))}`;
  h["paypal-transmission-sig"] = crypto.sign("sha256", Buffer.from(msg), privateKey).toString("base64");
  return (name: string) => h[name];
}

// PayPal's certificate endpoint, served locally: the test key stands in for PayPal's.
globalThis.fetch = (async (url: string) => {
  if (String(url) === CERT_URL) return new Response(publicKey.export({ type: "spki", format: "pem" }) as string);
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("a correctly signed event is accepted", async () => {
  const body = '{"event_type":"PAYMENT.PAYOUTS-ITEM.SUCCEEDED"}';
  assert.deepEqual(await verifyPayPalWebhook(Buffer.from(body), signed(body), WEBHOOK_ID), { ok: true });
});

test("a changed body is refused", async () => {
  const body = '{"event_type":"PAYMENT.PAYOUTS-ITEM.SUCCEEDED"}';
  const r = await verifyPayPalWebhook(Buffer.from(body.replace("SUCCEEDED", "UNCLAIMED")), signed(body), WEBHOOK_ID);
  assert.equal(r.ok, false);
});

test("an event signed for another webhook is refused", async () => {
  const body = "{}";
  assert.equal((await verifyPayPalWebhook(Buffer.from(body), signed(body, { webhookId: "WH-OTHER" }), WEBHOOK_ID)).ok, false);
});

test("certificates from outside paypal.com are never fetched", async () => {
  const body = "{}";
  const r = await verifyPayPalWebhook(Buffer.from(body), signed(body, { certUrl: "https://paypal.com.evil.example/cert" }), WEBHOOK_ID);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /not on paypal\.com/);
});

test("missing signature headers are refused", async () => {
  assert.equal((await verifyPayPalWebhook(Buffer.from("{}"), () => undefined, WEBHOOK_ID)).ok, false);
});
