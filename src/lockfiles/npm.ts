// Reader for npm package-lock.json (lockfileVersion 2 and 3).

import type { Dep } from "../types.ts";

interface LockEntry {
  name?: string;
  version?: string;
  link?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface PackageLock {
  lockfileVersion?: number;
  packages?: Record<string, LockEntry>;
}

const NM = "node_modules/";

/** Package name from a lockfile key, e.g. "node_modules/a/node_modules/@s/b" -> "@s/b". */
export function nameFromKey(key: string): string | undefined {
  const i = key.lastIndexOf(NM);
  if (i === -1) return undefined;
  return key.slice(i + NM.length);
}

/** Find which lockfile key a package at `fromKey` gets for `dep`, using Node's lookup rules. */
function resolveKey(
  packages: Record<string, LockEntry>,
  fromKey: string,
  dep: string,
): string | undefined {
  let base = fromKey;
  for (;;) {
    const candidate = base === "" ? NM + dep : `${base}/${NM}${dep}`;
    if (packages[candidate] && !packages[candidate].link) return candidate;
    if (base === "") return undefined;
    // Step up one node_modules level (or to the root).
    const i = base.lastIndexOf("/" + NM);
    base = i === -1 ? "" : base.slice(0, i);
  }
}

export function parsePackageLock(text: string): Dep[] {
  let lock: PackageLock;
  try {
    lock = JSON.parse(text) as PackageLock;
  } catch (err) {
    throw new Error(`package-lock.json is not valid JSON: ${(err as Error).message}`);
  }
  const packages = lock.packages;
  if (!packages || typeof packages !== "object") {
    throw new Error(
      `package-lock.json has no "packages" map (lockfileVersion ${lock.lockfileVersion ?? "?"}). ` +
        "Only lockfileVersion 2 and 3 are supported; run npm install with npm 7+ to upgrade it.",
    );
  }

  const root = packages[""] ?? {};
  const directNames = new Set<string>([
    ...Object.keys(root.dependencies ?? {}),
    ...Object.keys(root.devDependencies ?? {}),
    ...Object.keys(root.optionalDependencies ?? {}),
    ...Object.keys(root.peerDependencies ?? {}),
  ]);

  // Keys of installed packages (skip root, links and local workspace folders).
  const keys = Object.keys(packages).filter((k) => {
    const e = packages[k];
    return k !== "" && !e.link && nameFromKey(k) !== undefined && typeof e.version === "string";
  });

  // For each target key, the set of dependent package names.
  const dependents = new Map<string, Set<string>>();
  for (const key of keys) {
    const entry = packages[key];
    const fromName = entry.name ?? nameFromKey(key)!;
    const names = new Set([
      ...Object.keys(entry.dependencies ?? {}),
      ...Object.keys(entry.optionalDependencies ?? {}),
      ...Object.keys(entry.peerDependencies ?? {}),
    ]);
    for (const dep of names) {
      if (dep === fromName) continue;
      const target = resolveKey(packages, key, dep);
      if (!target) continue;
      let set = dependents.get(target);
      if (!set) dependents.set(target, (set = new Set()));
      set.add(fromName);
    }
  }

  // Dedupe by name+version, merging counts across copies.
  const byId = new Map<string, { dep: Dep; by: Set<string> }>();
  for (const key of keys) {
    const keyName = nameFromKey(key)!;
    // An aliased install ("x": "npm:y@1") keeps the real name in "name".
    const name = packages[key].name ?? keyName;
    const version = packages[key].version!;
    const id = `${name}@${version}`;
    let item = byId.get(id);
    if (!item) {
      item = {
        dep: { name, version, ecosystem: "npm", direct: false, dependedOnBy: 0 },
        by: new Set(),
      };
      byId.set(id, item);
    }
    // Direct means the root actually resolves this copy.
    if (key === NM + keyName && directNames.has(keyName)) item.dep.direct = true;
    for (const d of dependents.get(key) ?? []) item.by.add(d);
  }

  return [...byId.values()].map(({ dep, by }) => ({ ...dep, dependedOnBy: by.size }));
}
