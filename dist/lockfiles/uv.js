// Reader for uv.lock (TOML).
import { parse } from "smol-toml";
/** PEP 503 name normalization. */
export function normalizePyName(name) {
    return name.trim().toLowerCase().replace(/[-_.]+/g, "-");
}
/** All dependency references of a package, including optional and dev groups. */
function allRefs(pkg, withGroups) {
    const refs = [...(pkg.dependencies ?? [])];
    if (withGroups) {
        for (const group of Object.values(pkg["optional-dependencies"] ?? {}))
            refs.push(...group);
        for (const group of Object.values(pkg["dev-dependencies"] ?? {}))
            refs.push(...group);
    }
    return refs.filter((r) => r && typeof r.name === "string");
}
function isLocalProject(pkg) {
    const src = pkg.source ?? {};
    return "editable" in src || "virtual" in src;
}
export function parseUvLock(text) {
    let doc;
    try {
        doc = parse(text);
    }
    catch (err) {
        throw new Error(`uv.lock is not valid TOML: ${err.message}`);
    }
    const packages = (doc.package ?? []);
    if (!Array.isArray(packages))
        throw new Error("uv.lock has no [[package]] tables");
    const local = packages.filter(isLocalProject);
    const localNames = new Set(local.map((p) => normalizePyName(p.name)));
    const others = packages.filter((p) => !isLocalProject(p) && typeof p.name === "string");
    // Versions present per name, to attribute refs that carry no version.
    const versionsByName = new Map();
    for (const p of others) {
        const n = normalizePyName(p.name);
        const list = versionsByName.get(n) ?? [];
        list.push(p.version ?? "");
        versionsByName.set(n, list);
    }
    // A ref names a version only in forked resolutions; otherwise it means every copy.
    const idsFor = (r) => {
        const n = normalizePyName(r.name);
        const versions = r.version !== undefined ? [r.version] : (versionsByName.get(n) ?? []);
        return versions.map((v) => `${n}@${v}`);
    };
    const directIds = new Set();
    for (const p of local) {
        for (const r of allRefs(p, true))
            for (const id of idsFor(r))
                directIds.add(id);
    }
    // name@version -> names of packages that depend on it.
    const dependents = new Map();
    for (const p of others) {
        const from = normalizePyName(p.name);
        for (const r of allRefs(p, true)) {
            const to = normalizePyName(r.name);
            if (to === from || localNames.has(to))
                continue;
            for (const id of idsFor(r)) {
                let set = dependents.get(id);
                if (!set)
                    dependents.set(id, (set = new Set()));
                set.add(from);
            }
        }
    }
    const seen = new Map();
    for (const p of others) {
        const name = normalizePyName(p.name);
        const version = p.version ?? "";
        const id = `${name}@${version}`;
        if (seen.has(id))
            continue;
        seen.set(id, {
            name,
            version,
            ecosystem: "pypi",
            direct: directIds.has(id),
            dependedOnBy: dependents.get(id)?.size ?? 0,
        });
    }
    return [...seen.values()];
}
