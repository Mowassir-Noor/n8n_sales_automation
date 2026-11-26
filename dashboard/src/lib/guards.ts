// Pure request guards used by the API wrappers (kept apart from auth so they are easy to test).

// ---- Origin (CSRF) --------------------------------------------------------

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Exported for tests. `authUrl` undefined + not production: allow localhost origins that match the request host. */
export function originAllowed(req: Request, authUrl: string | undefined, isProduction: boolean): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    // Browsers always send Origin on fetch POSTs. In dev only, accept Fetch Metadata instead.
    return !isProduction && req.headers.get("sec-fetch-site") === "same-origin";
  }
  let o: URL;
  try { o = new URL(origin); } catch { return false; }
  if (authUrl) {
    try { return o.origin === new URL(authUrl).origin; } catch { return false; }
  }
  if (isProduction) return false;
  const host = req.headers.get("host") ?? "";
  return LOCAL_HOSTS.has(o.hostname) && o.host === host;
}

// ---- Rate limit (60 writes / minute / user, in memory) ---------------------

export const RATE_LIMIT = 60;
const WINDOW_MS = 60_000;
const RL_KEY = Symbol.for("texprove.dashboard.ratelimit");
const g = globalThis as unknown as Record<symbol, Map<string, number[]>>;
const hits: Map<string, number[]> = (g[RL_KEY] ??= new Map());

/** true = allowed (and counted). */
export function rateLimit(user: string, now = Date.now()): boolean {
  const list = (hits.get(user) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= RATE_LIMIT) { hits.set(user, list); return false; }
  list.push(now);
  hits.set(user, list);
  return true;
}
export function resetRateLimit() { hits.clear(); }
