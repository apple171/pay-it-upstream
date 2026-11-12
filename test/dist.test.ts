// dist/ is committed so installs from GitHub need no build step. This keeps it in step with src/:
// if it fails, run `npm run build` and commit dist/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? files(path.join(dir, f)).map((x) => path.join(f, x)) : [f])).sort();

test("dist/ matches a fresh build of src/", () => {
  const out = path.join(root, "node_modules", ".cache", "dist-check");
  rmSync(out, { recursive: true, force: true });
  execFileSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json", "--outDir", out], { cwd: root });
  const want = files(out), have = files(path.join(root, "dist"));
  assert.deepEqual(have, want, "dist/ has different files than a fresh build");
  for (const f of want) assert.equal(readFileSync(path.join(root, "dist", f), "utf8"), readFileSync(path.join(out, f), "utf8"), `dist/${f} is out of date`);
});
