// npm registry and npm downloads lookups.

import type { Maintainer, PackageSignals } from "../types.ts";
import { getJson } from "./http.ts";
import { errMsg, normalizeRepoUrl, releaseStats, toPlainText, uniq } from "./util.ts";

type NpmResult = Partial<PackageSignals> & { errors: string[] };

const REGISTRY = "https://registry.npmjs.org";

/** "@scope/name" -> "@scope%2Fname"; plain names unchanged. */
export function npmPath(name: string): string {
  return name.startsWith("@") ? "@" + encodeURIComponent(name.slice(1)) : encodeURIComponent(name);
}

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** Parse "Name <email> (url)" person strings or {name, email} objects. */
function parsePerson(p: unknown): { name?: string; email?: string } | undefined {
  if (!p) return undefined;
  if (typeof p === "string") {
    const m = /^\s*([^<(]*?)\s*(?:<([^>]*)>)?\s*(?:\(([^)]*)\))?\s*$/.exec(p);
    if (!m) return { name: p.trim() || undefined };
    return { name: m[1] || undefined, email: m[2]?.trim() || undefined };
  }
  if (typeof p === "object") {
    const o = p as { name?: unknown; email?: unknown };
    return {
      name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : undefined,
      email: typeof o.email === "string" && o.email.trim() ? o.email.trim() : undefined,
    };
  }
  return undefined;
}

function toMaintainer(p: { name?: string; email?: string } | undefined, source: Maintainer["source"]): Maintainer | undefined {
  if (!p) return undefined;
  const email = p.email && EMAIL_RE.test(p.email) ? p.email : undefined;
  if (!p.name && !email) return undefined;
  const m: Maintainer = { source };
  if (p.name) m.name = p.name;
  if (email) m.email = email;
  return m;
}

/** funding: string | {url} | array of either. */
export function parseFunding(f: unknown): string[] {
  const out: string[] = [];
  const add = (x: unknown) => {
    if (typeof x === "string") out.push(x);
    else if (x && typeof x === "object" && typeof (x as { url?: unknown }).url === "string") out.push((x as { url: string }).url);
  };
  if (Array.isArray(f)) f.forEach(add);
  else add(f);
  return uniq(out.map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)));
}

function parseLicense(l: unknown): string | undefined {
  if (typeof l === "string") return l;
  if (l && typeof l === "object" && typeof (l as { type?: unknown }).type === "string") return (l as { type: string }).type;
  if (Array.isArray(l)) {
    const types = l.map(parseLicense).filter(Boolean);
    return types.length ? types.join(" OR ") : undefined;
  }
  return undefined;
}

function parseRepo(r: unknown): string | undefined {
  if (typeof r === "string") return normalizeRepoUrl(r);
  if (r && typeof r === "object" && typeof (r as { url?: unknown }).url === "string") {
    return normalizeRepoUrl((r as { url: string }).url);
  }
  return undefined;
}

interface NpmLatest {
  maintainers?: unknown[];
  author?: unknown;
  funding?: unknown;
  repository?: unknown;
  license?: unknown;
  licenses?: unknown;
  description?: string;
  deprecated?: string | boolean;
}

/** Subset of the full packument that we keep in the cache. */
interface NpmDoc {
  time: Record<string, string>;
  readme: string;
  repository?: unknown;
}

function pickDoc(d: any): NpmDoc {
  return {
    time: d?.time ?? {},
    readme: typeof d?.readme === "string" ? d.readme : "",
    repository: d?.repository,
  };
}

export async function npmDoc(name: string, cacheDir: string): Promise<NpmDoc | null> {
  return getJson<NpmDoc>(`${REGISTRY}/${npmPath(name)}`, {
    cacheDir,
    pick: { name: "npm-doc-v1", fn: pickDoc },
  });
}

async function latest(name: string, cacheDir: string, out: NpmResult): Promise<void> {
  try {
    const d = await getJson<NpmLatest>(`${REGISTRY}/${npmPath(name)}/latest`, { cacheDir });
    if (!d) {
      out.errors.push("npm: package not found");
      return;
    }
    const maintainers: Maintainer[] = [];
    for (const m of d.maintainers ?? []) {
      const x = toMaintainer(parsePerson(m), "npm-maintainers");
      if (x) maintainers.push(x);
    }
    const author = toMaintainer(parsePerson(d.author), "npm-author");
    if (author) {
      const dupe = maintainers.some(
        (m) => (author.email && m.email?.toLowerCase() === author.email.toLowerCase()) || (!author.email && m.name === author.name),
      );
      if (!dupe) maintainers.push(author);
    }
    out.maintainers = maintainers;
    out.funding = parseFunding(d.funding);
    out.repo = parseRepo(d.repository) ?? out.repo;
    out.license = parseLicense(d.license) ?? parseLicense(d.licenses);
    if (d.description) out.description = d.description;
    if (d.deprecated) out.deprecated = typeof d.deprecated === "string" ? d.deprecated : "deprecated";
  } catch (err) {
    out.errors.push(errMsg("npm", err));
  }
}

async function history(name: string, cacheDir: string, out: NpmResult): Promise<void> {
  try {
    const doc = await npmDoc(name, cacheDir);
    if (!doc) return; // already reported by the /latest lookup
    const dates = Object.entries(doc.time)
      .filter(([k]) => k !== "created" && k !== "modified")
      .map(([, v]) => new Date(v));
    Object.assign(out, releaseStats(dates));
    if (!out.repo) out.repo = parseRepo(doc.repository);
  } catch (err) {
    out.errors.push(errMsg("npm history", err));
  }
}

async function downloads(name: string, cacheDir: string, out: NpmResult): Promise<void> {
  try {
    const d = await getJson<{ downloads?: number }>(
      `https://api.npmjs.org/downloads/point/last-week/${npmPath(name)}`,
      { cacheDir },
    );
    if (d && typeof d.downloads === "number") out.weeklyDownloads = d.downloads;
  } catch (err) {
    out.errors.push(errMsg("npm downloads", err));
  }
}

export async function fetchNpm(name: string, cacheDir: string): Promise<NpmResult> {
  const out: NpmResult = { errors: [] };
  await Promise.all([latest(name, cacheDir, out), history(name, cacheDir, out), downloads(name, cacheDir, out)]);
  return out;
}

export async function npmReadme(name: string, cacheDir: string): Promise<{ text: string; repo?: string }> {
  const doc = await npmDoc(name, cacheDir);
  if (!doc) return { text: "" };
  return { text: toPlainText(doc.readme), repo: parseRepo(doc.repository) };
}
