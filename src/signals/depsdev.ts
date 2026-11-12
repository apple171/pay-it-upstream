// deps.dev lookups: advisories, source repo, project stats, dependents.

import type { Ecosystem } from "../types.ts";
import { getJson } from "./http.ts";

const BASE = "https://api.deps.dev";
const enc = encodeURIComponent;

interface VersionKey {
  version: string;
}

interface PackageResp {
  versions?: Array<{ versionKey: VersionKey; isDefault?: boolean }>;
}

interface VersionResp {
  versionKey?: VersionKey;
  isDeprecated?: boolean;
  deprecatedReason?: string;
  advisoryKeys?: Array<{ id: string }>;
  relatedProjects?: Array<{ projectKey?: { id?: string }; relationType?: string }>;
}

interface ProjectResp {
  starsCount?: number;
  forksCount?: number;
  openIssuesCount?: number;
  scorecard?: { overallScore?: number; checks?: Array<{ name?: string; score?: number }> };
}

interface DependentsResp {
  dependentCount?: number;
  directDependentCount?: number;
  indirectDependentCount?: number;
}

export interface DepsDevVersion {
  version: string;
  advisories: string[];
  /** e.g. "github.com/owner/repo" */
  projectKey?: string;
  deprecated?: string;
}

/** The package's default version (usually the latest stable). */
export async function defaultVersion(system: Ecosystem, name: string, cacheDir: string): Promise<string | undefined> {
  const d = await getJson<PackageResp>(`${BASE}/v3/systems/${system}/packages/${enc(name)}`, { cacheDir });
  const versions = d?.versions ?? [];
  return (versions.find((v) => v.isDefault) ?? versions.at(-1))?.versionKey.version;
}

export async function versionInfo(system: Ecosystem, name: string, version: string, cacheDir: string): Promise<DepsDevVersion | null> {
  const d = await getJson<VersionResp>(
    `${BASE}/v3/systems/${system}/packages/${enc(name)}/versions/${enc(version)}`,
    { cacheDir },
  );
  if (!d) return null;
  const projects = d.relatedProjects ?? [];
  const src = projects.find((p) => p.relationType === "SOURCE_REPO") ?? projects[0];
  return {
    version,
    advisories: (d.advisoryKeys ?? []).map((a) => a.id).filter(Boolean),
    projectKey: src?.projectKey?.id,
    deprecated: d.isDeprecated ? d.deprecatedReason || "deprecated" : undefined,
  };
}

export async function projectInfo(projectKey: string, cacheDir: string): Promise<ProjectResp | null> {
  return getJson<ProjectResp>(`${BASE}/v3/projects/${enc(projectKey)}`, { cacheDir });
}

export async function dependents(system: Ecosystem, name: string, version: string, cacheDir: string): Promise<DependentsResp | null> {
  return getJson<DependentsResp>(
    `${BASE}/v3alpha/systems/${system}/packages/${enc(name)}/versions/${enc(version)}:dependents`,
    { cacheDir },
  );
}

/** "https://github.com/owner/repo" -> "github.com/owner/repo" */
export function repoToProjectKey(repo: string | undefined): string | undefined {
  const m = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/([^/]+)\/([^/]+)$/i.exec(repo ?? "");
  return m ? `${m[1].toLowerCase()}/${m[2]}/${m[3]}` : undefined;
}
