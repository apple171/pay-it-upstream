"use client";
// Top bar: logo, page links, search (⌘K), GitHub, theme toggle, and a menu on small screens.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Logo } from "./components/ui";
import type { SearchHit } from "@/lib/views";

const REPO = "https://github.com/apple171/pay-it-upstream";
const LINKS = [
  { href: "/runs", label: "Runs" },
  { href: "/packages", label: "Packages" },
  { href: "/pledges", label: "Pledges" },
  { href: "/proof", label: "Proof" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/maintainers", label: "Maintainers" },
  { href: "/how-it-works", label: "How it works" },
];

export function Nav() {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const active = (href: string) => path === href || path.startsWith(`${href}/`);

  useEffect(() => setMenu(false), [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Link href="/" className="logo" aria-label="Pay It Upstream home">
            <Logo />
            <span>pay-it-upstream</span>
          </Link>
          <nav className="nav-links" aria-label="Main">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="nav-right">
            <button className="search-trigger" onClick={() => setPalette(true)} aria-label="Search packages, runs and pledges">
              <Icon name="search" size={15} />
              <span className="label">Search packages…</span>
              <kbd>⌘K</kbd>
            </button>
            <a className="icon-btn" href={REPO} target="_blank" rel="noreferrer" aria-label="Source on GitHub">
              <Icon name="github" size={17} />
            </a>
            <ThemeToggle />
            <button className="icon-btn menu-btn" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}>
              <Icon name={menu ? "close" : "menu"} size={17} />
            </button>
          </div>
        </div>
      </header>
      <nav className={`mobile-menu${menu ? " open" : ""}`} aria-label="Main (mobile)">
        <Link href="/" aria-current={path === "/" ? "page" : undefined}>Home</Link>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
      {palette && <Palette onClose={() => setPalette(false)} />}
    </>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);
  useEffect(() => setTheme((document.documentElement.dataset.theme as "dark" | "light") ?? "dark"), []);
  const flip = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
    setTheme(next);
    // Charts draw on canvas and read colours once; tell the dashboard to redraw.
    window.dispatchEvent(new Event("piu-theme"));
  };
  return (
    <button className="icon-btn" onClick={flip} aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}>
      <Icon name={theme === "light" ? "moon" : "sun"} size={16} />
    </button>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  useEffect(() => {
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((d) => {
          setHits(d.hits ?? []);
          setI(0);
        })
        .catch(() => {});
    }, 80);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const go = useCallback(
    (h?: SearchHit) => {
      if (!h) return;
      onClose();
      router.push(h.href);
    },
    [onClose, router],
  );

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-box">
          <Icon name="search" size={17} />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search packages, runs, pledges…"
            aria-label="Search"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") (e.preventDefault(), setI((n) => Math.min(n + 1, hits.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setI((n) => Math.max(n - 1, 0)));
              if (e.key === "Enter") go(hits[i]);
            }}
          />
          <kbd>esc</kbd>
        </div>
        {hits.length ? (
          <ul>
            {hits.map((h, n) => (
              <li key={`${h.kind}:${h.href}`}>
                <Link href={h.href} data-active={n === i} onMouseEnter={() => setI(n)} onClick={(e) => (e.preventDefault(), go(h))}>
                  <span className="kind">{h.kind}</span>
                  <span className={h.kind === "package" ? "pkg-name" : ""}>{h.label}</span>
                  <span className="sub">{h.sub}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="none">{q ? `Nothing matches "${q}".` : "Loading…"}</div>
        )}
        <div className="hint">
          <span><kbd>↑</kbd> <kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
