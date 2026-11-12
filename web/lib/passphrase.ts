// Checks an approver passphrase against the salted PBKDF2 hash made by the CLI (src/approval.ts).
// No imports, so the CLI's tests can check both sides agree.
const ITERATIONS = 100_000; // Cloudflare Workers' PBKDF2 maximum; the CLI uses the same.

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function passphraseMatches(passphrase: string, approver: { salt: string; hash: string }) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(approver.salt), iterations: ITERATIONS }, key, 256);
  const got = hex(bits);
  let diff = got.length ^ approver.hash.length;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ (approver.hash.charCodeAt(i) || 0);
  return diff === 0;
}
