// Small shared pieces for the site's pages (server components).
import Link from "next/link";
import type { ReactNode } from "react";
import type { Level } from "@/lib/store";
import { money, statusWord, tone } from "@/lib/views";

export function Status({ status, label }: { status: string; label?: string }) {
  return <span className={`status ${tone(status)}`}>{label ?? statusWord(status)}</span>;
}

export function Signed({ yes, label }: { yes: boolean; label?: string }) {
  return yes ? (
    <span className="signed" title="Confirmed by a PayPal webhook whose signature checked out">
      <Icon name="shield" size={13} /> {label ?? "PayPal-signed"}
    </span>
  ) : (
    <span className="signed no">awaiting PayPal</span>
  );
}

const SCORE: Record<Level, number> = { low: 1, medium: 2, high: 3 };
export function Levels({ levels }: { levels?: { reliance?: Level; fragility?: Level; underfunded?: Level } }) {
  if (!levels) return null;
  const one = (key: "reliance" | "fragility" | "underfunded", short: string, title: string) => {
    const lv = levels[key];
    if (!lv) return null;
    return (
      <span className={short.toLowerCase()} title={`${title}: ${lv}`}>
        {short}
        <b>
          {[1, 2, 3].map((n) => (
            <i key={n} className={n <= SCORE[lv] ? "on" : ""} />
          ))}
        </b>
      </span>
    );
  };
  return (
    <span className="levels">
      {one("reliance", "R", "How much the project relies on it")}
      {one("fragility", "F", "How fragile it is")}
      {one("underfunded", "U", "How underfunded it is")}
    </span>
  );
}

export function SplitBar({ paid, waiting, other, currency = "USD", legend = true }: { paid: number; waiting: number; other: number; currency?: string; legend?: boolean }) {
  const total = paid + waiting + other || 1;
  return (
    <>
      <div className="splitbar" aria-hidden>
        {paid > 0 && <i className="ok" style={{ width: `${(100 * paid) / total}%` }} />}
        {waiting > 0 && <i className="wait" style={{ width: `${(100 * waiting) / total}%` }} />}
        {other > 0 && <i className="info" style={{ width: `${(100 * other) / total}%` }} />}
      </div>
      {legend && (
        <div className="legend">
          <span className="status ok">{money(paid, currency)} paid</span>
          {waiting > 0 && <span className="status wait">{money(waiting, currency)} waiting</span>}
          {other > 0 && <span className="status info">{money(other, currency)} other</span>}
        </div>
      )}
    </>
  );
}

/** A row of filter links that keep the other query params. */
export function FilterChips({
  label, param, options, current, base, params,
}: {
  label: string;
  param: string;
  options: { value: string; label: string; count?: number }[];
  current: string;
  base: string;
  params: Record<string, string>;
}) {
  const href = (value: string) => {
    const q = new URLSearchParams({ ...params, [param]: value });
    if (!value) q.delete(param);
    for (const [k, v] of [...q]) if (!v) q.delete(k);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  return (
    <div className="filter-group">
      <span className="label">{label}</span>
      {options.map((o) => (
        <Link key={o.value} href={href(o.value)} className="chip" aria-current={current === o.value ? "true" : undefined} scroll={false}>
          {o.label}
          {o.count !== undefined && <span className="count">{o.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function PageHead({ eyebrow, title, children, crumbs }: { eyebrow?: string; title: ReactNode; children?: ReactNode; crumbs?: ReactNode }) {
  return (
    <header className="page-head">
      {crumbs && <div className="crumbs">{crumbs}</div>}
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}

export function EnvTag({ env }: { env: string }) {
  return env === "sandbox" ? <span className="tag">sandbox</span> : env ? <span className="tag ok">live</span> : null;
}

const PATHS: Record<string, ReactNode> = {
  shield: <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3zm-3 9l2 2 4-4" />,
  search: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16l-4.3-4.3" />,
  github: <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.8V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z" />,
  sun: <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m11.4 0 1.4 1.4M4.9 4.9l1.4 1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  scan: <path d="M4 8V5a1 1 0 0 1 1-1h3m8 0h3a1 1 0 0 1 1 1v3m0 8v3a1 1 0 0 1-1 1h-3m-8 0H5a1 1 0 0 1-1-1v-3M8 12h8" />,
  spark: <path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6" />,
  send: <path d="M4 12l16-8-6 16-3-7-7-1z" />,
  terminal: <path d="M5 7l4 5-4 5m6 0h8" />,
  lock: <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" />,
  repeat: <path d="M4 12a8 8 0 0 1 14-5.3L20 9m0-5v5h-5m5 3a8 8 0 0 1-14 5.3L4 15m0 5v-5h5" />,
  bot: <path d="M12 3v3m-6 3h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zm3 5h.01M15 14h.01" />,
  hand: <path d="M7 12V7a1.5 1.5 0 0 1 3 0v4m0-5a1.5 1.5 0 0 1 3 0v5m0-4a1.5 1.5 0 0 1 3 0v6c0 4-2.5 7-6 7-2.5 0-4-1.2-5.5-3.5L3 13.5a1.5 1.5 0 0 1 2.5-1.6L7 14" />,
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "github" ? 0 : 1.7}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden style={name === "github" ? { fill: "currentColor" } : undefined}>
      {PATHS[name]}
    </svg>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  // Three stacked layers with an arrow up through them: money flowing upstream.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--accent)" />
      <path d="M6.5 15.5 12 18l5.5-2.5M6.5 11.5 12 14l5.5-2.5" stroke="var(--accent-ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
      <path d="M12 13V5.5m0 0L9 8.5m3-3 3 3" stroke="var(--accent-ink)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
