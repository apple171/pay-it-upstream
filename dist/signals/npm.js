// npm registry and npm downloads lookups.
import { getJson } from "./http.js";
import { errMsg, normalizeRepoUrl, releaseStats, toPlainText, uniq } from "./util.js";
const REGISTRY = "https://registry.npmjs.org";
/** "@scope/name" -> "@scope%2Fname"; plain names unchanged. */
export function npmPath(name) {
    return name.startsWith("@") ? "@" + encodeURIComponent(name.slice(1)) : encodeURIComponent(name);
}
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
/** Parse "Name <email> (url)" person strings or {name, email} objects. */
function parsePerson(p) {
    if (!p)
        return undefined;
    if (typeof p === "string") {
        const m = /^\s*([^<(]*?)\s*(?:<([^>]*)>)?\s*(?:\(([^)]*)\))?\s*$/.exec(p);
        if (!m)
            return { name: p.trim() || undefined };
        return { name: m[1] || undefined, email: m[2]?.trim() || undefined };
    }
    if (typeof p === "object") {
        const o = p;
        return {
            name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : undefined,
            email: typeof o.email === "string" && o.email.trim() ? o.email.trim() : undefined,
        };
    }
    return undefined;
}
function toMaintainer(p, source) {
    if (!p)
        return undefined;
    const email = p.email && EMAIL_RE.test(p.email) ? p.email : undefined;
    if (!p.name && !email)
        return undefined;
    const m = { source };
    if (p.name)
        m.name = p.name;
    if (email)
        m.email = email;
    return m;
}
/** funding: string | {url} | array of either. */
export function parseFunding(f) {
    const out = [];
    const add = (x) => {
        if (typeof x === "string")
            out.push(x);
        else if (x && typeof x === "object" && typeof x.url === "string")
            out.push(x.url);
    };
    if (Array.isArray(f))
        f.forEach(add);
    else
        add(f);
    return uniq(out.map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)));
}
function parseLicense(l) {
    if (typeof l === "string")
        return l;
    if (l && typeof l === "object" && typeof l.type === "string")
        return l.type;
    if (Array.isArray(l)) {
        const types = l.map(parseLicense).filter(Boolean);
        return types.length ? types.join(" OR ") : undefined;
    }
    return undefined;
}
function parseRepo(r) {
    if (typeof r === "string")
        return normalizeRepoUrl(r);
    if (r && typeof r === "object" && typeof r.url === "string") {
        return normalizeRepoUrl(r.url);
    }
    return undefined;
}
function pickDoc(d) {
    return {
        time: d?.time ?? {},
        readme: typeof d?.readme === "string" ? d.readme : "",
        repository: d?.repository,
    };
}
export async function npmDoc(name, cacheDir) {
    return getJson(`${REGISTRY}/${npmPath(name)}`, {
        cacheDir,
        pick: { name: "npm-doc-v1", fn: pickDoc },
    });
}
async function latest(name, cacheDir, out) {
    try {
        const d = await getJson(`${REGISTRY}/${npmPath(name)}/latest`, { cacheDir });
        if (!d) {
            out.errors.push("npm: package not found");
            return;
        }
        const maintainers = [];
        for (const m of d.maintainers ?? []) {
            const x = toMaintainer(parsePerson(m), "npm-maintainers");
            if (x)
                maintainers.push(x);
        }
        const author = toMaintainer(parsePerson(d.author), "npm-author");
        if (author) {
            const dupe = maintainers.some((m) => (author.email && m.email?.toLowerCase() === author.email.toLowerCase()) || (!author.email && m.name === author.name));
            if (!dupe)
                maintainers.push(author);
        }
        out.maintainers = maintainers;
        out.funding = parseFunding(d.funding);
        out.repo = parseRepo(d.repository) ?? out.repo;
        out.license = parseLicense(d.license) ?? parseLicense(d.licenses);
        if (d.description)
            out.description = d.description;
        if (d.deprecated)
            out.deprecated = typeof d.deprecated === "string" ? d.deprecated : "deprecated";
    }
    catch (err) {
        out.errors.push(errMsg("npm", err));
    }
}
async function history(name, cacheDir, out) {
    try {
        const doc = await npmDoc(name, cacheDir);
        if (!doc)
            return; // already reported by the /latest lookup
        const dates = Object.entries(doc.time)
            .filter(([k]) => k !== "created" && k !== "modified")
            .map(([, v]) => new Date(v));
        Object.assign(out, releaseStats(dates));
        if (!out.repo)
            out.repo = parseRepo(doc.repository);
    }
    catch (err) {
        out.errors.push(errMsg("npm history", err));
    }
}
async function downloads(name, cacheDir, out) {
    try {
        const d = await getJson(`https://api.npmjs.org/downloads/point/last-week/${npmPath(name)}`, { cacheDir });
        if (d && typeof d.downloads === "number")
            out.weeklyDownloads = d.downloads;
    }
    catch (err) {
        out.errors.push(errMsg("npm downloads", err));
    }
}
export async function fetchNpm(name, cacheDir) {
    const out = { errors: [] };
    await Promise.all([latest(name, cacheDir, out), history(name, cacheDir, out), downloads(name, cacheDir, out)]);
    return out;
}
export async function npmReadme(name, cacheDir) {
    const doc = await npmDoc(name, cacheDir);
    if (!doc)
        return { text: "" };
    return { text: toPlainText(doc.readme), repo: parseRepo(doc.repository) };
}
