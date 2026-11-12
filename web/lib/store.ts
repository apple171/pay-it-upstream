// The ledger: a small JSON store. Payment statuses change only on PayPal-verified webhooks.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type Level = "low" | "medium" | "high";

/** What the CLI publishes for one run. Contains no maintainer emails. */
export interface PublishedRun {
  id: string;
  kind: "plan" | "resplit";
  parent?: string;
  createdAt: string;
  company: string;
  env: "sandbox" | "live";
  budgetCents: number;
  currency: string;
  rulesFingerprint: string;
  methodologyFingerprint: string;
  model: string;
  summary: string;
  batchId: string;
  /** Packages in this project with one maintainer that many others rely on. */
  critical: string[];
  skipped: { package: string; why: string }[];
  /** What a plain download-count ranking would have funded, for comparison. */
  baseline?: string[];
  /** The person who approved paying it. */
  approval?: { via: "site" | "terminal"; by: string; at: string };
  items: {
    senderItemId: string;
    package: string;
    ecosystem: "npm" | "pypi";
    amountCents: number;
    maintainerMasked: string;
    reason: string;
    evidence: string[];
    levels: { reliance?: Level; fragility?: Level; underfunded?: Level };
  }[];
}

export interface LedgerItem {
  senderItemId: string;
  runId: string;
  package: string;
  ecosystem: "npm" | "pypi";
  amountCents: number;
  currency: string;
  maintainerMasked: string;
  reason: string;
  evidence: string[];
  levels: PublishedRun["items"][number]["levels"];
  /** SENT until PayPal confirms; then SUCCESS, UNCLAIMED, RETURNED, ... */
  status: string;
  /** True once the status came from a signature-checked PayPal webhook. */
  verified: boolean;
  payoutItemId?: string;
  transactionId?: string;
  updatedAt: string;
  history: { status: string; at: string; eventId?: string }[];
}

/** What the CLI publishes for one pledge. Contains no maintainer emails. */
export interface PublishedPledge {
  id: string;
  kind: "security-fix" | "feature";
  company: string;
  env: "sandbox" | "live";
  package: string;
  ecosystem: "npm" | "pypi";
  /** What has to ship for the money to be paid. */
  what: string;
  amountCents: number;
  currency: string;
  createdAt: string;
  maintainerMasked: string;
  /** The CLI's view: held, shipped, withdrawn or expired. */
  state: string;
  heldUntil?: string;
  authorizationId?: string;
  captureId?: string;
  payoutBatchId?: string;
  payoutItemId?: string;
}

/** A pledge on the ledger. `paypal` holds only what signature-checked PayPal webhooks confirmed. */
export interface LedgerPledge extends PublishedPledge {
  paypal: { held?: string; collected?: string; released?: string; payout?: string };
  updatedAt: string;
}

export interface LedgerEvent {
  id: string;
  type: string;
  receivedAt: string;
  senderItemId?: string;
  batchId?: string;
  status?: string;
  /** Authorization, capture or pledge id, for pledge events. */
  pledgeRef?: string;
  pledgeStep?: "held" | "collected" | "released";
  /** Summary shown on the public log: no emails. */
  summary: string;
}

/** A plan an agent proposed, waiting for a person (sent by the CLI or the MCP server). */
export interface Proposal {
  id: string;
  kind: "plan" | "resplit";
  parent?: string;
  createdAt: string;
  company: string;
  env: "sandbox" | "live";
  budgetCents: number;
  currency: string;
  unspentCents: number;
  rules: string;
  rulesFingerprint: string;
  methodologyFingerprint: string;
  model: string;
  summary: string;
  lockfiles: string[];
  candidates: number;
  critical: string[];
  skipped: { package: string; why: string }[];
  rejected: { package: string; why: string }[];
  baseline: string[];
  items: Omit<PublishedRun["items"][number], "senderItemId">[];
}

export interface Approval {
  proposal: Proposal;
  /** Salted PBKDF2 hash of the approver's passphrase. Never sent to browsers. */
  approver: { salt: string; hash: string };
  state: "waiting" | "approved" | "rejected";
  requestedAt: string;
  decidedAt?: string;
  by?: string;
  note?: string;
  failedAttempts: number;
}

export interface Ledger {
  runs: Record<string, Omit<PublishedRun, "items">>;
  pledges: Record<string, LedgerPledge>;
  items: Record<string, LedgerItem>;
  events: Record<string, LedgerEvent>;
  approvals: Record<string, Approval>;
  /** Webhooks refused because the PayPal signature didn't check out. */
  rejected: { at: string; reason: string }[];
}

const empty = (): Ledger => ({ runs: {}, pledges: {}, items: {}, events: {}, approvals: {}, rejected: [] });
const parse = (doc: string | undefined): Ledger => {
  try {
    return { ...empty(), ...JSON.parse(doc || "{}") };
  } catch {
    return empty();
  }
};

// Storage: Cloudflare D1 when deployed (binding "DB"), a local JSON file otherwise.

/** The subset of Cloudflare's D1 API used here. */
export interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      run(): Promise<{ meta: { changes: number } }>;
    };
  };
}

let d1Ready: Promise<D1Like | undefined> | undefined;

/** The D1 database when running on Cloudflare; undefined locally. Creates tables on first use. */
export function getD1(): Promise<D1Like | undefined> {
  d1Ready ??= (async () => {
    let db: D1Like | undefined;
    try {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      db = ((await getCloudflareContext({ async: true })).env as { DB?: D1Like }).DB;
    } catch {
      return undefined;
    }
    if (!db) return undefined;
    await db.prepare("CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, doc TEXT NOT NULL)").bind().run();
    await db.prepare("INSERT OR IGNORE INTO ledger (id, version, doc) VALUES (1, 0, '{}')").bind().run();
    await db
      .prepare("CREATE TABLE IF NOT EXISTS ai_usage (day TEXT NOT NULL, ip TEXT NOT NULL, calls INTEGER NOT NULL, PRIMARY KEY (day, ip))")
      .bind()
      .run();
    return db;
  })();
  return d1Ready;
}

const dataDir = () => process.env.DATA_DIR || path.join(process.cwd(), "data");
const file = () => path.join(dataDir(), "ledger.json");

let queue: Promise<unknown> = Promise.resolve();

export async function readLedger(): Promise<Ledger> {
  const db = await getD1();
  if (db) return parse((await db.prepare("SELECT doc FROM ledger WHERE id = 1").bind().first<{ doc: string }>())?.doc);
  try {
    return parse(await readFile(file(), "utf8"));
  } catch {
    return empty();
  }
}

/**
 * Applies one change. On D1 a version check makes concurrent webhooks safe (retry on conflict);
 * locally changes are queued and the file is written atomically.
 */
export async function updateLedger<T>(fn: (l: Ledger) => T | Promise<T>): Promise<T> {
  const db = await getD1();
  if (db) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await db.prepare("SELECT version, doc FROM ledger WHERE id = 1").bind().first<{ version: number; doc: string }>();
      const ledger = parse(row?.doc);
      const result = await fn(ledger);
      const res = await db
        .prepare("UPDATE ledger SET doc = ?, version = version + 1 WHERE id = 1 AND version = ?")
        .bind(JSON.stringify(ledger), row?.version ?? 0)
        .run();
      if (res.meta.changes === 1) return result;
    }
    throw new Error("ledger is busy, try again");
  }
  const next = queue.then(async () => {
    const ledger = await readLedger();
    const result = await fn(ledger);
    await mkdir(dataDir(), { recursive: true });
    const tmp = `${file()}.tmp`;
    await writeFile(tmp, JSON.stringify(ledger, null, 1));
    await rename(tmp, file());
    return result;
  });
  queue = next.catch(() => {});
  return next;
}
