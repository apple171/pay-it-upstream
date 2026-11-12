// Shared types for the whole tool.

export type Ecosystem = "npm" | "pypi";

/** One package found in a lockfile. */
export interface Dep {
  name: string;
  version: string;
  ecosystem: Ecosystem;
  /** Listed directly by the project (not pulled in by another package). */
  direct: boolean;
  /** How many other packages in this lockfile depend on it. */
  dependedOnBy: number;
}

export interface LockfileScan {
  /** Path of the lockfile, relative to the scanned folder. */
  file: string;
  ecosystem: Ecosystem;
  deps: Dep[];
}

export interface Maintainer {
  name?: string;
  email?: string;
  /** Where the email came from. Only published registry data is used. */
  source: "npm-maintainers" | "npm-author" | "pypi-author" | "pypi-maintainer";
}

/** Facts about one package, gathered from public registries and deps.dev. */
export interface PackageSignals {
  name: string;
  ecosystem: Ecosystem;
  version: string;
  direct: boolean;
  dependedOnBy: number;

  // Reliance across the whole ecosystem
  dependents?: number;
  directDependents?: number;
  weeklyDownloads?: number;

  // Fragility
  maintainers: Maintainer[];
  firstRelease?: string; // ISO date
  lastRelease?: string; // ISO date
  releasesLastYear?: number;
  advisories: string[];
  deprecated?: string;
  scorecard?: number; // OpenSSF Scorecard, 0-10
  /** Is an accountable person behind it? Scorecard's Code-Review and Maintained checks (0-10, -1 = unknown). */
  codeReview?: number;
  maintained?: number;
  openIssues?: number;

  // Funding
  funding: string[]; // funding URLs declared by the package
  stars?: number;
  forks?: number;

  repo?: string;
  description?: string;
  license?: string;

  /** Set for planted demo packages (never shown to the agent). */
  planted?: { label: string; readme: string };

  /** Lookups that failed. The package is still listed. */
  errors: string[];
}
