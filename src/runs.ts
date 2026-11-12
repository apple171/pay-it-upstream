// Run records, saved as JSON in <project>/.pay-it-upstream/runs/.
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { AgentPlan } from "./agent/agent.ts";
import type { Allocation, EffectiveLimits } from "./plan.ts";
import type { BatchStatus } from "./paypal/payouts.ts";
import type { PackageSignals } from "./types.ts";

export interface PayoutRecordLine {
  senderItemId: string;
  package: string;
  amountCents: number;
  /** Who PayPal was asked to pay (a stand-in in sandbox). */
  receiver: string;
  /** Masked real maintainer email, for display. */
  maintainerMasked: string;
}

export interface RunRecord {
  id: string;
  /** "plan" for a normal run; "resplit" when it re-splits unclaimed money from `parent`. */
  kind: "plan" | "resplit";
  parent?: string;
  createdAt: string;
  project: string;
  budgetCents: number;
  currency: string;
  rules: string;
  rulesFingerprint: string;
  methodologyFingerprint: string;
  lockfiles: string[];
  candidates: number;
  /** Facts the agent saw, kept so follow-ups (re-splits) use the same evidence. */
  signals: PackageSignals[];
  baseline: { package: string; weeklyDownloads?: number }[];
  plan: AgentPlan;
  allocations: Allocation[];
  rejected: { package: string; why: string }[];
  limits: EffectiveLimits;
  unspentCents: number;
  payout?: {
    env: "sandbox" | "live";
    senderBatchId: string;
    batchId: string;
    sentAt: string;
    lines: PayoutRecordLine[];
  };
  status?: BatchStatus & { checkedAt: string };
  /** Set once unclaimed payouts were re-split, so it never happens twice. */
  resplit?: {
    childId: string;
    cancels: { itemId: string; package: string; amount: string; cancelled: boolean; error?: string }[];
  };
  /** Who approved paying this plan: a person on the site (passphrase) or in the terminal. */
  approval?: { via: "site" | "terminal"; by: string; at: string };
  events: { at: string; text: string }[];
}

export const fingerprint = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);

export const runsDir = (project: string) => path.join(project, ".pay-it-upstream", "runs");

export function newRunId(): string {
  const t = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  return `${t}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function saveRun(run: RunRecord): Promise<string> {
  const dir = runsDir(run.project);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${run.id}.json`);
  await writeFile(file, JSON.stringify(run, null, 2));
  return file;
}

export async function loadRun(project: string, id: string): Promise<RunRecord> {
  const hint = `Plan one first, or point --dir at the project folder (looked in ${runsDir(project)}).`;
  const files = (await readdir(runsDir(project)).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No runs yet. ${hint}`);
  if (id === "latest") id = files[files.length - 1].replace(/\.json$/, "");
  if (!files.includes(`${id}.json`)) throw new Error(`No run "${id}". Latest is ${files[files.length - 1].replace(/\.json$/, "")}.`);
  return JSON.parse(await readFile(path.join(runsDir(project), `${id}.json`), "utf8"));
}

export function addEvent(run: RunRecord, text: string) {
  run.events.push({ at: new Date().toISOString(), text });
}
