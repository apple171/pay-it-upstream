// Run records, saved as JSON in <project>/.pay-it-upstream/runs/.
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
export const fingerprint = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12);
export const runsDir = (project) => path.join(project, ".pay-it-upstream", "runs");
export function newRunId() {
    const t = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
    return `${t}-${Math.random().toString(36).slice(2, 6)}`;
}
export async function saveRun(run) {
    const dir = runsDir(run.project);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${run.id}.json`);
    await writeFile(file, JSON.stringify(run, null, 2));
    return file;
}
export async function loadRun(project, id) {
    const hint = `Plan one first, or point --dir at the project folder (looked in ${runsDir(project)}).`;
    const files = (await readdir(runsDir(project)).catch(() => [])).filter((f) => f.endsWith(".json")).sort();
    if (!files.length)
        throw new Error(`No runs yet. ${hint}`);
    if (id === "latest")
        id = files[files.length - 1].replace(/\.json$/, "");
    if (!files.includes(`${id}.json`))
        throw new Error(`No run "${id}". Latest is ${files[files.length - 1].replace(/\.json$/, "")}.`);
    return JSON.parse(await readFile(path.join(runsDir(project), `${id}.json`), "utf8"));
}
export function addEvent(run, text) {
    run.events.push({ at: new Date().toISOString(), text });
}
