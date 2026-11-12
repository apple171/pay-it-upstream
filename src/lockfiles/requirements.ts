// Reader for requirements.txt, including pip-compile "# via" annotations.

import type { Dep } from "../types.ts";
import { normalizePyName } from "./uv.ts";

interface Entry {
  name: string;
  version: string;
  via: string[] | undefined;
}

const REQ = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/;

/** Parse one requirement line (comments already removed). */
function parseRequirement(line: string): { name: string; version: string } | undefined {
  // Drop environment markers and per-requirement options like --hash.
  let spec = line.split(";")[0];
  spec = spec.replace(/\s--?\S+(=\S*)?/g, " ").trim();
  if (!spec) return undefined;
  const m = REQ.exec(spec);
  if (!m) return undefined; // URL or path without a name
  const name = normalizePyName(m[1]);
  const rest = m[3].trim();
  if (rest.startsWith("@")) return { name, version: "" }; // direct URL reference
  const pin = /^===?\s*([^\s,*]+)\s*$/.exec(rest);
  return { name, version: pin ? pin[1] : "" };
}

/** "-r file", "-c file" or "project (pyproject.toml)" mean the project asked for it. */
function isProjectSource(via: string): boolean {
  return /^-[rc]\s/.test(via) || /\((pyproject\.toml|setup\.py|setup\.cfg)\)$/.test(via);
}

export function parseRequirements(text: string): Dep[] {
  // Join backslash continuations first.
  const lines = text.replace(/\\\r?\n/g, " ").split(/\r?\n/);

  const entries: Entry[] = [];
  let current: Entry | undefined;
  let inViaBlock = false;

  const addVia = (items: string[]) => {
    if (!current) return;
    current.via ??= [];
    for (const item of items) {
      const v = item.trim();
      if (v) current.via.push(v);
    }
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      inViaBlock = false;
      continue;
    }

    if (trimmed.startsWith("#")) {
      const body = trimmed.slice(1).trim();
      const via = /^via\b\s*(.*)$/.exec(body);
      if (via) {
        // "# via a, b" on one line, or "# via" followed by "#   a" lines.
        if (via[1]) addVia(via[1].split(","));
        inViaBlock = !via[1];
      } else if (inViaBlock && /^#\s{2,}\S/.test(trimmed)) {
        addVia([body]);
      } else {
        inViaBlock = false;
      }
      continue;
    }

    inViaBlock = false;
    if (trimmed.startsWith("-")) {
      current = undefined; // -r, -e, -c, --index-url and other options
      continue;
    }

    const hash = trimmed.search(/\s#/);
    const reqPart = hash === -1 ? trimmed : trimmed.slice(0, hash);
    const comment = hash === -1 ? "" : trimmed.slice(hash).replace(/^\s*#\s*/, "");
    const req = parseRequirement(reqPart);
    if (!req) {
      current = undefined;
      continue;
    }
    current = { ...req, via: undefined };
    entries.push(current);
    const inlineVia = /^via\b\s*(.*)$/.exec(comment);
    if (inlineVia) addVia(inlineVia[1].split(","));
  }

  const byId = new Map<string, Dep>();
  for (const e of entries) {
    let direct = true;
    let dependedOnBy = 0;
    if (e.via) {
      direct = e.via.some(isProjectSource);
      const parents = new Set(
        e.via.filter((v) => !isProjectSource(v)).map((v) => normalizePyName(v.split(/\s/)[0])),
      );
      parents.delete(e.name);
      dependedOnBy = parents.size;
    }
    const id = `${e.name}@${e.version}`;
    const prev = byId.get(id);
    if (prev) {
      prev.direct ||= direct;
      prev.dependedOnBy = Math.max(prev.dependedOnBy, dependedOnBy);
      continue;
    }
    byId.set(id, { name: e.name, version: e.version, ecosystem: "pypi", direct, dependedOnBy });
  }
  return [...byId.values()];
}
