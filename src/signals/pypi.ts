// PyPI JSON API and pypistats lookups.

import type { Maintainer, PackageSignals } from "../types.ts";
import { getJson } from "./http.ts";
import { errMsg, normalizeRepoUrl, releaseStats, toPlainText, uniq } from "./util.ts";

type PypiResult = Partial<PackageSignals> & { errors: string[] };

/** PEP 503 normalized name. */
export function normalizePypiName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

interface PypiInfo {
  author?: string | null;
  author_email?: string | null;
  maintainer?: string | null;
  maintainer_email?: string | null;
  project_urls?: Record<string, string> | null;
  home_page?: string | null;
  license?: string | null;
  license_expression?: string | null;
  classifiers?: string[];
  summary?: string | null;
  description?: string | null;
}

/** Subset of the PyPI JSON we keep in the cache. */
interface PypiDoc {
  info: PypiInfo;
  /** First upload time of each release that has files. */
  releaseDates: string[];
}

function pickDoc(d: any): PypiDoc {
  const releaseDates: string[] = [];
  for (const files of Object.values<any[]>(d?.releases ?? {})) {
    const times = (files ?? [])
      .filter((f) => !f.yanked)
      .map((f) => f.upload_time_iso_8601 ?? f.upload_time)
      .filter((t): t is string => typeof t === "string")
      .sort();
    if (times.length) releaseDates.push(times[0]);
  }
  return { info: d?.info ?? {}, releaseDates };
}

export async function pypiDoc(name: string, cacheDir: string): Promise<PypiDoc | null> {
  return getJson<PypiDoc>(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
    cacheDir,
    pick: { name: "pypi-doc-v1", fn: pickDoc },
  });
}

const EMAIL_RE = /[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+/;

/**
 * Parse PyPI person fields. Emails come as "Name <a@b.c>, Other <d@e.f>"
 * or as bare comma-separated lists, with names in a separate field.
 */
export function parsePeople(names: string | null | undefined, emails: string | null | undefined, source: Maintainer["source"]): Maintainer[] {
  const out: Maintainer[] = [];
  const nameList = (names ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const emailField = (emails ?? "").trim();

  if (emailField) {
    // Split on commas that are outside quotes and angle brackets.
    const parts: string[] = [];
    let cur = "";
    let quote = false;
    let angle = false;
    for (const ch of emailField) {
      if (ch === '"') quote = !quote;
      else if (ch === "<") angle = true;
      else if (ch === ">") angle = false;
      if ((ch === "," || ch === ";") && !quote && !angle) {
        parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    parts.push(cur);

    const entries = parts
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const m = /^(.*?)<([^>]+)>\s*$/.exec(p);
        const rawEmail = (m ? m[2] : p).trim();
        const email = EMAIL_RE.exec(rawEmail)?.[0];
        const name = m ? m[1].trim().replace(/^"|"$/g, "").trim() : undefined;
        return { name: name || undefined, email };
      })
      .filter((e) => e.email);

    // Bare email list with a matching names list: pair them up.
    const pair = entries.every((e) => !e.name) && nameList.length === entries.length;
    entries.forEach((e, i) => {
      const m: Maintainer = { source, email: e.email };
      const name = e.name ?? (pair ? nameList[i] : entries.length === 1 && nameList.length === 1 ? nameList[0] : undefined);
      if (name) m.name = name;
      out.push(m);
    });
    // Names without a matching email.
    if (!pair && !(entries.length === 1 && nameList.length === 1)) {
      for (const n of nameList) if (!out.some((m) => m.name === n)) out.push({ source, name: n });
    }
  } else {
    for (const n of nameList) out.push({ source, name: n });
  }
  return out;
}

const FUNDING_HOST = /github\.com\/sponsors|opencollective\.com|tidelift\.com|patreon\.com|ko-fi\.com|buymeacoffee\.com|liberapay\.com|thanks\.dev|polar\.sh/i;

function pickLicense(info: PypiInfo): string | undefined {
  if (info.license_expression) return info.license_expression;
  const lic = info.license?.trim();
  if (lic && lic.length <= 80 && !lic.includes("\n")) return lic;
  const cls = info.classifiers?.find((c) => c.startsWith("License :: "));
  if (cls) return cls.split(" :: ").pop();
  return lic ? lic.split("\n")[0].slice(0, 80) : undefined;
}

async function main(name: string, cacheDir: string, out: PypiResult): Promise<void> {
  try {
    const doc = await pypiDoc(name, cacheDir);
    if (!doc) {
      out.errors.push("pypi: package not found");
      return;
    }
    const info = doc.info;
    const people = [
      ...parsePeople(info.author, info.author_email, "pypi-author"),
      ...parsePeople(info.maintainer, info.maintainer_email, "pypi-maintainer"),
    ];
    // Drop duplicates by email (or by name when there is no email).
    const seen = new Set<string>();
    out.maintainers = people.filter((m) => {
      const k = (m.email ?? "name:" + m.name).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const urls = Object.entries(info.project_urls ?? {});
    if (info.home_page) urls.push(["Homepage", info.home_page]);
    const funding: string[] = [];
    let repo: string | undefined;
    let repoFallback: string | undefined;
    for (const [key, url] of urls) {
      if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
      if (/fund|sponsor|donat/i.test(key) || FUNDING_HOST.test(url)) {
        funding.push(url);
        continue;
      }
      const isForge = /^(https?:\/\/)?(www\.)?(github\.com|gitlab\.com|bitbucket\.org)\/[^/]+\/[^/]+/i.test(url);
      if (!repo && isForge && /source|repo|code|github|gitlab/i.test(key)) repo = normalizeRepoUrl(url);
      if (!repoFallback && isForge) repoFallback = normalizeRepoUrl(url);
    }
    out.funding = uniq(funding);
    out.repo = repo ?? repoFallback;
    out.license = pickLicense(info);
    if (info.summary) out.description = info.summary;
    if (info.classifiers?.some((c) => c.startsWith("Development Status :: 7"))) {
      out.deprecated = "Development Status :: 7 - Inactive";
    }
    Object.assign(out, releaseStats(doc.releaseDates.map((t) => new Date(t))));
  } catch (err) {
    out.errors.push(errMsg("pypi", err));
  }
}

async function downloads(name: string, cacheDir: string, out: PypiResult): Promise<void> {
  // pypistats rate-limits; on failure leave downloads undefined.
  try {
    const d = await getJson<{ data?: { last_week?: number } }>(
      `https://pypistats.org/api/packages/${encodeURIComponent(normalizePypiName(name))}/recent`,
      { cacheDir },
    );
    if (typeof d?.data?.last_week === "number") out.weeklyDownloads = d.data.last_week;
  } catch {
    // ignored on purpose
  }
}

export async function fetchPypi(name: string, cacheDir: string): Promise<PypiResult> {
  const out: PypiResult = { errors: [] };
  await Promise.all([main(name, cacheDir, out), downloads(name, cacheDir, out)]);
  return out;
}

export async function pypiReadme(name: string, cacheDir: string): Promise<string> {
  const doc = await pypiDoc(name, cacheDir);
  const desc = doc?.info.description;
  if (!desc || desc === "UNKNOWN") return "";
  return toPlainText(desc);
}
