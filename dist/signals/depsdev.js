// deps.dev lookups: advisories, source repo, project stats, dependents.
import { getJson } from "./http.js";
const BASE = "https://api.deps.dev";
const enc = encodeURIComponent;
/** The package's default version (usually the latest stable). */
export async function defaultVersion(system, name, cacheDir) {
    const d = await getJson(`${BASE}/v3/systems/${system}/packages/${enc(name)}`, { cacheDir });
    const versions = d?.versions ?? [];
    return (versions.find((v) => v.isDefault) ?? versions.at(-1))?.versionKey.version;
}
export async function versionInfo(system, name, version, cacheDir) {
    const d = await getJson(`${BASE}/v3/systems/${system}/packages/${enc(name)}/versions/${enc(version)}`, { cacheDir });
    if (!d)
        return null;
    const projects = d.relatedProjects ?? [];
    const src = projects.find((p) => p.relationType === "SOURCE_REPO") ?? projects[0];
    return {
        version,
        advisories: (d.advisoryKeys ?? []).map((a) => a.id).filter(Boolean),
        projectKey: src?.projectKey?.id,
        deprecated: d.isDeprecated ? d.deprecatedReason || "deprecated" : undefined,
    };
}
export async function projectInfo(projectKey, cacheDir) {
    return getJson(`${BASE}/v3/projects/${enc(projectKey)}`, { cacheDir });
}
export async function dependents(system, name, version, cacheDir) {
    return getJson(`${BASE}/v3alpha/systems/${system}/packages/${enc(name)}/versions/${enc(version)}:dependents`, { cacheDir });
}
/** "https://github.com/owner/repo" -> "github.com/owner/repo" */
export function repoToProjectKey(repo) {
    const m = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/([^/]+)\/([^/]+)$/i.exec(repo ?? "");
    return m ? `${m[1].toLowerCase()}/${m[2]}/${m[3]}` : undefined;
}
