// Turning lockfile entries into the list of packages worth looking up.
import type { Dep } from "./types.ts";

/** Merge lockfiles; one entry per package. Keeps the strongest reliance seen. */
export function mergeDeps(lists: Dep[][]): Dep[] {
  const map = new Map<string, Dep>();
  for (const d of lists.flat()) {
    const key = `${d.ecosystem}:${d.name}`;
    const prev = map.get(key);
    if (!prev) map.set(key, { ...d });
    else {
      prev.direct ||= d.direct;
      prev.dependedOnBy = Math.max(prev.dependedOnBy, d.dependedOnBy);
      if (!prev.version && d.version) prev.version = d.version;
    }
  }
  return [...map.values()];
}

/** This tool itself, when it's installed in the project being funded: never a candidate. */
const SELF = "pay-it-upstream";

/** Direct deps first, then the most load-bearing transitive ones. */
export function pickCandidates(deps: Dep[], max: number): Dep[] {
  return deps
    .filter((d) => !(d.ecosystem === "npm" && d.name === SELF))
    .sort((a, b) => Number(b.direct) - Number(a.direct) || b.dependedOnBy - a.dependedOnBy || a.name.localeCompare(b.name))
    .slice(0, max);
}
