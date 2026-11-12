// Small HTTP helper: JSON fetch with timeout, retry and an on-disk cache.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface GetOptions {
  cacheDir: string;
  ttlHours?: number;
  /** Retry once on 429/5xx/network errors. Default true. */
  retry?: boolean;
  /** Parse the body as text instead of JSON. */
  text?: boolean;
  /**
   * Keep only part of a large response. Only the picked value is cached,
   * under a key that includes `name`.
   */
  pick?: { name: string; fn: (data: any) => unknown };
}

interface CacheEntry {
  fetchedAt: number;
  url: string;
  data: unknown;
}

const TIMEOUT_MS = 15_000;
const USER_AGENT = "pay-it-upstream";

// Requests for the same URL that are already running share one promise.
const inFlight = new Map<string, Promise<unknown>>();

export class HttpError extends Error {
  status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
  }
}

function cachePath(cacheDir: string, url: string): string {
  return join(cacheDir, createHash("sha1").update(url).digest("hex") + ".json");
}

async function readCache(file: string, ttlHours: number): Promise<CacheEntry | undefined> {
  try {
    const entry = JSON.parse(await readFile(file, "utf8")) as CacheEntry;
    if (Date.now() - entry.fetchedAt < ttlHours * 3600_000) return entry;
  } catch {
    // missing or unreadable cache file
  }
  return undefined;
}

async function writeCache(cacheDir: string, file: string, url: string, data: unknown): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    const entry: CacheEntry = { fetchedAt: Date.now(), url, data };
    await writeFile(file, JSON.stringify(entry));
  } catch {
    // caching is best effort
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryDelay(res: Response | undefined): number {
  const header = res?.headers.get("retry-after");
  const secs = header ? Number(header) : NaN;
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 5000);
  return 1500;
}

async function fetchOnce(url: string, text: boolean): Promise<{ status: number; data: unknown; res: Response }> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: text ? "text/plain, */*" : "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  if (res.status === 404) {
    await res.body?.cancel();
    return { status: 404, data: null, res };
  }
  if (!res.ok) {
    await res.body?.cancel();
    return { status: res.status, data: undefined, res };
  }
  const data = text ? await res.text() : await res.json();
  return { status: res.status, data, res };
}

async function fetchWithRetry(url: string, opts: GetOptions): Promise<unknown> {
  const retry = opts.retry ?? true;
  const text = opts.text ?? false;
  let attempt = 0;
  for (;;) {
    attempt++;
    let res: Response | undefined;
    try {
      const out = await fetchOnce(url, text);
      res = out.res;
      if (out.status === 404 || out.res.ok) return out.data;
      const retryable = out.status === 429 || out.status >= 500;
      if (!retryable || !retry || attempt > 1) throw new HttpError(out.status, url);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // network error or timeout
      if (!retry || attempt > 1) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`${msg} for ${url}`);
      }
    }
    await sleep(retryDelay(res));
  }
}

/**
 * GET a URL and parse JSON. Returns null on 404. Results (including 404s)
 * are cached on disk for `ttlHours`. Throws on other failures.
 */
export async function getJson<T = unknown>(url: string, opts: GetOptions): Promise<T | null> {
  const ttlHours = opts.ttlHours ?? 24;
  const key = opts.pick ? `${opts.pick.name}:${url}` : opts.text ? "text:" + url : url;
  const file = cachePath(opts.cacheDir, key);
  const cached = await readCache(file, ttlHours);
  if (cached) return cached.data as T | null;

  let p = inFlight.get(key);
  if (!p) {
    const pick = opts.pick;
    p = (async () => {
      let data = await fetchWithRetry(url, opts);
      if (pick && data != null) data = pick.fn(data);
      await writeCache(opts.cacheDir, file, url, data);
      return data;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, p);
  }
  return (await p) as T | null;
}

/** Same as getJson but returns the body as text. */
export async function getText(url: string, opts: GetOptions): Promise<string | null> {
  return getJson<string>(url, { ...opts, text: true });
}

/** Returns a function that runs at most `n` tasks at once. */
export function limiter(n: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= n) return;
    const run = queue.shift();
    if (run) {
      active++;
      run();
    }
  };
  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}
