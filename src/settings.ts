// Per-project settings: <project>/.pay-it-upstream/settings.env (KEY=VALUE, same names as .env.example).
// The folder gets its own .gitignore, so keys and maintainer data never reach git; only rules.md can.
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { parseEnv } from "node:util";
import path from "node:path";

export const settingsDir = (project: string) => path.join(path.resolve(project), ".pay-it-upstream");
export const settingsFile = (project: string) => path.join(settingsDir(project), "settings.env");

const GITIGNORE = `# Written by pay-it-upstream. Keys, run records and maintainer contacts stay on this machine.
*
!.gitignore
!rules.md
`;

export async function readSettings(project: string): Promise<Record<string, string>> {
  const text = await readFile(settingsFile(project), "utf8").catch(() => "");
  return parseEnv(text) as Record<string, string>;
}

/** Loads the project's settings into process.env. Values already set (shell, --env) win. */
export async function loadSettings(project: string): Promise<boolean> {
  const s = await readSettings(project);
  for (const [k, v] of Object.entries(s)) if (process.env[k] === undefined) process.env[k] = v;
  return Object.keys(s).length > 0;
}

const quote = (v: string) => (/^[\w@.:/+-]*$/.test(v) ? v : JSON.stringify(v));

/** Merges values into settings.env (empty string removes a key) and updates process.env. */
export async function saveSettings(project: string, values: Record<string, string | undefined>) {
  await mkdir(settingsDir(project), { recursive: true });
  const ignore = path.join(settingsDir(project), ".gitignore");
  if (!(await access(ignore).then(() => true, () => false))) await writeFile(ignore, GITIGNORE);

  const lines = (await readFile(settingsFile(project), "utf8").catch(() => "# pay-it-upstream settings (kept out of git)\n")).split("\n");
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    const at = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (v === "") {
      if (at >= 0) lines.splice(at, 1);
      delete process.env[k];
      continue;
    }
    const line = `${k}=${quote(v)}`;
    if (at >= 0) lines[at] = line;
    else lines.splice(lines[lines.length - 1] === "" ? lines.length - 1 : lines.length, 0, line);
    process.env[k] = v;
  }
  await writeFile(settingsFile(project), lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
}

/** Secrets (API keys, PayPal secret, tokens) are never shown, not even in part. */
export const maskSecret = (v?: string) => (v ? "set" : "not set");
/** Public identifiers (e.g. the PayPal client ID): last 4 characters, to tell apps apart. */
export const maskId = (v?: string) => (!v ? "not set" : `…${v.slice(-4)}`);
