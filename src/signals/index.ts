// Gathers public facts about packages from npm, PyPI and deps.dev.

import type { Dep, Ecosystem, PackageSignals } from "../types.ts";
import { dependents, defaultVersion, projectInfo, repoToProjectKey, versionInfo } from "./depsdev.ts";
import type { DepsDevVersion } from "./depsdev.ts";
import { getText, limiter } from "./http.ts";
import { fetchNpm, npmReadme } from "./npm.ts";
import { fetchPypi, pypiReadme } from "./pypi.ts";
import { errMsg, toPlainText, uniq } from "./util.ts";

export interface GatherOptions {
  cacheDir: string;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

// Exact versions only; ranges and blanks get resolved to the default version.
const EXACT_VERSION = /^[0-9][\w.+!-]*$/;

interface DepsDevResult {
  version?: string;
  info?: DepsDevVersion;
  dependentCount?: number;
  directDependentCount?: number;
  errors: string[];
}

async function fromDepsDev(dep: Dep, cacheDir: string): Promise<DepsDevResult> {
  const out: DepsDevResult = { errors: [] };
  const sys = dep.ecosystem;
  try {
    let version = dep.version.trim();
    if (!EXACT_VERSION.test(version)) {
      version = (await defaultVersion(sys, dep.name, cacheDir)) ?? "";
      if (!version) {
        out.errors.push("deps.dev: package not found");
        return out;
      }
    }
    out.version = version;

    let [info, deps] = await Promise.all([
      versionInfo(sys, dep.name, version, cacheDir),
      dependents(sys, dep.name, version, cacheDir).catch((err) => {
        out.errors.push(errMsg("deps.dev dependents", err));
        return null;
      }),
    ]);

    if (!info) {
      // Unknown version: use the default version for repo and dependents only.
      out.errors.push(`deps.dev: version ${version} not found`);
      const def = await defaultVersion(sys, dep.name, cacheDir);
      if (def && def !== version) {
        const [defInfo, defDeps] = await Promise.all([
          versionInfo(sys, dep.name, def, cacheDir),
          deps ? Promise.resolve(deps) : dependents(sys, dep.name, def, cacheDir).catch(() => null),
        ]);
        if (defInfo) info = { ...defInfo, advisories: [] };
        deps = defDeps;
      }
    }
    out.info = info ?? undefined;
    if (deps) {
      out.dependentCount = deps.dependentCount;
      out.directDependentCount = deps.directDependentCount;
    }
  } catch (err) {
    out.errors.push(errMsg("deps.dev", err));
  }
  return out;
}

async function gatherOne(dep: Dep, cacheDir: string): Promise<PackageSignals> {
  const result: PackageSignals = {
    name: dep.name,
    ecosystem: dep.ecosystem,
    version: dep.version,
    direct: dep.direct,
    dependedOnBy: dep.dependedOnBy,
    maintainers: [],
    advisories: [],
    funding: [],
    errors: [],
  };

  const [reg, dd] = await Promise.all([
    (dep.ecosystem === "npm" ? fetchNpm(dep.name, cacheDir) : fetchPypi(dep.name, cacheDir)).catch((err) => ({
      errors: [errMsg(dep.ecosystem, err)],
    })),
    fromDepsDev(dep, cacheDir),
  ]);

  const { errors: regErrors, ...regFields } = reg;
  Object.assign(result, regFields);
  result.errors.push(...regErrors, ...dd.errors);
  if (!result.version && dd.version) result.version = dd.version;

  result.dependents = dd.dependentCount;
  result.directDependents = dd.directDependentCount;
  if (dd.info) {
    result.advisories = uniq(dd.info.advisories);
    if (!result.deprecated && dd.info.deprecated) result.deprecated = dd.info.deprecated;
  }

  const projectKey = dd.info?.projectKey ?? repoToProjectKey(result.repo);
  if (!result.repo && projectKey) result.repo = `https://${projectKey}`;
  if (projectKey) {
    try {
      const p = await projectInfo(projectKey, cacheDir);
      if (p) {
        result.stars = p.starsCount;
        result.forks = p.forksCount;
        result.openIssues = p.openIssuesCount;
        result.scorecard = p.scorecard?.overallScore;
        const check = (name: string) => p.scorecard?.checks?.find((c) => c.name === name)?.score;
        result.codeReview = check("Code-Review");
        result.maintained = check("Maintained");
      }
    } catch (err) {
      result.errors.push(errMsg("deps.dev project", err));
    }
  }

  // Drop undefined keys so the output stays compact.
  for (const k of Object.keys(result) as Array<keyof PackageSignals>) {
    if (result[k] === undefined) delete result[k];
  }
  return result;
}

/** One result per dep, in the same order. Never throws for a single failed lookup. */
export async function gatherSignals(deps: Dep[], opts: GatherOptions): Promise<PackageSignals[]> {
  const limit = limiter(Math.max(1, opts.concurrency ?? 6));
  let done = 0;
  opts.onProgress?.(0, deps.length);
  return Promise.all(
    deps.map((dep) =>
      limit(async () => {
        let r: PackageSignals;
        try {
          r = await gatherOne(dep, opts.cacheDir);
        } catch (err) {
          r = {
            name: dep.name,
            ecosystem: dep.ecosystem,
            version: dep.version,
            direct: dep.direct,
            dependedOnBy: dep.dependedOnBy,
            maintainers: [],
            advisories: [],
            funding: [],
            errors: [errMsg("signals", err)],
          };
        }
        done++;
        opts.onProgress?.(done, deps.length);
        return r;
      }),
    ),
  );
}

async function githubReadme(repo: string | undefined, cacheDir: string): Promise<string> {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(repo ?? "");
  if (!m) return "";
  for (const file of ["README.md", "readme.md", "README.rst", "README"]) {
    const t = await getText(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/HEAD/${file}`, { cacheDir });
    if (t) return toPlainText(t);
  }
  return "";
}

/**
 * The package's README / long description as plain text, about 4000 chars
 * at most. "" if there is none or the lookup fails.
 */
export async function fetchReadme(ecosystem: Ecosystem, name: string, cacheDir: string): Promise<string> {
  try {
    if (ecosystem === "npm") {
      const { text, repo } = await npmReadme(name, cacheDir);
      return text || (await githubReadme(repo, cacheDir));
    }
    const text = await pypiReadme(name, cacheDir);
    if (text) return text;
    const { repo } = await fetchPypi(name, cacheDir);
    return await githubReadme(repo, cacheDir);
  } catch {
    return "";
  }
}

export { getJson, limiter } from "./http.ts";
