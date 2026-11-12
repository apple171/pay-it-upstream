// Helpers shared by the registry modules.

/** Turn the many repository URL styles into https://host/owner/repo. */
export function normalizeRepoUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim();
  // npm shorthands: "github:owner/repo", "gitlab:owner/repo", "owner/repo"
  const short = /^(github|gitlab|bitbucket):([\w.-]+\/[\w.-]+)$/i.exec(s);
  if (short) {
    const host = { github: "github.com", gitlab: "gitlab.com", bitbucket: "bitbucket.org" }[
      short[1].toLowerCase() as "github" | "gitlab" | "bitbucket"
    ];
    s = `https://${host}/${short[2]}`;
  } else if (/^[\w.-]+\/[\w.-]+$/.test(s)) {
    s = `https://github.com/${s}`;
  }
  s = s
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^http:\/\//, "https://");
  try {
    const u = new URL(s);
    const parts = u.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
    if (/^(github\.com|gitlab\.com|bitbucket\.org)$/i.test(u.hostname) && parts.length >= 2) {
      return `https://${u.hostname.toLowerCase()}/${parts[0]}/${parts[1]}`;
    }
    return `https://${u.hostname}${u.pathname.replace(/\.git$/, "").replace(/\/$/, "")}`;
  } catch {
    return undefined;
  }
}

/** First and last release dates and number of releases in the past 365 days. */
export function releaseStats(dates: Date[]): { firstRelease?: string; lastRelease?: string; releasesLastYear?: number } {
  const valid = dates.filter((d) => !Number.isNaN(d.getTime()));
  if (valid.length === 0) return {};
  const cutoff = Date.now() - 365 * 24 * 3600_000;
  const last = valid.reduce((a, b) => (b > a ? b : a));
  const first = valid.reduce((a, b) => (b < a ? b : a));
  return {
    firstRelease: first.toISOString(),
    lastRelease: last.toISOString(),
    releasesLastYear: valid.filter((d) => d.getTime() >= cutoff).length,
  };
}

/** Rough markdown / rst / HTML to plain text, trimmed to `max` chars. */
export function toPlainText(src: string, max = 4000): string {
  let s = src.replace(/\r\n?/g, "\n");
  s = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "") // linked badges
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links
    .replace(/<\/?[a-zA-Z][^>]*>/g, "") // HTML tags
    .replace(/^\.\. (image|figure|\|[^|]*\|)[^\n]*(\n {3,}[^\n]*)*/gm, "") // rst images/badges
    .replace(/`([^`<]+) <[^>]+>`_+/g, "$1") // rst links
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[=\-~^*]{3,}\s*$/gm, "") // rst underlines, hr
    .replace(/^```[^\n]*$/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\\([\\`*_{}\[\]()#+\-.!&|<>])/g, "$1") // markdown escapes
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (s.length > max) {
    const cut = s.lastIndexOf(" ", max);
    s = s.slice(0, cut > max * 0.8 ? cut : max).trimEnd() + " …";
  }
  return s;
}

export function errMsg(source: string, err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return `${source}: ${m.length > 160 ? m.slice(0, 160) + "…" : m}`;
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
