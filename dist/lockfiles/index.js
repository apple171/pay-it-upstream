// Finds and reads the lockfiles in a project folder.
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parsePackageLock } from "./npm.js";
import { parseUvLock } from "./uv.js";
import { parseRequirements } from "./requirements.js";
export { parsePackageLock } from "./npm.js";
export { parseUvLock, normalizePyName } from "./uv.js";
export { parseRequirements } from "./requirements.js";
const READERS = [
    { file: "package-lock.json", ecosystem: "npm", parse: parsePackageLock },
    { file: "uv.lock", ecosystem: "pypi", parse: parseUvLock },
    { file: "requirements.txt", ecosystem: "pypi", parse: parseRequirements },
];
async function isFile(path) {
    try {
        return (await stat(path)).isFile();
    }
    catch {
        return false;
    }
}
/** Read every supported lockfile at the top level of `dir`. */
export async function scanFolder(dir) {
    const scans = [];
    for (const r of READERS) {
        const path = join(dir, r.file);
        if (!(await isFile(path)))
            continue;
        const text = await readFile(path, "utf8");
        let deps;
        try {
            deps = r.parse(text);
        }
        catch (err) {
            throw new Error(`Could not read ${path}: ${err.message}`);
        }
        scans.push({ file: r.file, ecosystem: r.ecosystem, deps });
    }
    if (scans.length === 0) {
        throw new Error(`No lockfile found in ${dir}. Looked for: ${READERS.map((r) => r.file).join(", ")}.`);
    }
    return scans;
}
