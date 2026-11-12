// Offline check of PayPal webhook signatures, using PayPal's public certificate.
// PayPal signs "transmissionId|transmissionTime|webhookId|crc32(rawBody)" with SHA256withRSA.
import crypto from "node:crypto";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const certCache = new Map<string, string>();

/** Only certificates served over HTTPS from paypal.com are trusted. */
export async function fetchPayPalCert(url: string): Promise<string> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !(u.hostname === "paypal.com" || u.hostname.endsWith(".paypal.com"))) {
    throw new Error(`certificate URL is not on paypal.com: ${u.hostname}`);
  }
  let cert = certCache.get(url);
  if (!cert) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`certificate download failed: ${res.status}`);
    cert = await res.text();
    certCache.set(url, cert);
  }
  return cert;
}

export type HeaderGetter = (name: string) => string | null | undefined;

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

export async function verifyPayPalWebhook(rawBody: Uint8Array, header: HeaderGetter, webhookId: string): Promise<VerifyResult> {
  const id = header("paypal-transmission-id");
  const time = header("paypal-transmission-time");
  const sig = header("paypal-transmission-sig");
  const certUrl = header("paypal-cert-url");
  const algo = header("paypal-auth-algo");
  if (!id || !time || !sig || !certUrl) return { ok: false, reason: "missing PayPal signature headers" };
  if (algo && algo !== "SHA256withRSA") return { ok: false, reason: `unexpected algorithm ${algo}` };
  try {
    const cert = await fetchPayPalCert(certUrl);
    const message = `${id}|${time}|${webhookId}|${crc32(rawBody)}`;
    const ok = crypto.verify("sha256", Buffer.from(message), cert, Buffer.from(sig, "base64"));
    return ok ? { ok } : { ok, reason: "signature does not match" };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
