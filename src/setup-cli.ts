// Guided setup and the small settings commands: setup, model, paypal, rules, web.
import { createInterface } from "node:readline";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { PayPalClient, paypalConfigFromEnv } from "./paypal/client.ts";
import { saveSettings, settingsDir, settingsFile, maskSecret, maskId } from "./settings.ts";
import { approverHash } from "./approval.ts";

const out = (s = "") => console.log(s);
export const DEFAULT_SITE = "https://pay-it-upstream.ienv.site";

function needTerminal(what: string) {
  if (!process.stdin.isTTY) throw new Error(`${what} asks questions, so run it in your own terminal (keys never pass through an agent).`);
}

/** One question. `hidden` keeps keys and passphrases off the screen. */
export function ask(question: string, opts: { hidden?: boolean; fallback?: string } = {}): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const label = `${question}${opts.fallback ? ` [${opts.fallback}]` : ""}: `;
    if (opts.hidden) {
      const w = (rl as any)._writeToOutput?.bind(rl);
      (rl as any)._writeToOutput = (s: string) => w?.(s.startsWith(label) ? label : s.includes("\n") ? "\n" : "•");
    }
    rl.question(label, (a) => {
      rl.close();
      resolve(a.trim() || opts.fallback || "");
    });
  });
}

async function choose<T extends string>(question: string, options: { value: T; label: string }[], current?: string): Promise<T> {
  out(`\n  ${question}`);
  options.forEach((o, i) => out(`    ${i + 1}) ${o.label}${o.value === current ? "  (current)" : ""}`));
  const def = Math.max(0, options.findIndex((o) => o.value === current)) + 1;
  for (;;) {
    const n = Number(await ask("  Choose", { fallback: String(def) }));
    if (options[n - 1]) return options[n - 1].value;
    out("  Pick one of the numbers above.");
  }
}

const MODELS = [
  { value: "claude:claude-opus-5-5", label: "Claude Opus 5.5    best judgment (recommended)" },
  { value: "claude:claude-sonnet-5-5", label: "Claude Sonnet 5.5  faster, cheaper" },
  { value: "claude:claude-haiku-5-5", label: "Claude Haiku 5.5   fastest" },
  { value: "gemini:gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
  { value: "command:", label: "Any local model: a command that reads a prompt and prints a reply" },
];

function modelLine(env: Record<string, string | undefined>) {
  const p = (env.AI_PROVIDER ?? "").toLowerCase();
  if (p === "claude") return `Claude · ${env.CLAUDE_MODEL ?? "claude-opus-5-5"} · effort ${env.CLAUDE_EFFORT ?? "medium"} · key ${maskSecret(env.ANTHROPIC_API_KEY)}`;
  if (p === "gemini") return `Gemini · ${env.GEMINI_MODEL ?? "gemini-3.5-flash-lite"} · key ${maskSecret(env.GEMINI_API_KEY)}`;
  if (p === "command") return `local command · ${env.AI_COMMAND ?? "(not set)"}`;
  if (p === "manual") return "manual (prompts written to files)";
  return "not set up";
}

export async function modelCommand(project: string, set: boolean) {
  if (!set) {
    out(`\n  Model   ${modelLine(process.env)}`);
    out(`  Change it with: pay-it-upstream model set`);
    return;
  }
  needTerminal("model set");
  const current = process.env.AI_PROVIDER ? `${process.env.AI_PROVIDER}:${process.env.CLAUDE_MODEL ?? process.env.GEMINI_MODEL ?? ""}` : undefined;
  const pick = await choose("Which model should choose where the money goes?", MODELS, current);
  const [provider, model] = pick.split(":");
  const values: Record<string, string> = { AI_PROVIDER: provider };
  if (provider === "claude") {
    values.CLAUDE_MODEL = model;
    values.CLAUDE_EFFORT = await choose("How hard should it think?", [
      { value: "low", label: "low     fewest tokens" },
      { value: "medium", label: "medium  (recommended)" },
      { value: "high", label: "high    most careful" },
    ], process.env.CLAUDE_EFFORT ?? "medium");
    const key = await ask(`  Anthropic API key${process.env.ANTHROPIC_API_KEY ? " (Enter keeps the current one)" : ""}`, { hidden: true });
    if (key) values.ANTHROPIC_API_KEY = key;
    if (!key && !process.env.ANTHROPIC_API_KEY) throw new Error("A Claude model needs an Anthropic API key (console.anthropic.com).");
  } else if (provider === "gemini") {
    values.GEMINI_MODEL = model;
    const key = await ask(`  Gemini API key${process.env.GEMINI_API_KEY ? " (Enter keeps the current one)" : ""}`, { hidden: true });
    if (key) values.GEMINI_API_KEY = key;
  } else {
    values.AI_COMMAND = await ask("  Command", { fallback: process.env.AI_COMMAND ?? "ollama run llama3.3" });
  }
  await saveSettings(project, values);
  out(`\n  ✓ Saved. Model: ${modelLine(process.env)}`);
}

function paypalLine(env: Record<string, string | undefined>) {
  if (!env.PAYPAL_CLIENT_ID) return "not set up";
  const stand = (env.SANDBOX_STAND_INS ?? "").split(",").filter((s) => s.trim()).length;
  return [
    `${(env.PAYPAL_ENV ?? "sandbox").toLowerCase()} · app ${maskId(env.PAYPAL_CLIENT_ID)} · secret ${maskSecret(env.PAYPAL_CLIENT_SECRET)}`,
    `paying as "${env.LEDGER_COMPANY ?? "A company"}"`,
    (env.PAYPAL_ENV ?? "sandbox") === "sandbox" ? `${stand} sandbox test account${stand === 1 ? "" : "s"} stand in for maintainers` : "",
  ].filter(Boolean).join("\n          ");
}

async function checkPayPal(): Promise<string> {
  try {
    const pp = new PayPalClient(paypalConfigFromEnv());
    await pp.verify();
    return `✓ PayPal accepted these credentials (${pp.config.env})`;
  } catch (e) {
    return `✗ ${e instanceof Error ? e.message : e}`;
  }
}

export async function paypalCommand(project: string, set: boolean) {
  if (!set) {
    out(`\n  PayPal  ${paypalLine(process.env)}`);
    if (process.env.PAYPAL_CLIENT_ID) out(`  ${await checkPayPal()}`);
    out(`  Change it with: pay-it-upstream paypal set`);
    return;
  }
  needTerminal("paypal set");
  out("\n  Payouts go from your company's PayPal business account. Get the app keys at developer.paypal.com → Apps & Credentials.");
  const env = await choose("Which PayPal?", [
    { value: "sandbox", label: "Sandbox  test money (recommended to start)" },
    { value: "live", label: "Live     real money" },
  ], process.env.PAYPAL_ENV ?? "sandbox");
  const keep = (k: string) => (process.env[k] ? " (Enter keeps the current one)" : "");
  const values: Record<string, string> = {
    PAYPAL_ENV: env,
    PAYPAL_CLIENT_ID: await ask(`  Client ID${keep("PAYPAL_CLIENT_ID")}`),
    PAYPAL_CLIENT_SECRET: await ask(`  Secret${keep("PAYPAL_CLIENT_SECRET")}`, { hidden: true }),
    LEDGER_COMPANY: await ask("  Who is paying? (shown to maintainers and on the public ledger)", { fallback: process.env.LEDGER_COMPANY ?? path.basename(path.resolve(project)) }),
  };
  if (env === "sandbox") {
    out("\n  In sandbox, test accounts stand in for real maintainers, so nobody real is emailed.");
    values.SANDBOX_STAND_INS = await ask("  Sandbox test account emails, comma-separated", { fallback: process.env.SANDBOX_STAND_INS });
  }
  for (const k of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]) if (!values[k]) delete values[k];
  await saveSettings(project, values);
  out(`\n  PayPal  ${paypalLine(process.env)}`);
  out(`  ${await checkPayPal()}`);
}

function approvalLine(env: Record<string, string | undefined>) {
  if (!env.LEDGER_URL) return "in this terminal (no site connected)";
  return `on ${env.LEDGER_URL}/approve${env.APPROVER_HASH ? ", with your passphrase" : " (no passphrase set yet)"}`;
}

export async function approvalCommand(project: string, set: boolean) {
  if (!set) {
    out(`\n  Approve ${approvalLine(process.env)}`);
    out(`  Change it with: pay-it-upstream approver set`);
    return;
  }
  needTerminal("approver set");
  out("\n  An agent proposes; a person approves. With a site connected, every plan waits on an approval page");
  out("  and only someone with the passphrase can approve it. The agent never sees the passphrase.");
  const url = (await ask("  Site", { fallback: process.env.LEDGER_URL ?? DEFAULT_SITE })).replace(/\/$/, "");
  const token = await ask(`  Site publish token${process.env.LEDGER_PUBLISH_TOKEN ? " (Enter keeps the current one)" : ""}`, { hidden: true });
  let pass = "";
  for (;;) {
    pass = await ask("  Approver passphrase (at least 8 characters)", { hidden: true });
    if (pass.length >= 8 && pass === (await ask("  Type it again", { hidden: true }))) break;
    out("  They didn't match or it was too short. Try again.");
  }
  const h = approverHash(pass);
  await saveSettings(project, { LEDGER_URL: url, LEDGER_PUBLISH_TOKEN: token || undefined, APPROVER_SALT: h.salt, APPROVER_HASH: h.hash });
  out(`\n  ✓ Saved. Plans are approved ${approvalLine(process.env)}. Only a hash of the passphrase is stored.`);
}

export async function setupCommand(project: string) {
  needTerminal("setup");
  out(`\npay-it-upstream setup for ${path.resolve(project)}`);
  out("Three things: the model that decides, the PayPal account that pays, and the person who approves.");
  out("\n─ 1/3 Model");
  await modelCommand(project, true);
  out("\n─ 2/3 PayPal");
  await paypalCommand(project, true);
  out("\n─ 3/3 Approval");
  if (/^y/i.test(await ask("  Connect a site for approvals and the public ledger? (y/n)", { fallback: "y" }))) await approvalCommand(project, true);
  else out("  Plans will be approved in this terminal.");
  out(`\n  Settings are in ${path.relative(process.cwd(), settingsFile(project)) || settingsFile(project)} (kept out of git).`);
  out("  Next: pay-it-upstream --budget 50");
}

/** Short summary of the setup, used by `status`. */
export function setupSummary() {
  return [
    `  Model    ${modelLine(process.env)}`,
    `  PayPal   ${paypalLine(process.env)}`,
    `  Approve  ${approvalLine(process.env)}`,
  ].join("\n");
}

export async function rulesCommand(project: string, set?: string) {
  const file = path.join(settingsDir(project), "rules.md");
  if (set !== undefined) {
    await mkdir(settingsDir(project), { recursive: true });
    await writeFile(file, set.trim() + "\n");
    await saveSettings(project, {}); // makes sure the folder's .gitignore exists
    out(`\n  ✓ Saved ${path.relative(process.cwd(), file) || file}. The agent reads these rules on every run; code still enforces the hard limits.`);
    return;
  }
  const rules = await readFile(file, "utf8").catch(() => "");
  out(rules ? `\n  Rules (${path.relative(process.cwd(), file) || file}):\n\n${rules.replace(/^/gm, "    ")}` : "\n  No rules yet. Example:");
  if (!rules) out(`    pay-it-upstream rules set "Prefer security-critical packages. Nothing to packages we're about to drop."`);
}

export async function webCommand(page = "") {
  const url = `${(process.env.LEDGER_URL ?? DEFAULT_SITE).replace(/\/$/, "")}${page}`;
  out(`\n  ${url}`);
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try {
    spawn(opener, [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // No browser here (a server or an agent's shell): the URL above is enough.
  }
}

