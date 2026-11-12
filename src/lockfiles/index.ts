// Finds and reads the lockfiles in a project folder.

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Dep, Ecosystem, LockfileScan } from "../types.ts";
import { parsePackageLock } from "./npm.ts";
import { parseUvLock } from "./uv.ts";
import { parseRequirements } from "./requirements.ts";

export { parsePackageLock } from "./npm.ts";
export { parseUvLock, normalizePyName } from "./uv.ts";
export { parseRequirements } from "./requirements.ts";

interface Reader {
  file: string;
  ecosystem: Ecosystem;
  parse: (text: string) => Dep[];
}

const READERS: Reader[] = [
  { file: "package-lock.json", ecosystem: "npm", parse: parsePackageLock },
  { file: "uv.lock", ecosystem: "pypi", parse: parseUvLock },
  { file: "requirements.txt", ecosystem: "pypi", parse: parseRequirements },
];

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Read every supported lockfile at the top level of `dir`. */
export async function scanFolder(dir: string): Promise<LockfileScan[]> {
  const scans: LockfileScan[] = [];
  for (const r of READERS) {
    const path = join(dir, r.file);
    if (!(await isFile(path))) continue;
    const text = await readFile(path, "utf8");
    let deps: Dep[];
    try {
      deps = r.parse(text);
    } catch (err) {
      throw new Error(`Could not read ${path}: ${(err as Error).message}`);
    }
    scans.push({ file: r.file, ecosystem: r.ecosystem, deps });
  }
  if (scans.length === 0) {
    throw new Error(
      `No lockfile found in ${dir}. Looked for: ${READERS.map((r) => r.file).join(", ")}.`,
    );
  }
  return scans;
}
